import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Forbidden, NotFound } from './account-service';
import { requireInternal } from './admin-service';
import type { AuthUser } from './auth/local-core';
import type { Database, Queryable } from './db/database';
import { linkEmail, type Mailer } from './mail';
import { renderMandatePdf } from './report/mandate-pdf';
import type { SignatureProvider } from './signature';
import type { FileStore } from './storage';

/**
 * Conversion (cahier des charges §10) : dossier, conditions, mandat signé électroniquement,
 * justificatifs, analyse, statuts horodatés et notifiés, remboursement réel, commission.
 */

export const CASE_STATUS_LABELS: Record<string, string> = {
  nouveau: 'Nouveau', informations_manquantes: 'Informations manquantes', en_analyse: 'En analyse', a_valider_expert: 'À valider par un expert',
  pret_a_deposer: 'Prêt à déposer', depose: 'Déposé', en_attente_reponse: 'En attente de réponse', accepte: 'Accepté', refuse: 'Refusé',
  rembourse: 'Remboursé', cloture: 'Clôturé',
};

export const startSchema = z.object({
  companyId: z.string().uuid(),
  auditId: z.string().uuid(),
  signerFirstName: z.string().trim().min(1, 'Prénom du signataire obligatoire').max(80),
  signerLastName: z.string().trim().min(1, 'Nom du signataire obligatoire').max(80),
  signerFunction: z.string().trim().min(2, 'Fonction obligatoire').max(80),
  declaration: z.literal(true, { errorMap: () => ({ message: 'Vous devez déclarer être habilité à engager l’entreprise' }) }),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Vous devez accepter les conditions' }) }),
});

export async function activeTerms(db: Queryable) {
  const [t] = await db.query<{ id: string; version: number; title: string; body: string }>(`select id::text, version, title, body from public.commercial_texts where key = 'conditions_mandat' and active`);
  return t ?? null;
}

export async function commissionRate(db: Queryable): Promise<number> {
  return (await db.query<{ r: number }>(`select commission_rate::float8 r from public.commercial_settings where id = 1`))[0]!.r;
}

