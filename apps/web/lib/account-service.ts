import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from './auth/local-core';
import { normalizeEmail } from './auth/local-core';
import type { Database, Queryable } from './db/database';
import { linkEmail, type Mailer } from './mail';
import { QUESTIONNAIRE_VERSION, type StepAnswers } from './questionnaire';
import { isValidSiren } from './siren';

/**
 * Comptes et espace client.
 * - Les lectures et modifications faites par un utilisateur passent par `db.asUser` : la RLS
 *   PostgreSQL décide (isolation entre entreprises testée en base et ici).
 * - Les opérations « système » (réclamation d'un audit après vérification de l'e-mail, acceptation
 *   d'une invitation) passent par le rôle service, avec des contrôles explicites.
 */

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const CLAIM_TTL_DAYS = 30;
export const INVITATION_TTL_DAYS = 7;

export class NotFound extends Error { constructor(what = 'Ressource introuvable') { super(what); } }
export class Forbidden extends Error { constructor(what = 'Action non autorisée') { super(what); } }

// ---------------------------------------------------------------------------
// Utilisateur
// ---------------------------------------------------------------------------

/** Garantit la ligne public.users (créée par trigger sur auth.users ; filet de sécurité). */
export async function ensureProfile(db: Queryable, user: AuthUser): Promise<void> {
  await db.query(`insert into public.users (id, email) values ($1, $2) on conflict (id) do update set email = excluded.email`, [user.id, user.email]);
}

// ---------------------------------------------------------------------------
// Réclamation des audits anonymes
// ---------------------------------------------------------------------------

export async function createAuditClaim(db: Queryable, auditId: string, leadId: string | null, email: string): Promise<void> {
  await db.query(`insert into public.audit_claims (audit_id, lead_id, email, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))`,
    [auditId, leadId, normalizeEmail(email), CLAIM_TTL_DAYS]);
}

export type ClaimOutcome = 'entreprise_creee' | 'entreprise_existante_membre' | 'entreprise_existante_non_membre' | 'personnel';
export interface ClaimResult { auditId: string; outcome: ClaimOutcome; companyName: string }

/**
 * Appelée après une connexion par lien magique : l'e-mail est vérifié, l'utilisateur récupère
 * les audits qu'il a demandé à recevoir avec cette adresse.
 * - Entreprise inconnue : créée (statut « non vérifiée »), l'utilisateur en devient propriétaire.
 * - Entreprise existante dont il est membre (écriture) : l'audit y est rattaché.
 * - Entreprise existante dont il n'est pas membre : l'audit reste personnel ; il doit être invité.
 */
export async function claimPendingAudits(db: Database, user: AuthUser): Promise<ClaimResult[]> {
  await ensureProfile(db, user);
  return db.transaction(async (tx) => {
    const claims = await tx.query<{ id: string; audit_id: string; lead_id: string | null }>(
      `select c.id::text, c.audit_id::text, c.lead_id::text from public.audit_claims c join public.audits a on a.id = c.audit_id
        where lower(c.email) = $1 and c.claimed_at is null and c.expires_at > now() and (a.owner_user_id is null or a.owner_user_id = $2)
        order by c.created_at for update of c`, [normalizeEmail(user.email), user.id]);
    const results: ClaimResult[] = [];
    for (const claim of claims) {
      const [audit] = await tx.query<{ is_demo: boolean; company_id: string | null }>(`select is_demo, company_id::text from public.audits where id = $1`, [claim.audit_id]);
      const [row] = await tx.query<{ answers: unknown }>(`select answers from public.questionnaire_answers where audit_id = $1 and questionnaire_version = $2 and step = 'entreprise'`, [claim.audit_id, QUESTIONNAIRE_VERSION]);
      const entreprise = (typeof row?.answers === 'string' ? JSON.parse(row.answers) : row?.answers) as StepAnswers['entreprise'] | undefined;
      let outcome: ClaimOutcome = 'personnel';
      let companyId: string | null = audit?.company_id ?? null;
      if (!audit?.is_demo && entreprise && isValidSiren(entreprise.company.siren) && !companyId) {
        const [existing] = await tx.query<{ id: string }>(`select id::text from public.companies where siren = $1`, [entreprise.company.siren]);
        if (!existing) {
          companyId = await createCompanyFromAnswers(tx, user.id, entreprise);
          outcome = 'entreprise_creee';
        } else {
          const [m] = await tx.query<{ role: string }>(`select role::text from public.company_members where company_id = $1 and user_id = $2`, [existing.id, user.id]);
          if (m && (m.role === 'proprietaire' || m.role === 'collaborateur')) { companyId = existing.id; outcome = 'entreprise_existante_membre'; }
          else outcome = 'entreprise_existante_non_membre';
        }
      }
      await tx.query(`update public.audits set owner_user_id = $2, company_id = coalesce(company_id, $3) where id = $1`,
        [claim.audit_id, user.id, outcome === 'entreprise_creee' || outcome === 'entreprise_existante_membre' ? companyId : null]);
      await tx.query(`update public.audit_claims set claimed_by = $2, claimed_at = now(), outcome = $3 where id = $1`, [claim.id, user.id, outcome]);
      if (claim.lead_id) await tx.query(`update public.leads set status = 'compte_cree', user_id = $2, last_activity_at = now() where id = $1`, [claim.lead_id, user.id]);
      results.push({ auditId: claim.audit_id, outcome, companyName: entreprise?.company.legalName ?? '' });
    }
    return results;
  });
}

