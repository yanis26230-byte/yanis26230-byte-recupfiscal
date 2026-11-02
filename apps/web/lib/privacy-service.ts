import { createHash } from 'node:crypto';
import { Forbidden } from './account-service';
import type { AuthUser } from './auth/local-core';
import { normalizeEmail } from './auth/local-core';
import type { Database, Queryable } from './db/database';
import type { FileStore } from './storage';

/**
 * RGPD : export, suppression, durées de conservation. Les durées sont paramétrables par variables
 * d'environnement ; les valeurs par défaut sont des propositions À VALIDER par le DPO.
 */
export const RETENTION = {
  /** Audit anonyme jamais rattaché à un compte. */
  anonymousAuditDays: Number(process.env.RETENTION_ANONYMOUS_AUDIT_DAYS ?? 180),
  /** Prospect sans compte, sans activité (recommandation CNIL en prospection B2B : 3 ans). */
  leadInactiveDays: Number(process.env.RETENTION_LEAD_DAYS ?? 3 * 365),
  /** Données techniques : liens, sessions expirées, file de traitement, boîte de développement. */
  technicalDays: Number(process.env.RETENTION_TECHNICAL_DAYS ?? 30),
};

const hash = (s: string) => createHash('sha256').update(normalizeEmail(s)).digest('hex');

/** Export portable (JSON) des données de l'utilisateur et des entreprises dont il est membre. */
export async function exportMyData(db: Database, user: AuthUser) {
  const data = await db.asUser(user.id, async (q) => {
    const j = (sql: string, params: unknown[] = []) => q.query(sql, params);
    return {
      exportedAt: new Date().toISOString(),
      profile: (await j(`select id, email, first_name, phone, created_at from public.users where id = auth.uid()`))[0],
      memberships: await j(`select c.siren, c.legal_name, m.role, m.created_at from public.company_members m join public.companies c on c.id = m.company_id where m.user_id = auth.uid()`),
      audits: await j(`select a.id, a.mode, a.status, a.created_at, a.company_id,
                         (select json_object_agg(step, answers) from public.questionnaire_answers qa where qa.audit_id = a.id) as answers,
                         (select totals from public.calculation_runs r where r.id = a.last_calculation_run_id) as totals
                         from public.audits a order by a.created_at`),
      cases: await j(`select id, company_id, status, created_at from public.cases order by created_at`),
      documents: await j(`select id, company_id, original_filename, document_type, created_at from public.documents order by created_at`),
      notifications: await j(`select created_at, payload, read_at from public.notifications where user_id = auth.uid() order by created_at`),
    };
  });
  const leads = await db.query(`select email, first_name, phone, siren, consent, consent_text_version, consent_at, source, created_at from public.leads where lower(email) = $1`, [normalizeEmail(user.email)]);
  await db.query(`insert into public.privacy_requests (kind, user_email_hash, status) values ('export', $1, 'effectuee')`, [hash(user.email)]);
  return { ...data, leads };
}

/**
 * Suppression du compte : profil, sessions, notifications, audits personnels, prospects
 * (anonymisés), et entreprises dont l'utilisateur est le seul membre et sans démarche engagée.
 * Refusée si l'utilisateur est le dernier propriétaire d'une entreprise partagée, s'il a un
 * rôle interne, ou si une démarche engagée impose la conservation des pièces.
 */
