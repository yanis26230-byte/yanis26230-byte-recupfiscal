import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditForReview, createParameterDraft, fillParameter, importZoningDataset, indicators, listLeads, listParameters, missingParameters, publishParameter,
  publishText, reviewOpportunity, runReferenceTests, setInternalRole, setModuleEnabled, setReferenceStatus, updateCommercialSettings, validateParameter,
} from '@/lib/admin-service';
import { captureLead, createAudit, createDemoAudit, loadAudit, saveStep, submitAudit } from '@/lib/audit-service';
import { consumeMagicLink, createMagicLink, type AuthUser } from '@/lib/auth/local-core';
import { createDatabase, type Database } from '@/lib/db/database';
import { CONSENT_TEXT_VERSION } from '@/lib/questionnaire';

let db: Database; let admin1: AuthUser; let admin2: AuthUser; let analyst: AuthUser; let client: AuthUser; let auditId: string;
const login = async (email: string) => { const l = await createMagicLink(db, email, '/'); if ('rateLimited' in l) throw new Error(); return (await consumeMagicLink(db, l.token))!.user; };

beforeAll(async () => {
  db = await createDatabase({ pgliteDataDir: null });
  admin1 = await login('admin1@plateforme.fr'); admin2 = await login('admin2@plateforme.fr'); analyst = await login('analyste@plateforme.fr'); client = await login('client@x.fr');
  await db.query(`update users set internal_role = 'administrateur' where email in ('admin1@plateforme.fr', 'admin2@plateforme.fr')`);
  await db.query(`update users set internal_role = 'analyste' where email = 'analyste@plateforme.fr'`);
  // Un audit réel calculé avec prospect.
  const a = await createAudit(db, { company: { siren: '552100554', legalName: 'Client SARL', legalForm: null, nafCode: '56.10A', sector: 'restauration', createdOn: null, headcountRange: null, source: 'manuel' },
    establishments: [{ key: 'e', siret: null, address: '', postalCode: '', city: 'Nice', inseeCode: null, concerned: true }], today: '2026-11-02' });
  auditId = a.auditId;
  const { filled } = await loadAudit(db, a.auditId, { token: a.token });
  for (const y of ['2024', '2025', '2026']) { filled.entreprise.headcountByYear[y] = 4; filled.salaires.years[y]!.brackets.lt_1_1 = { count: 4, partTimeSharePct: 0, partTimeRatioPct: null }; }
  filled.recapitulatif = { consent: true, consentTextVersion: CONSENT_TEXT_VERSION };
  for (const s of ['entreprise', 'salaires', 'recapitulatif'] as const) await saveStep(db, a.auditId, { token: a.token }, s, filled[s]);
  await submitAudit(db, a.auditId, { token: a.token }, '2026-11-02');
  await captureLead(db, a.auditId, { token: a.token }, { email: 'prospect@client.fr', firstName: 'Pia', phone: '', consent: true });
});
afterAll(async () => db?.close());

describe('Accès au back-office', () => {
  it('refusé aux clients ; paramètres réservés aux administrateurs', async () => {
    await expect(indicators(db, client.id)).rejects.toThrow(/équipe interne/);
    await expect(listLeads(db, client.id)).rejects.toThrow();
    await expect(listParameters(db, analyst.id)).rejects.toThrow(/équipe interne/);
    expect((await indicators(db, analyst.id)).leads).toBe(1);
  });
});

describe('Indicateurs et prospects', () => {
  it('compte prospects, audits, et répartit par secteur', async () => {
    await createDemoAudit(db); // les démonstrations ne sont jamais comptées
    const i = await indicators(db, admin1.id);
    expect(i).toMatchObject({ leads: 1, quickAudits: 1, calculatedAudits: 1, mandatesSigned: 0, recovered: 0 });
    expect(i.bySector).toEqual([{ sector: 'restauration', audits: 1 }]);
    expect(i.conversion.auditToLead).toBe(100);
  });
  it('liste les prospects avec entreprise, secteur, effectif, mode et statut', async () => {
    const [l] = await listLeads(db, analyst.id);
    expect(l).toMatchObject({ email: 'prospect@client.fr', siren: '552100554', company_name: 'Client SARL', sector: 'restauration', headcount: '4', mode: 'rapide', status: 'nouveau', audit_id: auditId });
  });
});

