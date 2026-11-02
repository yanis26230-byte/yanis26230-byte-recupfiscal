import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimPendingAudits, inviteMember } from '@/lib/account-service';
import { captureLead, createAudit, loadAudit, saveStep, submitAudit } from '@/lib/audit-service';
import { consumeMagicLink, createMagicLink, type AuthUser } from '@/lib/auth/local-core';
import { createDatabase, type Database } from '@/lib/db/database';
import { uploadDocument } from '@/lib/documents/service';
import { outboxMailer } from '@/lib/mail';
import { deleteMyAccount, exportMyData, purgeExpired, rateLimit } from '@/lib/privacy-service';
import { CONSENT_TEXT_VERSION } from '@/lib/questionnaire';
import { localFileStore, type FileStore } from '@/lib/storage';

let db: Database; let store: FileStore; let root: string;
const login = async (email: string) => { const l = await createMagicLink(db, email, '/'); if ('rateLimited' in l) throw new Error(); return (await consumeMagicLink(db, l.token))!.user; };

async function companyFor(email: string, siren: string): Promise<{ user: AuthUser; companyId: string; auditId: string }> {
  const a = await createAudit(db, { company: { siren, legalName: `Société ${siren}`, legalForm: null, nafCode: null, sector: 'autre', createdOn: null, headcountRange: null, source: 'manuel' },
    establishments: [{ key: 'e', siret: null, address: '', postalCode: '', city: 'X', inseeCode: null, concerned: true }], today: '2026-11-02' });
  const { filled } = await loadAudit(db, a.auditId, { token: a.token });
  for (const y of ['2024', '2025', '2026']) { filled.entreprise.headcountByYear[y] = 1; filled.salaires.years[y]!.brackets.lt_1_1 = { count: 1, partTimeSharePct: 0, partTimeRatioPct: null }; }
  filled.recapitulatif = { consent: true, consentTextVersion: CONSENT_TEXT_VERSION };
  for (const s of ['entreprise', 'salaires', 'recapitulatif'] as const) await saveStep(db, a.auditId, { token: a.token }, s, filled[s]);
  await submitAudit(db, a.auditId, { token: a.token }, '2026-11-02');
  await captureLead(db, a.auditId, { token: a.token }, { email, firstName: 'Paul', phone: '0600000000', consent: true });
  const user = await login(email);
  await claimPendingAudits(db, user);
  const companyId = (await db.query<{ id: string }>(`select id::text from companies where siren = $1`, [siren]))[0]!.id;
  return { user, companyId, auditId: a.auditId };
}

beforeAll(async () => { db = await createDatabase({ pgliteDataDir: null }); root = mkdtempSync(join(tmpdir(), 'rf-priv-')); store = localFileStore(root); });
afterAll(async () => db?.close());

describe('Export RGPD', () => {
  it('contient les données de l’utilisateur et uniquement les siennes', async () => {
    const a = await companyFor('export@a.fr', '552100554');
    await companyFor('autre@b.fr', '732829320');
    const data = await exportMyData(db, a.user);
    expect(data.profile).toMatchObject({ email: 'export@a.fr' });
    expect(data.memberships).toHaveLength(1);
    expect(data.audits).toHaveLength(1);
    expect(data.leads).toMatchObject([{ email: 'export@a.fr', consent: true }]);
    const json = JSON.stringify(data);
    expect(json).not.toContain('autre@b.fr');
    expect(json).not.toContain('732829320');
  });
});