/** Démarre la récupération : dossier + mandat (taux et conditions figés) + envoi en signature si activée. */
export async function startRecovery(db: Database, store: FileStore, signature: SignatureProvider, mailer: Mailer, user: AuthUser, input: z.input<typeof startSchema>) {
  const d = startSchema.parse(input);
  const terms = await activeTerms(db);
  if (!terms) throw new Forbidden('Les conditions du mandat ne sont pas encore publiées : la démarche ne peut pas être engagée pour le moment.');
  const rate = await commissionRate(db);
  const ctx = await db.asUser(user.id, async (q) => {
    const [m] = await q.query<{ role: string }>(`select role::text from public.company_members where company_id = $1 and user_id = auth.uid()`, [d.companyId]);
    if (m?.role !== 'proprietaire') throw new Forbidden('Seul un propriétaire de l’entreprise peut engager la démarche.');
    const [a] = await q.query<{ run_id: string | null; company_id: string | null; is_demo: boolean }>(
      `select last_calculation_run_id::text as run_id, company_id::text, is_demo from public.audits where id = $1`, [d.auditId]);
    if (!a || a.company_id !== d.companyId || !a.run_id || a.is_demo) throw new Forbidden('Estimation non rattachée à cette entreprise ou non calculée.');
    const [c] = await q.query<{ legal_name: string; siren: string }>(`select legal_name, siren from public.companies where id = $1`, [d.companyId]);
    return { runId: a.run_id, company: c! };
  });

  const created = await db.transaction(async (tx) => {
    const [kase] = await tx.query<{ id: string }>(
      `insert into public.cases (company_id, audit_id, status, opened_by, title) values ($1, $2, 'nouveau', $3, $4) returning id::text`,
      [d.companyId, d.auditId, user.id, `Récupération – ${ctx.company.legal_name}`]).catch((e: Error) => {
      if (/cases_one_open_per_audit|duplicate key/.test(e.message)) throw new Forbidden('Une démarche est déjà en cours pour cette estimation.');
      throw e;
    });
    const [mandate] = await tx.query<{ id: string }>(
      `insert into public.mandates (company_id, case_id, commission_rate, terms_version, terms_text_id, provider, status, signer_first_name, signer_last_name, signer_email, signer_function, declaration_accepted_at)
       values ($1, $2, $3, $4, $5, $6, 'a_signer', $7, $8, $9, $10, now()) returning id::text`,
      [d.companyId, kase!.id, rate, `conditions_mandat-v${terms.version}`, terms.id, signature.name, d.signerFirstName, d.signerLastName, user.email, d.signerFunction]);
    return { caseId: kase!.id, mandateId: mandate!.id };
  });

  // Document du mandat (PDF) conservé parmi les documents de l'entreprise.
  const pdf = await renderMandatePdf({
    mandateId: created.mandateId, companyName: ctx.company.legal_name, siren: ctx.company.siren, signerName: `${d.signerFirstName} ${d.signerLastName}`,
    signerFunction: d.signerFunction, signerEmail: user.email, commissionRatePct: `${Math.round(rate * 1000) / 10} %`, termsTitle: terms.title,
    termsVersion: terms.version, termsBody: terms.body, auditRunId: ctx.runId, createdOn: new Date().toISOString().slice(0, 10),
  });
  const docId = await storeServerDocument(db, store, d.companyId, created.caseId, `mandat-${created.mandateId}.pdf`, pdf, 'mandat', user.id);
  await db.query(`update public.mandates set unsigned_document_id = $2 where id = $1`, [created.mandateId, docId]);

  let signatureState: 'envoyee' | 'desactivee' | 'erreur' = 'desactivee';
  if (signature.enabled) {
    try {
      const r = await signature.createRequest({ title: `Mandat ${ctx.company.legal_name}`, pdf, filename: `mandat-${created.mandateId}.pdf`,
        signer: { firstName: d.signerFirstName, lastName: d.signerLastName, email: user.email }, externalId: created.mandateId });
      await db.query(`update public.mandates set status = 'envoye', provider_request_id = $2, provider_status = $3 where id = $1`, [created.mandateId, r.requestId, r.status]);
      signatureState = 'envoyee';
    } catch (e) {
      console.error('signature', e);
      signatureState = 'erreur';
    }
  }
  await addEvent(db, created.caseId, d.companyId, 'ouverture', `Démarche engagée par ${user.email}.`, false, user.id);
  await notifyCompany(db, mailer, d.companyId, created.caseId, 'Votre démarche de récupération est ouverte', 'Nous avons bien reçu votre demande. Vous serez informé à chaque étape.');
  return { ...created, signature: signatureState };
}

/** Document produit par le serveur (mandat, mandat signé) rangé avec les documents de l'entreprise. */
async function storeServerDocument(db: Database, store: FileStore, companyId: string, caseId: string, name: string, bytes: Uint8Array, type: string, userId: string | null) {
  const sha = createHash('sha256').update(bytes).digest('hex');
  const [{ id }] = (await db.query<{ id: string }>(`select gen_random_uuid()::text as id`)) as [{ id: string }];
  const path = `${companyId}/${id}.pdf`;
  await store.put('documents', path, bytes, 'application/pdf');
  await db.query(
    `insert into public.documents (id, company_id, uploaded_by, storage_path, original_filename, mime_type, size_bytes, sha256, document_type, status, case_id, processed_at)
     values ($1, $2, $3, $4, $5, 'application/pdf', $6, $7, $8, 'valide', $9, now())`,
    [id, companyId, userId, path, name, bytes.length, sha, type, caseId]);
  return id;
}

