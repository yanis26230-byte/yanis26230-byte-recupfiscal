import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, Page, renderToBuffer, Text } from '@react-pdf/renderer';
import * as React from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptInvitation, claimPendingAudits, inviteMember } from '@/lib/account-service';
import { createAdvancedAudit, createAudit, getResults, loadAudit, saveStep, submitAudit } from '@/lib/audit-service';
import { consumeMagicLink, createMagicLink, type AuthUser } from '@/lib/auth/local-core';
import { createDatabase, type Database } from '@/lib/db/database';
import { detectFileKind } from '@/lib/documents/detect';
import { parseDsn, pseudonymize } from '@/lib/documents/dsn';
import { rowsToPayrollFields, splitCsv, templateCsv } from '@/lib/documents/payroll-template';
import { extractAtRates } from '@/lib/documents/pdf-text';
import {
  decideFields, getDocumentWithFields, listDocuments, payrollSummary, processPendingJobs, saveManualPayroll, uploadDocument, UploadRejected,
} from '@/lib/documents/service';
import { outboxMailer } from '@/lib/mail';
import { CONSENT_TEXT_VERSION } from '@/lib/questionnaire';
import { localFileStore, type FileStore } from '@/lib/storage';

const DSN = readFileSync(join(__dirname, 'fixtures/dsn-fictive.txt'));

async function atNotificationPdf(text: string[]) {
  return renderToBuffer(<Document><Page size="A4" style={{ padding: 40 }}>{text.map((t, i) => <Text key={i}>{t}</Text>)}</Page></Document>);
}

describe('Extracteurs déterministes', () => {
  it('détecte le format par le contenu', () => {
    expect(detectFileKind(Buffer.from('%PDF-1.7 ...'), 'x.pdf')).toBe('pdf');
    expect(detectFileKind(DSN, 'dsn.txt')).toBe('dsn');
    expect(detectFileKind(Buffer.from('identifiant;annee\nS1;2025'), 'paie.csv')).toBe('csv');
    expect(detectFileKind(Buffer.from([0x50, 0x4b, 3, 4, 0, 0]), 'paie.xlsx')).toBe('xlsx');
    expect(detectFileKind(Buffer.from('MZ\0\0binaire'), 'virus.pdf')).toBeNull();
    expect(detectFileKind(Buffer.from('%PDF-'), 'x.exe')).toBe('pdf'); // le contenu prime, jamais l'extension seule
    expect(detectFileKind(Buffer.from('bonjour'), 'notes.txt')).toBeNull();
  });
  it('lit le modèle de journal de paie, signale les lignes invalides et les doublons', () => {
    const csv = templateCsv() + 'S002;2025;13;1000;151,67;0;0;;\nS001;2025;2;2200;151,67;0;600;;CDI\n';
    const r = rowsToPayrollFields(splitCsv(csv));
    expect(r.recognised).toBe(true);
    expect(r.fields.map((f) => f.value)).toEqual([
      { employeeRef: 'S001', year: 2025, month: 1, gross: 2100.5, hoursPaid: 151.67, overtimeHours: 0, reductionApplied: 612.4, siret: null, contractType: 'CDI' },
      { employeeRef: 'S001', year: 2025, month: 2, gross: 2200, hoursPaid: 151.67, overtimeHours: 0, reductionApplied: 600, siret: null, contractType: 'CDI' },
    ]);
    expect(r.notes.join(' ')).toMatch(/Ligne 4 ignorée : mois invalide/);
    expect(r.notes.join(' ')).toMatch(/Doublon S001 2\/2025/);
    expect(rowsToPayrollFields(splitCsv('nom;salaire\nDupont;2000')).recognised).toBe(false);
  });
  it('lit une DSN sans jamais conserver le NIR ni le nom', () => {
    const r = parseDsn(DSN.toString('latin1'), 'societe-x');
    expect(r.recognised).toBe(true);
    expect(r.fields).toHaveLength(2);
    const v = r.fields[0]!.value as never as Record<string, unknown>;
    expect(v).toEqual({ employeeRef: pseudonymize('societe-x', 'MAT-001'), year: 2025, month: 3, gross: 1983.2, hoursPaid: 151.67, overtimeHours: 0, reductionApplied: 512.3, siret: '55210055400013', contractType: '01' });
    const json = JSON.stringify(r);
    for (const secret of ['1850599123456', '2900275987654', 'NOMFICTIF', 'AUTRENOM', 'MAT-001']) expect(json).not.toContain(secret);
    expect(r.fields.every((f) => f.confidence < 1)).toBe(true);
  });
  it('extrait un taux AT d’une notification (texte) avec une confiance prudente', async () => {
    const pdf = await atNotificationPdf(['Notification du taux de cotisation accidents du travail et maladies professionnelles', 'Établissement SIRET 552 100 554 00013', 'Taux net notifié : 2,10 %', 'Applicable à compter du 01/01/2025']);
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pages = (await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: false })).text as unknown as string[];
    const r = extractAtRates(pages);
    expect(r.fields.map((f) => [f.value, f.confidence])).toEqual([[{ siret: '55210055400013', year: 2025, rate: 0.021 }, 0.6]]);
    expect(extractAtRates(['Taux 2,10 % et taux 3,20 % pour l’année 2025']).fields).toEqual([]);
  });
});