export async function deleteMyAccount(db: Database, store: FileStore, user: AuthUser): Promise<{ deletedCompanies: number }> {
  const [u] = await db.query<{ internal_role: string | null }>(`select internal_role::text from public.users where id = $1`, [user.id]);
  if (u?.internal_role) throw new Forbidden('Un compte de l’équipe interne doit être retiré par un administrateur.');
  const companies = await db.query<{ company_id: string; role: string; members: number; cases: number }>(
    `select m.company_id::text, m.role::text, (select count(*) from public.company_members x where x.company_id = m.company_id)::int as members,
            (select count(*) from public.cases k where k.company_id = m.company_id)::int as cases
       from public.company_members m where m.user_id = $1`, [user.id]);
  for (const c of companies.filter((x) => x.role === 'proprietaire' && x.members > 1)) {
    const [owners] = await db.query<{ n: number }>(`select count(*)::int as n from public.company_members where company_id = $1 and role = 'proprietaire'`, [c.company_id]);
    if ((owners?.n ?? 0) <= 1) throw new Forbidden('Vous êtes le seul propriétaire d’une entreprise partagée : désignez d’abord un autre propriétaire.');
  }
  const solo = companies.filter((c) => c.members === 1);
  if (solo.some((c) => c.cases > 0)) {
    await db.query(`insert into public.privacy_requests (kind, user_email_hash, status, details) values ('suppression', $1, 'refusee', 'démarche engagée')`, [hash(user.email)]);
    throw new Forbidden('Une démarche de récupération a été engagée : les pièces doivent être conservées pendant la durée légale. Contactez-nous pour une suppression partielle.');
  }
  const files = solo.length
    ? await db.query<{ bucket: 'documents' | 'reports'; path: string }>(
        `select 'documents' as bucket, storage_path as path from public.documents where company_id = any($1::uuid[])
         union all select 'reports', r.storage_path from public.reports r join public.audits a on a.id = r.audit_id where a.company_id = any($1::uuid[])`, [solo.map((c) => c.company_id)])
    : [];
  const personalFiles = await db.query<{ path: string }>(`select r.storage_path as path from public.reports r join public.audits a on a.id = r.audit_id where a.owner_user_id = $1 and a.company_id is null`, [user.id]);

  await db.transaction(async (tx) => {
    // Suppression en cascade (membres, établissements, audits, documents, paie…).
    for (const c of solo) await tx.query(`delete from public.companies where id = $1`, [c.company_id]);
    await tx.query(`delete from public.audits where owner_user_id = $1 and company_id is null`, [user.id]);
    await tx.query(`update public.leads set email = 'supprime-' || left(md5(email), 12) || '@anonyme.invalid', first_name = null, phone = null, user_id = null where lower(email) = $1 or user_id = $2`,
      [normalizeEmail(user.email), user.id]);
    await tx.query(`update public.audit_claims set email = 'supprime@anonyme.invalid' where lower(email) = $1`, [normalizeEmail(user.email)]);
    await tx.query(`insert into public.privacy_requests (kind, user_email_hash, status) values ('suppression', $1, 'effectuee')`, [hash(user.email)]);
    await tx.query(`delete from auth.users where id = $1`, [user.id]); // cascade : profil, adhésions, notifications, sessions locales
  });
  for (const f of files) await store.remove(f.bucket, f.path).catch(() => undefined);
  for (const f of personalFiles) await store.remove('reports', f.path).catch(() => undefined);
  return { deletedCompanies: solo.length };
}

/** Purge périodique selon les durées de conservation (script `pnpm purge`). */
export async function purgeExpired(db: Queryable): Promise<Record<string, number>> {
  const count = async (sql: string, params: unknown[]) => (await db.query(sql, params)).length;
  return {
    auditsAnonymes: await count(`delete from public.audits where owner_user_id is null and company_id is null and lead_id is null and created_at < now() - make_interval(days => $1) returning id`, [RETENTION.anonymousAuditDays]),
    prospectsAnonymises: await count(`update public.leads set email = 'supprime-' || left(md5(email), 12) || '@anonyme.invalid', first_name = null, phone = null
                                       where user_id is null and email not like '%@anonyme.invalid' and last_activity_at < now() - make_interval(days => $1) returning id`, [RETENTION.leadInactiveDays]),
    reclamationsExpirees: await count(`delete from public.audit_claims where claimed_at is null and expires_at < now() - make_interval(days => $1) returning id`, [RETENTION.technicalDays]),
    tachesTerminees: await count(`delete from public.jobs where status in ('termine', 'echec') and updated_at < now() - make_interval(days => $1) returning id`, [RETENTION.technicalDays]),
    limitesDebit: await count(`delete from public.rate_limits where window_start < now() - interval '1 day' returning key`, []),
  };
}

/** Purge des tables de l'authentification locale (développement). */
export async function purgeLocalAuth(db: Queryable): Promise<number> {
  const a = await db.query(`delete from local_auth.magic_links where expires_at < now() - make_interval(days => $1) returning id`, [RETENTION.technicalDays]);
  const b = await db.query(`delete from local_auth.sessions where (revoked_at is not null or expires_at < now()) and created_at < now() - make_interval(days => $1) returning id`, [RETENTION.technicalDays]);
  return a.length + b.length;
}

// ---------------------------------------------------------------------------
// Limitation de débit
// ---------------------------------------------------------------------------

/** Fenêtre fixe : renvoie false si la limite est dépassée. Clé = action + identifiant (IP haché, utilisateur…). */
export async function rateLimit(db: Queryable, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const [r] = await db.query<{ hits: number }>(
    `insert into public.rate_limits (key, window_start, hits) values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1 returning hits`, [key.slice(0, 200), windowSeconds]);
  return (r?.hits ?? 0) <= limit;
}

export function hashIp(ip: string | null): string {
  return createHash('sha256').update(`${process.env.IP_HASH_SALT ?? 'sel'}|${ip ?? 'inconnue'}`).digest('hex').slice(0, 24);
}