async function addEvent(db: Queryable, caseId: string, companyId: string, type: string, message: string, internalOnly: boolean, actorId: string | null) {
  await db.query(`insert into public.case_events (case_id, company_id, event_type, message, internal_only, actor_id) values ($1, $2, $3, $4, $5, $6)`,
    [caseId, companyId, type, message, internalOnly, actorId]);
}

/** Notification dans l'espace de chaque membre et par e-mail (texte « email_statut_dossier » s'il est publié). */
async function notifyCompany(db: Database, mailer: Mailer, companyId: string, caseId: string, subject: string, message: string, origin = process.env.APP_URL ?? '') {
  const members = await db.query<{ user_id: string; email: string }>(`select m.user_id::text, u.email from public.company_members m join public.users u on u.id = m.user_id where m.company_id = $1`, [companyId]);
  const [tpl] = await db.query<{ body: string }>(`select body from public.commercial_texts where key = 'email_statut_dossier' and active`);
  for (const m of members) {
    await db.query(`insert into public.notifications (user_id, company_id, kind, payload) values ($1, $2, 'dossier', $3::jsonb)`, [m.user_id, companyId, JSON.stringify({ caseId, subject, message })]);
    try {
      await mailer.send(linkEmail({ to: m.email, subject, intro: tpl ? `${message}\n\n${tpl.body}` : message, cta: 'Voir mon dossier', url: `${origin}/espace/dossiers/${caseId}` }));
    } catch (e) {
      console.error('notification e-mail', e); // la notification dans l'espace reste enregistrée
    }
  }
  await db.query(`update public.case_events set notified_at = now() where case_id = $1 and notified_at is null`, [caseId]);
}

// ---------------------------------------------------------------------------
// Webhook de signature
// ---------------------------------------------------------------------------

export async function handleSignatureWebhook(db: Database, store: FileStore, signature: SignatureProvider, mailer: Mailer, rawBody: string, header: string | null): Promise<'ignore' | 'signe' | 'refuse' | 'expire'> {
  if (!signature.enabled || !signature.verifyWebhook(rawBody, header)) throw new Forbidden('Signature du webhook invalide');
  const ev = signature.parseWebhook(rawBody);
  if (!ev.requestId) return 'ignore';
  const [m] = await db.query<{ id: string; company_id: string; case_id: string; status: string }>(
    `select id::text, company_id::text, case_id::text, status::text from public.mandates where provider_request_id = $1`, [ev.requestId]);
  if (!m || m.status === 'signe') return 'ignore';
  if (ev.event === 'signature_request.done') {
    const signed = await signature.downloadSigned(ev.requestId);
    const docId = await storeServerDocument(db, store, m.company_id, m.case_id, `mandat-signe-${m.id}.pdf`, signed, 'mandat_signe', null);
    await db.query(`update public.mandates set status = 'signe', signed_at = now(), signed_document_id = $2, provider_status = 'done' where id = $1`, [m.id, docId]);
    await addEvent(db, m.case_id, m.company_id, 'mandat_signe', 'Mandat signé électroniquement.', false, null);
    await notifyCompany(db, mailer, m.company_id, m.case_id, 'Mandat signé', 'Votre mandat a été signé. Nous engageons l’analyse de votre dossier.');
    return 'signe';
  }
  const map: Record<string, 'refuse' | 'expire'> = { 'signature_request.declined': 'refuse', 'signature_request.expired': 'expire' };
  const status = map[ev.event];
  if (!status) return 'ignore';
  await db.query(`update public.mandates set status = $2, provider_status = $3 where id = $1`, [m.id, status, ev.event]);
  await addEvent(db, m.case_id, m.company_id, 'mandat_' + status, status === 'refuse' ? 'Signature du mandat refusée.' : 'Demande de signature expirée.', false, null);
  return status;
}

// ---------------------------------------------------------------------------
// Espace client
// ---------------------------------------------------------------------------

