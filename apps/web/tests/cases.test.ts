import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimPendingAudits } from '@/lib/account-service';
import { publishText } from '@/lib/admin-service';
import { createAudit, loadAudit, saveStep, submitAudit } from '@/lib/audit-service';
import { consumeMagicLink, createMagicLink, type AuthUser } from '@/lib/auth/local-core';
import {
  addCaseNote, caseForAdmin, caseForClient, changeCaseStatus, companyFinancials, handleSignatureWebhook, listNotifications, recordRecovery,
  setCommissionStatus, setCompanyVerification, startRecovery,
} from '@/lib/case-service';
import { createDatabase, type Database } from '@/lib/db/database';
import { outboxMailer, type Mailer } from '@/lib/mail';
import { CONSENT_TEXT_VERSION } from '@/lib/questionnaire';
import { disabledSignature, yousignProvider } from '@/lib/signature';
import { localFileStore, type FileStore } from '@/lib/storage';

let db: Database; let store: FileStore; let mailer: Mailer;
let owner: AuthUser; let collab: AuthUser; let admin: AuthUser; let analyst: AuthUser; let companyId: string; let auditId: string;
const login = async (email: string) => { const l = await createMagicLink(db, email, '/'); if ('rateLimited' in l) throw new Error(); return (await consumeMagicLink(db, l.token))!.user; };
const start = (user: AuthUser, signature = disabledSignature, extra = {}) => startRecovery(db, store, signature, mailer, user, {
  companyId, auditId, signerFirstName: 'Camille', signerLastName: 'Martin', signerFunction: 'Gérante', declaration: true, acceptTerms: true, ...extra });

/** Doublure de l'API Yousign v3 : enregistre les appels et renvoie des réponses au format documenté. */
function fakeYousign() {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://api.test/v3', '');
    calls.push({ method: init.method ?? 'GET', path, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body instanceof FormData ? 'form-data' : null });
    const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
    if (path === '/signature_requests') return json({ id: 'sr_123', status: 'draft' });
    if (path === '/signature_requests/sr_123/documents') return json({ id: 'doc_1' });
    if (path === '/signature_requests/sr_123/signers') return json({ id: 'signer_1' });
    if (path === '/signature_requests/sr_123/activate') return json({ id: 'sr_123', status: 'ongoing' });
    if (path === '/signature_requests/sr_123/documents/download') return new Response(Buffer.from('%PDF-1.7 mandat signé'), { headers: { 'content-type': 'application/pdf' } });
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, provider: yousignProvider({ apiKey: 'cle', baseUrl: 'https://api.test/v3', webhookSecret: 'secret', fetchImpl }) };
}

beforeAll(async () => {
  db = await createDatabase({ pgliteDataDir: null });
  store = localFileStore(mkdtempSync(join(tmpdir(), 'rf-case-')));
  mailer = outboxMailer(db);
  owner = await login('gerante@x.fr'); collab = await login('collab@x.fr'); admin = await login('admin@p.fr'); analyst = await login('analyste@p.fr');
  await db.query(`update users set internal_role = 'administrateur' where email = 'admin@p.fr'`);
  await db.query(`update users set internal_role = 'analyste' where email = 'analyste@p.fr'`);
  const a = await createAudit(db, { company: { siren: '552100554', legalName: 'Mandat SARL', legalForm: 'SARL', nafCode: null, sector: 'autre', createdOn: null, headcountRange: null, source: 'manuel' },
    establishments: [{ key: 'e', siret: null, address: '', postalCode: '', city: 'Lille', inseeCode: null, concerned: true }], today: '2026-11-02' });
  auditId = a.auditId;
  const { filled } = await loadAudit(db, a.auditId, { token: a.token });
  for (const y of ['2024', '2025', '2026']) { filled.entreprise.headcountByYear[y] = 3; filled.salaires.years[y]!.brackets.lt_1_1 = { count: 3, partTimeSharePct: 0, partTimeRatioPct: null }; }
  filled.recapitulatif = { consent: true, consentTextVersion: CONSENT_TEXT_VERSION };
  for (const s of ['entreprise', 'salaires', 'recapitulatif'] as const) await saveStep(db, a.auditId, { token: a.token }, s, filled[s]);
  await submitAudit(db, a.auditId, { token: a.token }, '2026-11-02');
  await db.query(`insert into audit_claims (audit_id, email, expires_at) values ($1, 'gerante@x.fr', now() + interval '1 day')`, [a.auditId]);
  await claimPendingAudits(db, owner);
  companyId = (await db.query<{ id: string }>(`select id::text from companies`))[0]!.id;
  await db.query(`insert into company_members (user_id, company_id, role) values ($1, $2, 'collaborateur')`, [collab.id, companyId]);
});
afterAll(async () => db?.close());

