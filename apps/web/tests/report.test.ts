import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessDenied, createAudit, createDemoAudit, submitAudit } from '@/lib/audit-service';
import { consumeMagicLink, createMagicLink } from '@/lib/auth/local-core';
import { createDatabase, type Database } from '@/lib/db/database';
import { generateReport, listReports, readReport } from '@/lib/report/report-service';
import { assertSafePath, localFileStore, type FileStore } from '@/lib/storage';

let db: Database;
let store: FileStore;
let root: string;
beforeAll(async () => { db = await createDatabase({ pgliteDataDir: null }); root = mkdtempSync(join(tmpdir(), 'rf-')); store = localFileStore(root); });
afterAll(async () => db?.close());

async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(doc, { mergePages: true });
  return text.replace(/\s+/g, ' ');
}

async function userId(email: string) {
  const l = await createMagicLink(db, email, '/');
  if ('rateLimited' in l) throw new Error();
  return (await consumeMagicLink(db, l.token))!.user.id;
}

describe('Rapport PDF (critère 10)', () => {
  let auditId: string; let token: string; let reportId: string; let text: string;

  it('génère un PDF complet pour la Boulangerie Démo', async () => {
    ({ auditId, token } = await createDemoAudit(db));
    const { runId } = await submitAudit(db, auditId, { token }, '2026-11-02');
    const r = await generateReport(db, store, auditId, { token }, new Date('2026-11-02T10:00:00Z'));
    reportId = r.id;
    expect(r.calculation_run_id).toBe(runId);
    const file = await readReport(db, store, r.id, async () => ({ token }));
    expect(file.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(file.filename).toMatch(/^rapport-boulangerie-demo.*\.pdf$/);
    text = await pdfText(file.bytes);
    expect(text).toContain(runId);
  });

  it.each([
    'Boulangerie Démo', 'SIREN 999000001', 'DÉMONSTRATION', 'Entreprise et périmètre', 'Estimation rapide', 'Données déclarées',
    'Opportunités et calculs', 'Détail du calcul', 'Hypothèses retenues', 'Paramètres réglementaires utilisés', 'smic_horaire',
    'Confiance et risques', 'Informations et documents à fournir', 'Commission indicative', 'Prochaines étapes', 'Traçabilité du calcul',
    'Réduction générale des cotisations patronales', 'Aide à l’apprentissage', 'Zonages consultés',
    'Ces résultats sont des estimations fondées sur les informations communiquées. Ils ne constituent ni une validation fiscale ou sociale, ni une garantie de remboursement.',
  ])('contient « %s »', (needle) => expect(text).toContain(needle));

  it('les trois indicateurs sont séparés et la commission porte sur le récupéré seulement', () => {
    expect(text).toMatch(/1\. Récupération passée estimée/i);
    expect(text).toMatch(/2\. Commission indicative/i);
    expect(text).toMatch(/3\. Économies futures \(offertes\)/i);
    expect(text).toContain('Les économies futures ne sont pas commissionnées');
  });

  it('régénérer renvoie le même rapport (un par calcul), conservé et listé', async () => {
    const again = await generateReport(db, store, auditId, { token });
    expect(again.id).toBe(reportId);
    expect(await listReports(db, auditId, { token })).toHaveLength(1);
  });

  it('un fichier altéré est refusé', async () => {
    const { writeFileSync } = await import('node:fs');
    const [r] = await db.query<{ storage_path: string }>(`select storage_path from reports where id = $1`, [reportId]);
    const path = join(root, 'reports', r!.storage_path);
    const { readFileSync } = await import('node:fs');
    const original = readFileSync(path);
    writeFileSync(path, Buffer.concat([original, Buffer.from('x')]));
    await expect(readReport(db, store, reportId, async () => ({ token }))).rejects.toThrow(/altéré/);
    writeFileSync(path, original);
  });

  it('hors démonstration : réservé aux comptes ayant accès à l’audit', async () => {
    const company = { siren: '552100554', legalName: 'Rapport SARL', legalForm: null, nafCode: null, sector: 'autre' as const, createdOn: null, headcountRange: null, source: 'manuel' as const };
    const owner = await userId('owner@rapport.fr');
    const r = await createAudit(db, { company, establishments: [{ key: 'e', siret: null, address: '', postalCode: '', city: 'X', inseeCode: null, concerned: true }], today: '2026-11-02', ownerUserId: owner });
    await db.query(`update audits set status = 'calcule', last_calculation_run_id = (select id from calculation_runs limit 1) where id = $1`, [r.auditId]);
    // Jeton anonyme seul : pas de rapport.
    await expect(generateReport(db, store, r.auditId, { token: r.token })).rejects.toBeInstanceOf(AccessDenied);
    // Autre compte : pas d'accès.
    const other = await userId('other@rapport.fr');
    await expect(generateReport(db, store, r.auditId, { userId: other })).rejects.toBeInstanceOf(AccessDenied);
    await expect(readReport(db, store, reportId, async () => ({ userId: other }))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('le stockage refuse les chemins dangereux', () => {
    for (const p of ['../etc/passwd', 'abc/x.pdf', `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/../x`]) expect(() => assertSafePath(p)).toThrow();
  });
});