export async function listCompanyCases(db: Database, userId: string, companyId: string) {
  return db.asUser(userId, (q) => q.query<{ id: string; status: string; title: string | null; created_at: string; updated_at: string; mandate_status: string | null }>(
    `select c.id::text, c.status::text, c.title, c.created_at::text, c.updated_at::text,
            (select m.status::text from public.mandates m where m.case_id = c.id order by m.created_at desc limit 1) as mandate_status
       from public.cases c where c.company_id = $1 order by c.created_at desc`, [companyId]));
}

export async function caseForClient(db: Database, userId: string, caseId: string) {
  if (!z.string().uuid().safeParse(caseId).success) throw new NotFound();
  return db.asUser(userId, async (q) => {
    const [c] = await q.query<{ id: string; company_id: string; audit_id: string | null; status: string; title: string | null; created_at: string; company_name: string; verification_status: string; can_write: boolean; role: string | null }>(
      `select c.id::text, c.company_id::text, c.audit_id::text, c.status::text, c.title, c.created_at::text, co.legal_name as company_name, co.verification_status,
              app.can_write_company(c.company_id) as can_write, app.company_role(c.company_id)::text as role
         from public.cases c join public.companies co on co.id = c.company_id where c.id = $1`, [caseId]);
    if (!c) throw new NotFound('Dossier introuvable');
    // RLS : les commentaires internes ne sont pas visibles du client.
    const events = await q.query<{ id: string; created_at: string; event_type: string; from_status: string | null; to_status: string | null; message: string | null; internal_only: boolean }>(
      `select id::text, created_at::text, event_type, from_status::text, to_status::text, message, internal_only from public.case_events where case_id = $1 order by created_at, id`, [caseId]);
    const mandate = (await q.query<{ id: string; status: string; commission_rate: number; terms_version: string; provider: string; signed_at: string | null; unsigned_document_id: string | null; signed_document_id: string | null }>(
      `select id::text, status::text, commission_rate::float8, terms_version, provider, signed_at::text, unsigned_document_id::text, signed_document_id::text from public.mandates where case_id = $1 order by created_at desc limit 1`, [caseId]))[0] ?? null;
    const documents = await q.query<{ id: string; original_filename: string; document_type: string | null; created_at: string }>(
      `select id::text, original_filename, document_type, created_at::text from public.documents where case_id = $1 order by created_at`, [caseId]);
    const recoveries = await q.query<{ id: string; amount_reimbursed: number; received_on: string; commission: number | null; commission_status: string | null }>(
      `select r.id::text, r.amount_reimbursed::float8, r.received_on::text, k.amount::float8 as commission, k.status as commission_status
         from public.recoveries r left join public.commissions k on k.recovery_id = r.id where r.case_id = $1 order by r.received_on`, [caseId]);
    return { case: c, events, mandate, documents, recoveries };
  });
}

/** Justificatif déposé dans le cadre d'un dossier (dépôt standard + rattachement au dossier). */
export async function attachDocumentToCase(db: Database, userId: string, caseId: string, documentId: string) {
  const r = await db.asUser(userId, async (q) => {
    const [ok] = await q.query<{ ok: boolean }>(`select exists(select 1 from public.cases c join public.documents d on d.company_id = c.company_id where c.id = $1 and d.id = $2) as ok`, [caseId, documentId]);
    if (!ok?.ok) throw new Forbidden('Document ou dossier introuvable');
    return true;
  });
  if (r) await db.query(`update public.documents set case_id = $2 where id = $1 and case_id is null`, [documentId, caseId]);
}

export async function listNotifications(db: Database, userId: string) {
  return db.asUser(userId, (q) => q.query<{ id: string; payload: { caseId?: string; subject?: string; message?: string }; read_at: string | null; created_at: string }>(
    `select id::text, payload, read_at::text, created_at::text from public.notifications where user_id = auth.uid() order by created_at desc limit 30`));
}