describe('Engager la démarche (critère 12)', () => {
  it('impossible tant que les conditions du mandat ne sont pas publiées', async () => {
    await expect(start(owner)).rejects.toThrow(/conditions du mandat ne sont pas encore publiées/);
  });
  it('déclaration d’habilitation et acceptation obligatoires ; propriétaire uniquement', async () => {
    await publishText(db, admin.id, { key: 'conditions_mandat', title: 'Conditions générales du mandat', body: 'Texte de test des conditions, à faire valider par un professionnel du droit.' });
    await expect(start(owner, disabledSignature, { declaration: false })).rejects.toThrow(/habilité/);
    await expect(start(owner, disabledSignature, { acceptTerms: false })).rejects.toThrow(/accepter/);
    await expect(start(collab)).rejects.toThrow(/propriétaire/);
  });
  it('signature désactivée : le mandat reste « à signer », jamais simulé', async () => {
    const r = await start(owner);
    expect(r.signature).toBe('desactivee');
    const d = await caseForClient(db, owner.id, r.caseId);
    expect(d.case.status).toBe('nouveau');
    expect(d.mandate).toMatchObject({ status: 'a_signer', provider: 'desactive', commission_rate: 0.25, terms_version: 'conditions_mandat-v1', signed_at: null });
    expect(d.documents.map((x) => x.document_type)).toEqual(['mandat']);
    await expect(start(owner)).rejects.toThrow(/déjà en cours/);
    // Sans mandat signé : pas de dépôt, pas de remboursement.
    await setCompanyVerification(db, analyst.id, companyId, 'verifiee');
    for (const s of ['en_analyse', 'a_valider_expert', 'pret_a_deposer']) await changeCaseStatus(db, mailer, analyst.id, r.caseId, s, null);
    await expect(changeCaseStatus(db, mailer, analyst.id, r.caseId, 'depose', null)).rejects.toThrow(/aucun mandat signé/);
    const proof = d.documents[0]!.id;
    await expect(recordRecovery(db, mailer, admin.id, r.caseId, { amount: 1000, receivedOn: '2027-01-15', proofDocumentId: proof, opportunityId: null })).rejects.toThrow(/Aucun mandat signé/);
    await changeCaseStatus(db, mailer, analyst.id, r.caseId, 'cloture', 'Démarche abandonnée (test).');
  });
});