describe('Paramètres réglementaires (quatre yeux, versions, publication)', () => {
  it('« règles à compléter » issues des calculs réels', async () => {
    const m = await missingParameters(db, admin1.id);
    expect(m.map((x) => x.key)).toContain('smic_horaire');
  });
  it('compléter une ligne à renseigner crée une nouvelle version brouillon', async () => {
    const [row] = (await listParameters(db, admin1.id, { key: 'duree_legale_mensuelle_heures' })).filter((p) => p.valid_from === '2025-01-01');
    const id = await fillParameter(db, admin1.id, row!.id, { value: 151.67, sourceUrl: 'https://www.legifrance.gouv.fr', verifiedAt: '2026-11-01' });
    const versions = await listParameters(db, admin1.id, { key: 'duree_legale_mensuelle_heures' });
    const v2025 = versions.filter((p) => p.valid_from === '2025-01-01');
    expect(v2025.map((p) => [p.version, p.status])).toEqual([[1, 'a_renseigner'], [2, 'brouillon']]);
    expect(v2025[1]!.id).toBe(id);
    expect(v2025[1]!.author_email).toBe('admin1@plateforme.fr');
  });
  it('validation par un second administrateur, publication après les cas de référence', async () => {
    const draft = (await listParameters(db, admin1.id, { status: 'brouillon', key: 'duree_legale_mensuelle_heures' }))[0]!;
    await expect(validateParameter(db, admin1.id, draft.id)).rejects.toThrow(/quatre yeux/);
    await expect(publishParameter(db, admin2.id, draft.id)).rejects.toThrow(/validé par un second/);
    await validateParameter(db, admin2.id, draft.id);
    const r = await publishParameter(db, admin1.id, draft.id);
    expect(r.references.length).toBeGreaterThan(0);
    expect(r.references.every((x) => x.passed)).toBe(true);
    const published = (await listParameters(db, admin1.id, { status: 'publie' }))[0]!;
    expect(published).toMatchObject({ key: 'duree_legale_mensuelle_heures', validator_email: 'admin2@plateforme.fr', value: 151.67 });
  });
  it('source https obligatoire', async () => {
    await expect(createParameterDraft(db, admin1.id, { key: 'pass_annuel', label: 'PASS', value: 1, unit: 'EUR', validFrom: '2026-01-01', validTo: '2026-12-31', moduleId: null, sourceUrl: 'http://x.fr', verifiedAt: '2026-11-01' })).rejects.toThrow();
  });
  it('les cas de référence de tous les modules passent et sont enregistrés', async () => {
    const r = await runReferenceTests(db, admin1.id, null);
    expect(r).toHaveLength(10);
    expect(r.every((x) => x.passed)).toBe(true);
  });
});

describe('Revue des opportunités', () => {
  it('l’analyste valide un montant distinct de l’estimation, avec trace', async () => {
    const { opportunities } = await auditForReview(db, analyst.id, auditId);
    const o = opportunities[0]!;
    await expect(reviewOpportunity(db, analyst.id, o.id, { decision: 'rejete', comment: '' })).rejects.toThrow(/Motif/);
    await reviewOpportunity(db, analyst.id, o.id, { decision: 'valide', validatedAmount: 1234.5, comment: 'Confirmé sur journal de paie' });
    const [row] = await db.query<{ review_status: string; validated_amount: string; reviewed_by: string; estimated_central: string | null }>(`select review_status::text, validated_amount::text, reviewed_by::text, estimated_central::text from opportunities where id = $1`, [o.id]);
    expect(row).toMatchObject({ review_status: 'valide', validated_amount: '1234.50', reviewed_by: analyst.id });
    await expect(reviewOpportunity(db, client.id, o.id, { decision: 'valide', validatedAmount: 1 })).rejects.toThrow();
  });
});

