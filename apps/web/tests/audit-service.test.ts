import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@/lib/db/database';
import { seedDemoData } from '@/lib/db/demo-seed';
import {
  AccessDenied, captureLead, createAudit, createDemoAudit, getResults, loadAudit, saveStep, submitAudit, ValidationError,
} from '@/lib/audit-service';
import { BRACKETS, CONSENT_TEXT_VERSION } from '@/lib/questionnaire';

let db: Database;
beforeAll(async () => { db = await createDatabase({ pgliteDataDir: null }); });
afterAll(async () => db?.close());

const company = { siren: '552100554', legalName: 'Exemple SARL', legalForm: 'SARL', nafCode: '43.22A', sector: 'batiment' as const, createdOn: null, headcountRange: null, source: 'manuel' as const };
const establishments = [{ key: 'e1', siret: '55210055400013', address: '1 rue X', postalCode: '26000', city: 'Valence', inseeCode: '26362', concerned: true }];

describe('Audit anonyme du mode rapide', () => {
  let auditId: string; let token: string;

  it('la base locale contient migrations, seed officiel et données de démonstration', async () => {
    const [r] = await db.query<{ off: number; test: number }>(`select count(*) filter (where dataset = 'officiel')::int off, count(*) filter (where dataset = 'test')::int test from regulatory_parameters`);
    expect(r!.off).toBeGreaterThan(50);
    expect(r!.test).toBeGreaterThan(50);
    await seedDemoData(db); // idempotent
  });

  it('crée un audit sans compte, jamais rattaché à une entreprise en base', async () => {
    ({ auditId, token } = await createAudit(db, { company, establishments, today: '2026-11-02' }));
    const [a] = await db.query<{ company_id: string | null; anonymous_token_hash: string }>(`select company_id, anonymous_token_hash from audits where id = $1`, [auditId]);
    expect(a!.company_id).toBeNull();
    expect(a!.anonymous_token_hash).not.toContain(token);
    expect(await db.query(`select 1 from companies`)).toHaveLength(0);
  });

  it('refuse l’accès sans le bon jeton', async () => {
    await expect(loadAudit(db, auditId, { token: undefined })).rejects.toBeInstanceOf(AccessDenied);
    await expect(loadAudit(db, auditId, { token: 'mauvais' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(loadAudit(db, 'pas-un-uuid', { token })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('sauvegarde les réponses et les retrouve plus tard (reprise du questionnaire)', async () => {
    const { filled } = await loadAudit(db, auditId, { token: token });
    expect(filled.salaires.years['2024']).toBeDefined();
    filled.salaires.years['2024']!.brackets.lt_1_1 = { count: 4, partTimeSharePct: 25, partTimeRatioPct: 50 };
    await saveStep(db, auditId, { token: token }, 'salaires', filled.salaires);
    const again = await loadAudit(db, auditId, { token: token });
    expect(again.answers.salaires!.years['2024']!.brackets.lt_1_1).toEqual({ count: 4, partTimeSharePct: 25, partTimeRatioPct: 50 });
  });

  it('refuse des réponses mal formées, la modification du SIREN et l’écriture des métadonnées', async () => {
    await expect(saveStep(db, auditId, { token: token }, 'salaires', { years: { '2024': { brackets: { lt_1_1: { count: -3 } } } } })).rejects.toBeInstanceOf(ValidationError);
    const { answers } = await loadAudit(db, auditId, { token: token });
    await expect(saveStep(db, auditId, { token: token }, 'entreprise', { ...answers.entreprise, company: { ...company, siren: '732829320' } })).rejects.toThrow(/SIREN/);
    await expect(saveStep(db, auditId, { token: token }, '_meta' as never, { years: [1990] })).rejects.toBeInstanceOf(ValidationError);
  });

  it('bloque le calcul tant que les informations indispensables manquent', async () => {
    await expect(submitAudit(db, auditId, { token: token }, '2026-11-02')).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ blocking: true })]) });
  });

  it('calcule avec le jeu officiel : aucun montant tant que les paramètres ne sont pas publiés', async () => {
    const { filled } = await loadAudit(db, auditId, { token: token });
    for (const y of ['2024', '2025', '2026']) {
      filled.entreprise.headcountByYear[y] = 8;
      filled.salaires.years[y]!.brackets.lt_1_1 = { count: 6, partTimeSharePct: 0, partTimeRatioPct: null };
      filled.salaires.years[y]!.brackets['1_3_1_6'] = { count: 2, partTimeSharePct: 0, partTimeRatioPct: null };
      filled.reduction.years[y] = { known: true, amount: 5000 };
    }
    filled.recapitulatif = { consent: true, consentTextVersion: CONSENT_TEXT_VERSION };
    for (const s of ['entreprise', 'salaires', 'reduction', 'recapitulatif'] as const) await saveStep(db, auditId, { token: token }, s, filled[s]);
    const { runId } = await submitAudit(db, auditId, { token: token }, '2026-11-02');
    const r = (await getResults(db, auditId, { token: token }))!;
    expect(r.runId).toBe(runId);
    expect(r.dataset).toBe('officiel');
    expect(r.totals.pastRecovery).toEqual({ low: 0, central: 0, high: 0 });
    expect(r.opportunities.every((o) => o.amounts === null)).toBe(true);
    expect(r.yearsAwaitingParameters).toEqual([2024, 2025, 2026]);
    const stored = await db.query(`select 1 from opportunities where calculation_run_id = $1`, [runId]);
    expect(stored.length).toBe(r.opportunities.length);
    const brackets = await db.query(`select 1 from salary_brackets where audit_id = $1`, [auditId]);
    expect(brackets).toHaveLength(3 * BRACKETS.length);
  });

  it('un audit calculé n’est plus modifiable et un nouveau calcul renvoie le même run', async () => {
    const { filled } = await loadAudit(db, auditId, { token: token });
    await expect(saveStep(db, auditId, { token: token }, 'salaires', filled.salaires)).rejects.toThrow(/déjà été calculé/);
    const r1 = await getResults(db, auditId, { token: token });
    const { runId } = await submitAudit(db, auditId, { token: token }, '2026-11-03');
    expect(runId).toBe(r1!.runId);
  });

  it('enregistre le prospect dès la saisie de l’e-mail et le rattache à l’audit', async () => {
    await expect(captureLead(db, auditId, { token: token }, { email: 'pas-un-email', firstName: 'Léa', phone: '', consent: true })).rejects.toThrow(/e-mail/);
    await expect(captureLead(db, auditId, { token: token }, { email: 'lea@exemple.fr', firstName: 'Léa', phone: '', consent: false as never })).rejects.toThrow(/consentement/);
    const { leadId } = await captureLead(db, auditId, { token: token }, { email: ' Lea@Exemple.fr ', firstName: 'Léa', phone: '06 12 34 56 78', consent: true });
    const [lead] = await db.query<Record<string, unknown>>(`select email, first_name, phone, siren, consent, source from leads where id = $1`, [leadId]);
    expect(lead).toEqual({ email: 'lea@exemple.fr', first_name: 'Léa', phone: '06 12 34 56 78', siren: '552100554', consent: true, source: 'audit_rapide' });
    expect((await getResults(db, auditId, { token: token }))!.leadCaptured).toBe(true);
  });
});

describe('Audit de démonstration (Boulangerie Démo)', () => {
  it('produit des montants avec les paramètres fictifs du jeu test, identiques au moteur', async () => {
    const { auditId, token } = await createDemoAudit(db);
    await submitAudit(db, auditId, { token: token }, '2030-01-01'); // la date de référence de la démo est figée
    const r = (await getResults(db, auditId, { token: token }))!;
    expect(r.isDemo).toBe(true);
    expect(r.dataset).toBe('test');
    expect(r.asOfDate).toBe('2026-11-02');
    expect(r.totals.pastRecovery.central).toBeGreaterThan(0);
    const m2 = r.opportunities.find((o) => o.moduleId === 'M2_AIDES_EMBAUCHE' && o.status === 'estime')!;
    expect(m2.amounts!.central).toBe(3000);
    expect(r.commission.rate).toBe(0.25);
    expect(r.commission.commission.central).toBeCloseTo(r.totals.pastRecovery.central * 0.25, 1);
  });
});