describe('Signature électronique Yousign (API v3, doublure)', () => {
  let caseId: string;
  const yousign = fakeYousign();
  const sign = (body: object, secret = 'secret') => { const raw = JSON.stringify(body); return { raw, header: 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex') }; };

  it('crée la demande, ajoute le document et le signataire, active', async () => {
    await db.query(`update commercial_settings set commission_rate = 0.25`);
    const r = await start(owner, yousign.provider);
    caseId = r.caseId;
    expect(r.signature).toBe('envoyee');
    expect(yousign.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /signature_requests', 'POST /signature_requests/sr_123/documents', 'POST /signature_requests/sr_123/signers', 'POST /signature_requests/sr_123/activate']);
    expect(yousign.calls[2]!.body).toMatchObject({ info: { first_name: 'Camille', last_name: 'Martin', email: 'gerante@x.fr', locale: 'fr' } });
    expect((await caseForClient(db, owner.id, caseId)).mandate).toMatchObject({ status: 'envoye', provider: 'yousign' });
  });
  it('webhook non authentifié refusé', async () => {
    const { raw } = sign({ event_name: 'signature_request.done', data: { signature_request: { id: 'sr_123' } } });
    await expect(handleSignatureWebhook(db, store, yousign.provider, mailer, raw, 'sha256=faux')).rejects.toThrow(/invalide/);
    const forged = sign({ event_name: 'signature_request.done', data: { signature_request: { id: 'sr_123' } } }, 'autre-secret');
    await expect(handleSignatureWebhook(db, store, yousign.provider, mailer, forged.raw, forged.header)).rejects.toThrow(/invalide/);
  });
  it('signature terminée : mandat signé, document signé conservé, client notifié', async () => {
    const { raw, header } = sign({ event_name: 'signature_request.done', data: { signature_request: { id: 'sr_123', external_id: 'x' } } });
    expect(await handleSignatureWebhook(db, store, yousign.provider, mailer, raw, header)).toBe('signe');
    expect(await handleSignatureWebhook(db, store, yousign.provider, mailer, raw, header)).toBe('ignore'); // idempotent
    const d = await caseForClient(db, owner.id, caseId);
    expect(d.mandate!.status).toBe('signe');
    expect(d.documents.map((x) => x.document_type)).toEqual(['mandat', 'mandat_signe']);
    expect(d.events.some((e) => e.event_type === 'mandat_signe')).toBe(true);
    expect((await listNotifications(db, owner.id)).some((n) => n.payload.subject === 'Mandat signé')).toBe(true);
    // Mandat signé figé.
    await expect(db.query(`update mandates set commission_rate = 0.5 where case_id = $1`, [caseId])).rejects.toThrow(/non modifiable|figé/);
  });

  describe('Dossier, remboursement réel et commission (critère 13)', () => {
    it('chronologie : demande de pièce visible, commentaire interne masqué ; le client ne change pas le statut', async () => {
      await addCaseNote(db, mailer, analyst.id, caseId, 'commentaire_interne', 'Vérifier le journal 2024 (interne).');
      await addCaseNote(db, mailer, analyst.id, caseId, 'demande_piece', 'Merci de déposer le journal de paie 2024.');
      const client = await caseForClient(db, owner.id, caseId);
      expect(client.events.map((e) => e.message)).toContain('Merci de déposer le journal de paie 2024.');
      expect(client.events.map((e) => e.message)).not.toContain('Vérifier le journal 2024 (interne).');
      expect((await caseForAdmin(db, analyst.id, caseId)).events.map((e) => e.message)).toContain('Vérifier le journal 2024 (interne).');
      await expect(changeCaseStatus(db, mailer, owner.id, caseId, 'en_analyse', null)).rejects.toThrow(/équipe interne/);
      const mails = await db.query<{ subject: string }>(`select subject from local_auth.outbox where to_email = 'gerante@x.fr'`);
      expect(mails.map((m) => m.subject)).toContain('Pièce demandée pour votre dossier');
    });
    it('transitions contrôlées, chaque changement horodaté et journalisé', async () => {
      await expect(changeCaseStatus(db, mailer, analyst.id, caseId, 'rembourse', null)).rejects.toThrow(/interdite/);
      for (const s of ['en_analyse', 'a_valider_expert', 'pret_a_deposer', 'depose', 'en_attente_reponse', 'accepte']) await changeCaseStatus(db, mailer, analyst.id, caseId, s, null);
      await expect(changeCaseStatus(db, mailer, analyst.id, caseId, 'rembourse', null)).rejects.toThrow(/sans remboursement/);
      const events = (await caseForClient(db, owner.id, caseId)).events.filter((e) => e.event_type === 'changement_statut').map((e) => e.to_status);
      expect(events).toEqual(['nouveau', 'en_analyse', 'a_valider_expert', 'pret_a_deposer', 'depose', 'en_attente_reponse', 'accepte']);
    });
    it('remboursement saisi par un administrateur, avec justificatif ; commission au taux du mandat', async () => {
      await db.query(`update commercial_settings set commission_rate = 0.30`); // changement ultérieur : sans effet sur ce mandat
      const proof = (await caseForAdmin(db, admin.id, caseId)).companyDocuments[0]!.id;
      await expect(recordRecovery(db, mailer, analyst.id, caseId, { amount: 4000, receivedOn: '2027-03-01', proofDocumentId: proof, opportunityId: null })).rejects.toThrow(/équipe interne/);
      await expect(recordRecovery(db, mailer, admin.id, caseId, { amount: 0, receivedOn: '2027-03-01', proofDocumentId: proof, opportunityId: null })).rejects.toThrow();
      await recordRecovery(db, mailer, admin.id, caseId, { amount: 4000, receivedOn: '2027-03-01', proofDocumentId: proof, opportunityId: null });
      const a = await caseForAdmin(db, admin.id, caseId);
      expect(a.commissions).toMatchObject([{ rate: 0.25, amount: 1000, status: 'facturable' }]);
      await changeCaseStatus(db, mailer, analyst.id, caseId, 'rembourse', 'Remboursement reçu.');
      expect(await companyFinancials(db, owner.id, companyId)).toEqual({ recovered: 4000, commissions_due: 1000, commissions_paid: 0 });
      await db.query(`update commercial_settings set commission_rate = 0.25`);
    });
    it('suivi de la commission : facturée puis payée, transitions contrôlées', async () => {
      const id = (await caseForAdmin(db, admin.id, caseId)).commissions[0]!.id;
      await expect(setCommissionStatus(db, admin.id, id, 'payee')).rejects.toThrow(/interdite/);
      await setCommissionStatus(db, admin.id, id, 'facturee');
      await setCommissionStatus(db, admin.id, id, 'payee');
      expect(await companyFinancials(db, owner.id, companyId)).toEqual({ recovered: 4000, commissions_due: 0, commissions_paid: 1000 });
    });
  });
});