describe('Modules, zonages, commercial, utilisateurs internes', () => {
  it('activer et désactiver un module (administrateur)', async () => {
    await expect(setModuleEnabled(db, analyst.id, 'M4_ZONAGES', false)).rejects.toThrow();
    await setModuleEnabled(db, admin1.id, 'M4_ZONAGES', false);
    expect((await db.query<{ enabled: boolean }>(`select enabled from modules where id = 'M4_ZONAGES'`))[0]!.enabled).toBe(false);
    await setModuleEnabled(db, admin1.id, 'M4_ZONAGES', true);
  });
  it('import d’un zonage sourcé puis publication à quatre yeux', async () => {
    const r = await importZoningDataset(db, admin1.id, { zoneType: 'frr', validFrom: '2025-01-01', validTo: null, sourceUrl: 'https://www.legifrance.gouv.fr', sourceLabel: 'Arrêté de classement (exemple de test)' },
      'code_insee;commune\n26362;Valence\nXXXXX;Invalide\n2A004;Ajaccio\n');
    expect(r).toMatchObject({ imported: 2, rejected: ['Ligne 2 : code INSEE invalide'] });
    await expect(setReferenceStatus(db, admin1.id, 'zoning_datasets', r.datasetId, 'valide')).rejects.toThrow(/quatre yeux/);
    await setReferenceStatus(db, admin2.id, 'zoning_datasets', r.datasetId, 'valide');
    await setReferenceStatus(db, admin1.id, 'zoning_datasets', r.datasetId, 'publie');
  });
  it('conditions commerciales et textes versionnés', async () => {
    await expect(updateCommercialSettings(db, analyst.id, { commissionRate: 0.3, commissionOnFutureSavings: false, futureSavingsCommissionRate: null })).rejects.toThrow();
    await expect(updateCommercialSettings(db, admin1.id, { commissionRate: 0.2, commissionOnFutureSavings: true, futureSavingsCommissionRate: null })).rejects.toThrow(/taux/);
    await updateCommercialSettings(db, admin1.id, { commissionRate: 0.2, commissionOnFutureSavings: false, futureSavingsCommissionRate: null });
    expect((await db.query<{ r: string }>(`select commission_rate::text r from commercial_settings`))[0]!.r).toBe('0.2000');
    await publishText(db, admin1.id, { key: 'conditions_mandat', title: 'Conditions v1', body: 'Commission de 20 % sur les sommes réellement remboursées.' });
    await publishText(db, admin1.id, { key: 'conditions_mandat', title: 'Conditions v2', body: 'Commission sur les sommes réellement remboursées uniquement.' });
    const texts = await db.query<{ version: number; active: boolean }>(`select version, active from commercial_texts order by version`);
    expect(texts).toEqual([{ version: 1, active: false }, { version: 2, active: true }]);
    await updateCommercialSettings(db, admin1.id, { commissionRate: 0.25, commissionOnFutureSavings: false, futureSavingsCommissionRate: null });
  });
  it('rôles internes : administrateur uniquement, toujours au moins un administrateur', async () => {
    await expect(setInternalRole(db, analyst.id, 'client@x.fr', 'administrateur')).rejects.toThrow();
    await setInternalRole(db, admin1.id, 'client@x.fr', 'analyste');
    expect((await indicators(db, client.id)).leads).toBe(1);
    await setInternalRole(db, admin1.id, 'client@x.fr', null);
    await setInternalRole(db, admin1.id, 'admin2@plateforme.fr', null);
    await expect(setInternalRole(db, admin1.id, 'admin1@plateforme.fr', null)).rejects.toThrow(/au moins un administrateur/);
  });
});