export async function markNotificationsRead(db: Database, userId: string) {
  await db.asUser(userId, (q) => q.query(`update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null`));
}

export async function companyFinancials(db: Database, userId: string, companyId: string) {
  return db.asUser(userId, (q) => q.query<{ recovered: number; commissions_due: number; commissions_paid: number }>(
    `select coalesce((select sum(amount_reimbursed) from public.recoveries where company_id = $1), 0)::float8 as recovered,
            coalesce((select sum(amount) from public.commissions where company_id = $1 and status in ('facturable', 'facturee')), 0)::float8 as commissions_due,
            coalesce((select sum(amount) from public.commissions where company_id = $1 and status = 'payee'), 0)::float8 as commissions_paid`, [companyId]).then((r) => r[0]!));
}

// ---------------------------------------------------------------------------
// Back-office
// ---------------------------------------------------------------------------

export async function listCasesAdmin(db: Database, userId: string) {
  await requireInternal(db, userId);
  return db.asUser(userId, (q) => q.query<{ id: string; status: string; company_name: string; siren: string; verification_status: string; created_at: string; updated_at: string; mandate_status: string | null; estimated_high: number | null }>(
    `select c.id::text, c.status::text, co.legal_name as company_name, co.siren, co.verification_status, c.created_at::text, c.updated_at::text,
            (select m.status::text from public.mandates m where m.case_id = c.id order by m.created_at desc limit 1) as mandate_status,
            (r.totals #>> '{pastRecovery,high}')::float8 as estimated_high
       from public.cases c join public.companies co on co.id = c.company_id
       left join public.audits a on a.id = c.audit_id left join public.calculation_runs r on r.id = a.last_calculation_run_id
      order by c.updated_at desc`));
}

const STATUS = z.enum(['nouveau', 'informations_manquantes', 'en_analyse', 'a_valider_expert', 'pret_a_deposer', 'depose', 'en_attente_reponse', 'accepte', 'refuse', 'rembourse', 'cloture']);

export async function changeCaseStatus(db: Database, mailer: Mailer, userId: string, caseId: string, status: string, message: string | null) {
  await requireInternal(db, userId);
  const s = STATUS.parse(status);
  const [c] = await db.asUser(userId, (q) => q.query<{ company_id: string }>(`update public.cases set status = $2 where id = $1 returning company_id::text`, [caseId, s]))
    .catch((e: Error) => { throw new Forbidden(e.message.replace(/^error: /, '')); });
  if (!c) throw new NotFound('Dossier introuvable');
  if (message) await db.asUser(userId, (q) => addEvent(q, caseId, c.company_id, 'message', message, false, userId));
  await notifyCompany(db, mailer, c.company_id, caseId, `Votre dossier : ${CASE_STATUS_LABELS[s]}`, message ?? `Le statut de votre dossier est désormais « ${CASE_STATUS_LABELS[s]} ».`);
}

export async function addCaseNote(db: Database, mailer: Mailer, userId: string, caseId: string, kind: 'commentaire_interne' | 'demande_piece', message: string) {
  await requireInternal(db, userId);
  const msg = z.string().trim().min(3).max(4000).parse(message);
  const [c] = await db.asUser(userId, (q) => q.query<{ company_id: string }>(`select company_id::text from public.cases where id = $1`, [caseId]));
  if (!c) throw new NotFound('Dossier introuvable');
  await db.asUser(userId, (q) => addEvent(q, caseId, c.company_id, kind, msg, kind === 'commentaire_interne', userId));
  if (kind === 'demande_piece') await notifyCompany(db, mailer, c.company_id, caseId, 'Pièce demandée pour votre dossier', msg);
}

export async function setCompanyVerification(db: Database, userId: string, companyId: string, status: 'verifiee' | 'rejetee' | 'non_verifiee') {
  await requireInternal(db, userId);
  await db.asUser(userId, (q) => q.query(`update public.companies set verification_status = $2, verified_by = auth.uid(), verified_at = now() where id = $1`, [companyId, status]));
}