async function createCompanyFromAnswers(tx: Queryable, userId: string, e: StepAnswers['entreprise']): Promise<string> {
  const c = e.company;
  const [company] = await tx.query<{ id: string }>(
    `insert into public.companies (siren, legal_name, legal_form, naf_code, sector, created_on, headcount_range, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::text`,
    [c.siren, c.legalName, c.legalForm, c.nafCode, c.sector, c.createdOn, c.headcountRange, userId]);
  await tx.query(`insert into public.company_members (user_id, company_id, role) values ($1, $2, 'proprietaire')`, [userId, company!.id]);
  for (const est of e.establishments) {
    // Un SIRET déjà connu appartient forcément à cette entreprise (SIREN unique) : on l'ignore s'il existe.
    await tx.query(
      `insert into public.establishments (company_id, siret, address, postal_code, city, insee_code) values ($1, $2, $3, $4, $5, $6) on conflict (siret) do nothing`,
      [company!.id, est.siret, est.address, est.postalCode, est.city, est.inseeCode]);
  }
  return company!.id;
}

// ---------------------------------------------------------------------------
// Espace client (lectures sous RLS)
// ---------------------------------------------------------------------------

export interface MyCompany { id: string; siren: string; legal_name: string; role: string; verification_status: string }
export interface MyAudit {
  id: string; status: string; mode: string; is_demo: boolean; company_id: string | null; company_name: string | null; legal_name_answer: string | null;
  created_at: string; submitted_at: string | null; past_high: number | null; past_low: number | null; future_high: number | null;
}

export async function listMyCompanies(db: Database, userId: string): Promise<MyCompany[]> {
  return db.asUser(userId, (q) => q.query<MyCompany>(
    `select c.id::text, c.siren, c.legal_name, m.role::text, c.verification_status from public.companies c
       join public.company_members m on m.company_id = c.id and m.user_id = auth.uid() order by c.legal_name`));
}

export async function listMyAudits(db: Database, userId: string): Promise<MyAudit[]> {
  return db.asUser(userId, (q) => q.query<MyAudit>(
    `select a.id::text, a.status::text, a.mode::text, a.is_demo, a.company_id::text, c.legal_name as company_name,
            qa.answers #>> '{company,legalName}' as legal_name_answer, a.created_at::text, a.submitted_at::text,
            (r.totals #>> '{pastRecovery,high}')::float8 as past_high, (r.totals #>> '{pastRecovery,low}')::float8 as past_low,
            (r.totals #>> '{futureAnnualSavings,high}')::float8 as future_high
       from public.audits a
       left join public.companies c on c.id = a.company_id
       left join public.questionnaire_answers qa on qa.audit_id = a.id and qa.step = 'entreprise'
       left join public.calculation_runs r on r.id = a.last_calculation_run_id
      order by a.created_at desc`));
}

export async function listPendingCompanyAccess(db: Database, userId: string) {
  return db.asUser(userId, (q) => q.query<{ audit_id: string; company_name: string | null }>(
    `select c.audit_id::text, qa.answers #>> '{company,legalName}' as company_name from public.audit_claims c
       join public.audits a on a.id = c.audit_id
       left join public.questionnaire_answers qa on qa.audit_id = a.id and qa.step = 'entreprise'
      where c.claimed_by = auth.uid() and c.outcome = 'entreprise_existante_non_membre' and a.company_id is null`));
}