describe('Import, validation et calcul avancé (critère 11)', () => {
  let db: Database; let store: FileStore; let owner: AuthUser; let accountant: AuthUser; let outsider: AuthUser; let companyId: string;
  const login = async (email: string) => { const l = await createMagicLink(db, email, '/'); if ('rateLimited' in l) throw new Error(); return (await consumeMagicLink(db, l.token))!.user; };

  beforeAll(async () => {
    db = await createDatabase({ pgliteDataDir: null });
    store = localFileStore(mkdtempSync(join(tmpdir(), 'rf-doc-')));
    owner = await login('patron@x.fr');
    // Entreprise créée par le rattachement d'un audit rapide calculé.
    const est = [{ key: 'e1', siret: '55210055400013', address: '1 rue', postalCode: '26000', city: 'Valence', inseeCode: '26362', concerned: true }];
    const a = await createAudit(db, { company: { siren: '552100554', legalName: 'Doc SARL', legalForm: null, nafCode: '43.22A', sector: 'batiment', createdOn: null, headcountRange: null, source: 'manuel' }, establishments: est, today: '2026-11-02', ownerUserId: owner.id });
    await db.query(`insert into audit_claims (audit_id, email, expires_at) values ($1, 'patron@x.fr', now() + interval '1 day')`, [a.auditId]);
    await claimPendingAudits(db, owner);
    companyId = (await db.query<{ id: string }>(`select id::text from companies where siren = '552100554'`))[0]!.id;
    const { filled } = await loadAudit(db, a.auditId, { userId: owner.id });
    for (const y of ['2024', '2025', '2026']) { filled.entreprise.headcountByYear[y] = 2; filled.salaires.years[y]!.brackets['1_1_1_3'] = { count: 2, partTimeSharePct: 0, partTimeRatioPct: null }; }
    filled.taux_at.rates = filled.taux_at.rates.map((r) => ({ ...r, appliedRatePct: 2.7, payrollMass: 40000 }));
    filled.recapitulatif = { consent: true, consentTextVersion: CONSENT_TEXT_VERSION };
    for (const s of ['entreprise', 'salaires', 'taux_at', 'recapitulatif'] as const) await saveStep(db, a.auditId, { userId: owner.id }, s, filled[s]);
    await submitAudit(db, a.auditId, { userId: owner.id }, '2026-11-02');
    const { url } = await inviteMember(db, outboxMailer(db), owner, companyId, { email: 'compta@x.fr', role: 'comptable_invite' }, 'http://t');
    accountant = await login('compta@x.fr');
    await acceptInvitation(db, accountant, url.split('/').pop()!);
    outsider = await login('autre@y.fr');
  });
  afterAll(async () => db?.close());

  it('refuse les fichiers non pris en charge, vides ou trop gros', async () => {
    await expect(uploadDocument(db, store, owner.id, companyId, { name: 'x.exe', bytes: Buffer.from('MZ\0\0') })).rejects.toBeInstanceOf(UploadRejected);
    await expect(uploadDocument(db, store, owner.id, companyId, { name: 'x.pdf', bytes: Buffer.alloc(0) })).rejects.toBeInstanceOf(UploadRejected);
    await expect(uploadDocument(db, store, owner.id, companyId, { name: 'x.pdf', bytes: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(16 * 1024 * 1024)]) })).rejects.toThrow(/volumineux/);
  });

  it('un non-membre ne dépose pas ; le comptable invité dépose ; doublon reconnu', async () => {
    await expect(uploadDocument(db, store, outsider.id, companyId, { name: 'dsn.txt', bytes: DSN })).rejects.toThrow(/membre/);
    const r = await uploadDocument(db, store, accountant.id, companyId, { name: 'dsn-mars.txt', bytes: DSN });
    expect(r.duplicate).toBe(false);
    expect((await uploadDocument(db, store, owner.id, companyId, { name: 'copie.txt', bytes: DSN })).duplicate).toBe(true);
  });

  it('la file de traitement extrait les champs, à valider, sans les utiliser', async () => {
    expect(await processPendingJobs(db, store)).toBe(1);
    const docs = await listDocuments(db, owner.id, companyId);
    expect(docs).toMatchObject([{ document_type: 'dsn', status: 'extrait', pending: 2, validated: 0 }]);
    expect(await payrollSummary(db, owner.id, companyId)).toEqual([]);
    expect(await listDocuments(db, outsider.id, companyId)).toEqual([]);
  });

  it('le comptable invité ne valide pas ; le propriétaire valide, corrige et rejette', async () => {
    const docId = (await listDocuments(db, owner.id, companyId))[0]!.id;
    const { fields } = await getDocumentWithFields(db, owner.id, docId);
    expect(fields.every((f) => f.status === 'a_valider' && f.extractor === 'regles:dsn-v1')).toBe(true);
    await expect(decideFields(db, accountant.id, [{ fieldId: fields[0]!.id, action: 'valider' }])).rejects.toThrow(/rôle/);
    const corrected = { ...(fields[1]!.value as object), overtimeHours: 4 };
    await decideFields(db, owner.id, [{ fieldId: fields[0]!.id, action: 'valider' }, { fieldId: fields[1]!.id, action: 'corriger', value: corrected }]);
    const after = await getDocumentWithFields(db, owner.id, docId);
    expect(after.fields.map((f) => f.status)).toEqual(['valide', 'corrige']);
    expect(await payrollSummary(db, owner.id, companyId)).toEqual([{ year: 2025, employees: 2, lines: 2, manual: 0, extracted: 2 }]);
    // La valeur d'origine reste intacte ; un rejet retire la ligne de paie.
    await expect(db.asUser(owner.id, (q) => q.query(`update extracted_fields set value = '{}' where id = $1`, [fields[0]!.id]))).rejects.toThrow(/immuable/);
    await decideFields(db, owner.id, [{ fieldId: fields[1]!.id, action: 'rejeter' }]);
    expect((await payrollSummary(db, owner.id, companyId))[0]!.lines).toBe(1);
    await decideFields(db, owner.id, [{ fieldId: fields[1]!.id, action: 'corriger', value: corrected }]);
  });

  it('valeur corrigée invalide refusée', async () => {
    const docId = (await listDocuments(db, owner.id, companyId))[0]!.id;
    const { fields } = await getDocumentWithFields(db, owner.id, docId);
    await expect(decideFields(db, owner.id, [{ fieldId: fields[0]!.id, action: 'corriger', value: { ...(fields[0]!.value as object), month: 13 } }])).rejects.toThrow();
  });

  it('notification AT validée : rattachée à l’établissement avec le document source', async () => {
    const pdf = await atNotificationPdf(['Notification du taux de cotisation accidents du travail', 'SIRET 55210055400013', 'Taux net notifié : 2,10 %', 'Année 2025']);
    await uploadDocument(db, store, owner.id, companyId, { name: 'notification-at-2025.pdf', bytes: pdf });
    await processPendingJobs(db, store);
    const doc = (await listDocuments(db, owner.id, companyId)).find((d) => d.document_type === 'notification_at')!;
    expect(doc.pending).toBe(1);
    const { fields } = await getDocumentWithFields(db, owner.id, doc.id);
    await decideFields(db, owner.id, [{ fieldId: fields[0]!.id, action: 'valider' }]);
    const [rate] = await db.query<{ notified_rate: string; notified_rate_validated: boolean }>(`select notified_rate::text, notified_rate_validated from establishment_rates where year = 2025`);
    expect(rate).toEqual({ notified_rate: '0.02100', notified_rate_validated: true });
  });

  it('PDF sans extraction automatique : saisie manuelle requise, jamais de valeur inventée', async () => {
    const pdf = await atNotificationPdf(['Bulletin de paie', 'Net à payer : 1 500,00 €']);
    await uploadDocument(db, store, owner.id, companyId, { name: 'bulletin.pdf', bytes: pdf });
    await processPendingJobs(db, store);
    const doc = (await listDocuments(db, owner.id, companyId)).find((d) => d.document_type === 'bulletin_paie')!;
    expect(doc.status).toBe('extraction_manuelle');
    expect(doc.pending + doc.validated).toBe(0);
  });

  it('saisie manuelle de la paie sans import (le mode manuel fonctionne toujours)', async () => {
    await saveManualPayroll(db, owner.id, companyId, { employeeRef: 'S900', contractType: 'CDI', establishmentId: null, year: 2024,
      months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, gross: 2000, hoursPaid: 151.67, overtimeHours: 0, reductionApplied: 0 })) });
    await expect(saveManualPayroll(db, accountant.id, companyId, { employeeRef: 'S901', contractType: null, establishmentId: null, year: 2024, months: [] })).rejects.toThrow(/rôle/);
    await expect(saveManualPayroll(db, owner.id, companyId, { employeeRef: 'Jean Dupont', contractType: null, establishmentId: null, year: 2024, months: [] })).rejects.toThrow();
    expect((await payrollSummary(db, owner.id, companyId)).find((r) => r.year === 2024)).toMatchObject({ lines: 12, manual: 12 });
  });

  it('audit avancé : reprend le mode rapide et calcule salarié par salarié sur les seules données validées', async () => {
    const pdf2 = Buffer.from(DSN.toString('latin1').replace("'01032025'", "'01042025'").replace(/MAT-00/g, 'MAT-10'));
    await uploadDocument(db, store, owner.id, companyId, { name: 'dsn-avril.txt', bytes: pdf2 });
    await processPendingJobs(db, store); // 2 lignes en attente de validation
    const { auditId } = await createAdvancedAudit(db, owner.id, companyId, '2026-11-02');
    const loaded = await loadAudit(db, auditId, { userId: owner.id });
    expect(loaded.audit.mode).toBe('avance');
    expect(loaded.answers.entreprise!.headcountByYear['2024']).toBe(2); // réponses du mode rapide reprises
    expect(loaded.answers.recapitulatif).toBeUndefined(); // consentement à renouveler
    await saveStep(db, auditId, { userId: owner.id }, 'recapitulatif', { consent: true, consentTextVersion: CONSENT_TEXT_VERSION });
    await submitAudit(db, auditId, { userId: owner.id }, '2026-11-02');
    const r = (await getResults(db, auditId, { userId: owner.id }))!;
    const m1 = r.opportunities.filter((o) => o.moduleId === 'M1_REDUCTION_GENERALE');
    // Jeu officiel non publié : bloqué, mais la paie validée a bien été transmise en mode avancé.
    expect(m1.every((o) => o.status === 'parametre_manquant')).toBe(true);
    const [run] = await db.query<{ frozen_input: { mode: string; advanced: { payrollLines: { validated: boolean }[] }; establishmentYears: { notifiedRateFromValidatedDocument: boolean; year: number }[] } }>(
      `select frozen_input from calculation_runs where id = $1`, [r.runId]);
    const fi = run!.frozen_input;
    expect(fi.mode).toBe('avance');
    expect(fi.advanced.payrollLines.filter((l) => l.validated)).toHaveLength(14); // 2 DSN mars + 12 saisies
    expect(fi.advanced.payrollLines.filter((l) => !l.validated)).toHaveLength(2); // DSN avril non validée : signalée, non utilisée
    expect(fi.establishmentYears.find((y) => y.year === 2025)!.notifiedRateFromValidatedDocument).toBe(true);
  });

  it('un utilisateur extérieur ne peut pas créer d’audit avancé pour l’entreprise', async () => {
    await expect(createAdvancedAudit(db, outsider.id, companyId, '2026-11-02')).rejects.toThrow();
  });
});