describe('Suppression du compte', () => {
  it('supprime profil, entreprise solo, documents (fichiers compris), et anonymise le prospect', async () => {
    const a = await companyFor('efface@c.fr', '443061841');
    await uploadDocument(db, store, a.user.id, a.companyId, { name: 'dsn.txt', bytes: Buffer.from("S10.G00.00.001,'X'\nS20.G00.05.005,'01012025'\n") });
    await inviteMember(db, outboxMailer(db), a.user, a.companyId, { email: 'invite@c.fr', role: 'collaborateur' }, 'http://t');
    const [doc] = await db.query<{ storage_path: string }>(`select storage_path from documents where company_id = $1`, [a.companyId]);
    expect(existsSync(join(root, 'documents', doc!.storage_path))).toBe(true);
    expect(await deleteMyAccount(db, store, a.user)).toEqual({ deletedCompanies: 1 });
    expect(await db.query(`select 1 from users where id = $1`, [a.user.id])).toHaveLength(0);
    expect(await db.query(`select 1 from companies where id = $1`, [a.companyId])).toHaveLength(0);
    expect(await db.query(`select 1 from audits where id = $1`, [a.auditId])).toHaveLength(0);
    expect(existsSync(join(root, 'documents', doc!.storage_path))).toBe(false);
    const leads = await db.query<{ email: string; phone: string | null; first_name: string | null }>(`select email, phone, first_name from leads where email like 'supprime-%'`);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ phone: null, first_name: null });
    expect(JSON.stringify(await db.query(`select * from leads`))).not.toContain('efface@c.fr');
    expect(await db.query(`select status from privacy_requests where kind = 'suppression'`)).toEqual([{ status: 'effectuee' }]);
  });
  it('refusée pour le dernier propriétaire d’une entreprise partagée', async () => {
    const a = await companyFor('patron@d.fr', '542065479');
    const b = await login('collegue@d.fr');
    await db.query(`insert into company_members (user_id, company_id, role) values ($1, $2, 'collaborateur')`, [b.id, a.companyId]);
    await expect(deleteMyAccount(db, store, a.user)).rejects.toThrow(/seul propriétaire/);
    // Le collaborateur, lui, peut supprimer son compte ; l'entreprise reste.
    await deleteMyAccount(db, store, b);
    expect(await db.query(`select 1 from companies where id = $1`, [a.companyId])).toHaveLength(1);
  });
  it('refusée si une démarche est engagée (conservation légale) ; refusée pour l’équipe interne', async () => {
    const a = await companyFor('dossier@e.fr', '356000000');
    await db.query(`insert into cases (company_id, audit_id) values ($1, $2)`, [a.companyId, a.auditId]);
    await expect(deleteMyAccount(db, store, a.user)).rejects.toThrow(/conservées/);
    const admin = await login('admin@p.fr');
    await db.query(`update users set internal_role = 'administrateur' where id = $1`, [admin.id]);
    await expect(deleteMyAccount(db, store, admin)).rejects.toThrow(/équipe interne/);
  });
});

describe('Durées de conservation et limitation de débit', () => {
  it('purge les audits anonymes anciens et anonymise les prospects inactifs', async () => {
    const a = await createAudit(db, { company: { siren: '552100554', legalName: 'Vieux', legalForm: null, nafCode: null, sector: 'autre', createdOn: null, headcountRange: null, source: 'manuel' },
      establishments: [{ key: 'e', siret: null, address: '', postalCode: '', city: 'X', inseeCode: null, concerned: true }], today: '2026-11-02' });
    await db.query(`update audits set created_at = now() - interval '400 days' where id = $1`, [a.auditId]);
    await db.query(`insert into leads (email, consent, consent_text_version, last_activity_at) values ('ancien@f.fr', true, 'v1', now() - interval '4 years')`);
    const r = await purgeExpired(db);
    expect(r.auditsAnonymes).toBe(1);
    expect(r.prospectsAnonymises).toBe(1);
    expect(await db.query(`select 1 from leads where email = 'ancien@f.fr'`)).toHaveLength(0);
  });
  it('fenêtre fixe : au-delà de la limite, refus', async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(db, 'test:ip1', 3, 60));
    expect(results).toEqual([true, true, true, false]);
    expect(await rateLimit(db, 'test:ip2', 3, 60)).toBe(true);
  });
});