export interface CompanyView {
  company: { id: string; siren: string; legal_name: string; legal_form: string | null; naf_code: string | null; verification_status: string };
  myRole: string;
  establishments: { id: string; siret: string | null; address: string | null; postal_code: string | null; city: string | null }[];
  members: { user_id: string; email: string; first_name: string | null; role: string; joined_at: string }[];
  invitations: { id: string; email: string; role: string; expires_at: string; expired: boolean }[];
  audits: MyAudit[];
}

export async function getCompanyView(db: Database, userId: string, companyId: string): Promise<CompanyView> {
  if (!z.string().uuid().safeParse(companyId).success) throw new NotFound();
  const view = await db.asUser(userId, async (q) => {
    const [company] = await q.query<CompanyView['company']>(`select id::text, siren, legal_name, legal_form, naf_code, verification_status from public.companies where id = $1`, [companyId]);
    if (!company) return null;
    const [me] = await q.query<{ role: string }>(`select role::text from public.company_members where company_id = $1 and user_id = auth.uid()`, [companyId]);
    const establishments = await q.query<CompanyView['establishments'][number]>(`select id::text, siret, address, postal_code, city from public.establishments where company_id = $1 order by siret nulls last`, [companyId]);
    const members = await q.query<CompanyView['members'][number]>(`select user_id::text, email, first_name, role::text, joined_at::text from app.list_company_members($1)`, [companyId]);
    // RLS : seules les invitations de ses propres entreprises, et seulement pour un propriétaire.
    const invitations = await q.query<CompanyView['invitations'][number]>(
      `select id::text, email, role::text, expires_at::text, expires_at < now() as expired from public.invitations where company_id = $1 and accepted_at is null and revoked_at is null order by created_at`, [companyId]);
    return { company, myRole: me?.role ?? 'interne', establishments, members, invitations };
  });
  if (!view) throw new NotFound('Entreprise introuvable');
  const audits = (await listMyAudits(db, userId)).filter((a) => a.company_id === companyId);
  return { ...view, audits };
}

// ---------------------------------------------------------------------------
// Invitations et membres
// ---------------------------------------------------------------------------

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(254),
  role: z.enum(['collaborateur', 'comptable_invite']),
});

export const ROLE_LABELS: Record<string, string> = { proprietaire: 'Propriétaire', collaborateur: 'Collaborateur', comptable_invite: 'Comptable invité (lecture et dépôt de documents)' };

export async function inviteMember(db: Database, mailer: Mailer, inviter: AuthUser, companyId: string, input: z.input<typeof inviteSchema>, origin: string) {
  const d = inviteSchema.parse(input);
  const t = randomBytes(32).toString('base64url');
  const company = await db.asUser(inviter.id, async (q) => {
    const [c] = await q.query<{ legal_name: string }>(`select legal_name from public.companies where id = $1`, [companyId]);
    if (!c) throw new NotFound('Entreprise introuvable');
    const already = await q.query(`select 1 from app.list_company_members($1) where lower(email) = $2`, [companyId, d.email]);
    if (already.length) throw new Forbidden('Cette personne est déjà membre de l’entreprise.');
    // La RLS n'autorise l'insertion qu'au propriétaire de l'entreprise.
    await q.query(`insert into public.invitations (company_id, email, role, token_hash, invited_by, expires_at) values ($1, $2, $3, $4, auth.uid(), now() + make_interval(days => $5))`,
      [companyId, d.email, d.role, sha256(t), INVITATION_TTL_DAYS]).catch((e: Error) => {
      if (/row-level security/.test(e.message)) throw new Forbidden('Seul un propriétaire peut inviter des membres.');
      if (/duplicate key/.test(e.message)) throw new Forbidden('Une invitation est déjà en attente pour cette adresse.');
      throw e;
    });
    return c;
  });
  const url = `${origin}/invitation/${t}`;
  await mailer.send(linkEmail({
    to: d.email,
    subject: `Invitation à rejoindre ${company.legal_name}`,
    intro: `${inviter.email} vous invite à rejoindre l’espace de ${company.legal_name} en tant que ${ROLE_LABELS[d.role]!.toLowerCase()}.`,
    cta: 'Accepter l’invitation',
    url,
    outro: `Ce lien est valable ${INVITATION_TTL_DAYS} jours et réservé à l’adresse ${d.email}. Si vous ne connaissez pas cette entreprise, ignorez ce message.`,
  }));
  return { url };
}