export const recoverySchema = z.object({
  amount: z.number().positive('Montant strictement positif').max(100_000_000),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proofDocumentId: z.string().uuid('Justificatif obligatoire'),
  opportunityId: z.string().uuid().nullable(),
});

/** Remboursement réellement encaissé, saisi par un administrateur avec justificatif : la commission est calculée en base. */
export async function recordRecovery(db: Database, mailer: Mailer, userId: string, caseId: string, input: z.input<typeof recoverySchema>) {
  await requireInternal(db, userId, 'administrateur');
  const d = recoverySchema.parse(input);
  const [c] = await db.asUser(userId, (q) => q.query<{ company_id: string }>(`select company_id::text from public.cases where id = $1`, [caseId]));
  if (!c) throw new NotFound('Dossier introuvable');
  const [mandate] = await db.query<{ commission_rate: number; status: string }>(`select commission_rate::float8, status::text from public.mandates where case_id = $1 order by created_at desc limit 1`, [caseId]);
  if (mandate?.status !== 'signe') throw new Forbidden('Aucun mandat signé pour ce dossier : aucune commission ne peut être due.');
  await db.asUser(userId, (q) => q.query(
    `insert into public.recoveries (company_id, case_id, opportunity_id, amount_reimbursed, received_on, proof_document_id, recorded_by) values ($1, $2, $3, $4, $5, $6, auth.uid())`,
    [c.company_id, caseId, d.opportunityId, d.amount, d.receivedOn, d.proofDocumentId]))
    .catch((e: Error) => { throw new Forbidden(/proof_document|foreign key/.test(e.message) ? 'Justificatif introuvable pour cette entreprise.' : e.message); });
  // La commission est calculée en base au taux figé dans le mandat signé (trigger).
  await notifyCompany(db, mailer, c.company_id, caseId, 'Remboursement enregistré', `Un remboursement de ${d.amount.toLocaleString('fr-FR')} € reçu le ${d.receivedOn} a été enregistré sur votre dossier.`);
}

export async function setCommissionStatus(db: Database, userId: string, commissionId: string, status: 'facturee' | 'payee' | 'annulee') {
  await requireInternal(db, userId, 'administrateur');
  const r = await db.asUser(userId, (q) => q.query(`update public.commissions set status = $2 where id = $1 returning id`, [commissionId, status]))
    .catch((e: Error) => { throw new Forbidden(e.message.replace(/^error: /, '')); });
  if (!r.length) throw new NotFound('Commission introuvable');
}

export async function caseForAdmin(db: Database, userId: string, caseId: string) {
  await requireInternal(db, userId);
  const detail = await caseForClient(db, userId, caseId);
  const commissions = await db.asUser(userId, (q) => q.query<{ id: string; recovery_id: string; rate: number; amount: number; status: string }>(
    `select k.id::text, k.recovery_id::text, k.rate::float8, k.amount::float8, k.status from public.commissions k join public.recoveries r on r.id = k.recovery_id where r.case_id = $1`, [caseId]));
  const opportunities = detail.case.audit_id ? await db.asUser(userId, (q) => q.query<{ id: string; name: string; year: number; validated_amount: number | null }>(
    `select o.id::text, o.detail ->> 'name' as name, o.year, o.validated_amount::float8 from public.opportunities o join public.audits a on a.last_calculation_run_id = o.calculation_run_id where a.id = $1 order by o.module_id, o.year`, [detail.case.audit_id])) : [];
  const companyDocuments = await db.asUser(userId, (q) => q.query<{ id: string; original_filename: string }>(
    `select id::text, original_filename from public.documents where company_id = $1 order by created_at desc`, [detail.case.company_id]));
  return { ...detail, commissions, opportunities, companyDocuments };
}