export async function revokeInvitation(db: Database, userId: string, invitationId: string) {
  const r = await db.asUser(userId, (q) => q.query(`update public.invitations set revoked_at = now() where id = $1 and accepted_at is null and revoked_at is null returning id`, [invitationId]));
  if (!r.length) throw new Forbidden('Invitation introuvable ou déjà traitée.');
}

export type InvitationState =
  | { status: 'valide'; companyName: string; email: string; role: string }
  | { status: 'expiree' | 'acceptee' | 'revoquee' | 'inconnue'; companyName?: string };

export async function inspectInvitation(db: Queryable, t: string): Promise<InvitationState> {
  const [i] = await db.query<{ email: string; role: string; legal_name: string; expired: boolean; accepted: boolean; revoked: boolean }>(
    `select i.email, i.role::text, c.legal_name, i.expires_at < now() as expired, i.accepted_at is not null as accepted, i.revoked_at is not null as revoked
       from public.invitations i join public.companies c on c.id = i.company_id where i.token_hash = $1`, [sha256(t)]);
  if (!i) return { status: 'inconnue' };
  if (i.accepted) return { status: 'acceptee', companyName: i.legal_name };
  if (i.revoked) return { status: 'revoquee', companyName: i.legal_name };
  if (i.expired) return { status: 'expiree', companyName: i.legal_name };
  return { status: 'valide', companyName: i.legal_name, email: i.email, role: i.role };
}

/** L'invitation est réservée à l'adresse invitée, vérifiée par le lien magique. */
export async function acceptInvitation(db: Database, user: AuthUser, t: string): Promise<{ companyId: string }> {
  await ensureProfile(db, user);
  return db.transaction(async (tx) => {
    const [i] = await tx.query<{ id: string; company_id: string; email: string; role: string; valid: boolean }>(
      `select id::text, company_id::text, email, role::text, (accepted_at is null and revoked_at is null and expires_at > now()) as valid
         from public.invitations where token_hash = $1 for update`, [sha256(t)]);
    if (!i || !i.valid) throw new Forbidden('Cette invitation n’est plus valable.');
    if (normalizeEmail(i.email) !== normalizeEmail(user.email)) throw new Forbidden(`Cette invitation est réservée à ${i.email}. Connectez-vous avec cette adresse.`);
    await tx.query(`insert into public.company_members (user_id, company_id, role) values ($1, $2, $3) on conflict (user_id, company_id) do nothing`, [user.id, i.company_id, i.role]);
    await tx.query(`update public.invitations set accepted_at = now(), accepted_by = $2 where id = $1`, [i.id, user.id]);
    return { companyId: i.company_id };
  });
}

export async function changeMemberRole(db: Database, userId: string, companyId: string, memberId: string, role: 'proprietaire' | 'collaborateur' | 'comptable_invite') {
  const r = await db.asUser(userId, (q) => q.query(`update public.company_members set role = $3 where company_id = $1 and user_id = $2 returning user_id`, [companyId, memberId, role]))
    .catch((e: Error) => { throw /propriétaire/.test(e.message) ? new Forbidden(e.message.replace(/^.*: /, '')) : e; });
  if (!r.length) throw new Forbidden('Seul un propriétaire peut modifier les rôles.');
}

export async function removeMember(db: Database, userId: string, companyId: string, memberId: string) {
  const r = await db.asUser(userId, (q) => q.query(`delete from public.company_members where company_id = $1 and user_id = $2 returning user_id`, [companyId, memberId]))
    .catch((e: Error) => { throw /propriétaire/.test(e.message) ? new Forbidden('Une entreprise doit conserver au moins un propriétaire.') : e; });
  if (!r.length) throw new Forbidden('Action non autorisée.');
}

/**
 * Amorçage du premier administrateur : uniquement si aucun administrateur n'existe encore et si
 * l'adresse (vérifiée par le lien magique) figure dans BOOTSTRAP_ADMIN_EMAILS. Journalisé.
 */
export async function bootstrapAdmin(db: Database, user: AuthUser, allowed: string | undefined): Promise<boolean> {
  const list = (allowed ?? '').split(',').map((e) => normalizeEmail(e)).filter(Boolean);
  if (!list.includes(normalizeEmail(user.email))) return false;
  await ensureProfile(db, user);
  const r = await db.query(
    `update public.users set internal_role = 'administrateur' where id = $1 and not exists (select 1 from public.users where internal_role = 'administrateur') returning id`, [user.id]);
  return r.length > 0;
}
