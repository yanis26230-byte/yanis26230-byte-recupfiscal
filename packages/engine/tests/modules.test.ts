import { describe, expect, it } from 'vitest';
import {
  assiettesOverlap, OFFICIAL_PARAMETERS_SEED, demoQuickInput, DEMO_AS_OF_DATE, m2AidesEmbauche, m3TauxAt, m4Zonages, m5EpargneSalariale, MODULE_REGISTRY,
  mealVouchers, profitSharingWithMatching, replayCalculation, runCalculation, TEST_PARAMETERS, TEST_REFERENCE_DATA, valueSharingBonus,
  type CalculationModule, type EngineInput, type ReferenceData,
} from '../src/index.js';
import { clone } from './helpers.js';

const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  asOfDate: DEMO_AS_OF_DATE, mode: 'rapide', company: { siren: null, nafCode: null, headcountByYear: { 2023: 12, 2024: 12, 2025: 12, 2026: 12 } }, ...over,
});
const run = (m: CalculationModule, input: EngineInput, referenceData: ReferenceData = TEST_REFERENCE_DATA, params = TEST_PARAMETERS) =>
  runCalculation(input, { modules: [m], parameters: params, dataset: 'test', referenceData });

describe('M2 – aides à l’embauche', () => {
  const contract = { id: 'C', contractType: 'apprentissage' as const, startDate: '2026-08-01', durationMonths: 12, diplomaLevel: 3, aidReceived: 'non' as const };
  it('aide perçue « je ne sais pas » : aucun montant, information demandée', () => {
    const o = run(m2AidesEmbauche, base({ apprenticeshipContracts: [{ ...contract, aidReceived: 'inconnu' }] })).opportunities[0]!;
    expect(o.status).toBe('informations_manquantes');
    expect(o.amounts).toBeNull();
    expect(o.calculationDetail.aideTheorique).toBe(4000);
  });
  it('niveau de diplôme au-delà du maximum : non éligible', () => {
    expect(run(m2AidesEmbauche, base({ apprenticeshipContracts: [{ ...contract, diplomaLevel: 8 }] })).opportunities[0]!.status).toBe('aucun_ecart');
  });
  it('effectif au seuil : non éligible (strictement inférieur requis)', () => {
    const input = base({ apprenticeshipContracts: [contract] });
    input.company.headcountByYear[2026] = 250;
    expect(run(m2AidesEmbauche, input).opportunities[0]!.status).toBe('aucun_ecart');
  });
  it('rupture anticipée : l’aide est limitée aux mois exécutés', () => {
    const o = run(m2AidesEmbauche, base({ apprenticeshipContracts: [{ ...contract, startDate: '2026-06-01', endDate: '2026-09-15' }] })).opportunities;
    expect(o).toHaveLength(1);
    expect(o[0]!.amounts!.central).toBe(1000); // 3 mois entiers × 4 000 / 12
  });
  it('les paramètres sont ceux de la date de conclusion, jamais d’une autre période', () => {
    const params = TEST_PARAMETERS.filter((p) => !(p.key.startsWith('aide_apprentissage') && p.validFrom === '2025-01-01'));
    const o = run(m2AidesEmbauche, base({ apprenticeshipContracts: [contract] }), TEST_REFERENCE_DATA, params).opportunities[0]!;
    expect(o.status).toBe('parametre_manquant');
    expect(o.missingParameters.map((m) => m.reason)).toEqual(Array(5).fill('absent'));
  });
  it('contrat de professionnalisation sans paramètre pour 2026 : bloqué', () => {
    const o = run(m2AidesEmbauche, base({ apprenticeshipContracts: [{ ...contract, contractType: 'professionnalisation' }] })).opportunities[0]!;
    expect(o.status).toBe('parametre_manquant');
  });
});

describe('M3 – taux AT', () => {
  const est = [{ id: 'e', siret: '99900000100015', inseeCode: null, atRiskCode: 'DEMO-AT' }];
  const year = { establishmentId: 'e', year: 2025, payrollMass: 100000, notifiedRate: 0.02, notifiedRateFromValidatedDocument: true, appliedRate: 0.025 };
  it('écart confirmé par notification : trop-versé passé + économie future pour la dernière année', () => {
    const ops = run(m3TauxAt, base({ establishments: est, establishmentYears: [year] })).opportunities;
    expect(ops.map((o) => [o.kind, o.status, o.amounts?.central])).toEqual([['recuperation_passee', 'estime', 500], ['economie_future', 'estime', 500]]);
    expect(ops[0]!.confidence).toBe('moyen');
  });
  it('taux appliqué validé par document : confiance élevée', () => {
    const o = run(m3TauxAt, base({ establishments: est, establishmentYears: [{ ...year, appliedRateFromValidatedDocument: true }] })).opportunities[0]!;
    expect(o.confidence).toBe('eleve');
  });
  it('taux appliqué inférieur au notifié : risque, jamais un gain', () => {
    const o = run(m3TauxAt, base({ establishments: est, establishmentYears: [{ ...year, appliedRate: 0.015 }] })).opportunities[0]!;
    expect(o.status).toBe('a_confirmer');
    expect(o.risk).toBe('eleve');
    expect(o.amounts).toBeNull();
  });
  it('taux notifié seulement déclaré : anomalie à vérifier, sans montant', () => {
    const o = run(m3TauxAt, base({ establishments: est, establishmentYears: [{ ...year, notifiedRateFromValidatedDocument: false }] })).opportunities[0]!;
    expect(o.status).toBe('a_confirmer');
    expect(o.amounts).toBeNull();
    expect(o.calculationDetail.ecartPotentielNonConfirme).toBe(500);
  });
  it('masse salariale inconnue : informations manquantes', () => {
    expect(run(m3TauxAt, base({ establishments: est, establishmentYears: [{ ...year, payrollMass: null }] })).opportunities[0]!.status).toBe('informations_manquantes');
  });
  it('période prescrite : non réclamable', () => {
    const o = run(m3TauxAt, base({ asOfDate: '2029-06-01', establishments: est, establishmentYears: [{ ...year, year: 2025 }] })).opportunities[0]!;
    expect(o.status).toBe('non_reclamable');
  });
});

describe('M4 – zonages', () => {
  const est = (insee: string | null) => [{ id: 'e', siret: '99900000100015', inseeCode: insee, atRiskCode: null }];
  it('aucune table publiée : on ne conclut jamais « hors zone »', () => {
    const data = clone(TEST_REFERENCE_DATA);
    data.zoningDatasets[0]!.status = 'brouillon';
    const o = run(m4Zonages, base({ establishments: est('99999') }), data).opportunities[0]!;
    expect(o.status).toBe('parametre_manquant');
    expect(o.missingParameters[0]).toMatchObject({ key: 'zonage:zone_demo', reason: 'non_publie' });
  });
  it('table couvrant partiellement la période : bloqué', () => {
    const data = clone(TEST_REFERENCE_DATA);
    data.zoningDatasets[0]!.validFrom = '2024-01-01';
    expect(run(m4Zonages, base({ establishments: est('26362') }), data).opportunities[0]!.status).toBe('parametre_manquant');
  });
  it('commune hors zone d’après une table sourcée : aucune opportunité', () => {
    expect(run(m4Zonages, base({ establishments: est('99999') })).opportunities).toEqual([]);
  });
  it('aucun dispositif publié : signalé comme règle à compléter', () => {
    const data = { ...clone(TEST_REFERENCE_DATA), zoneSchemes: [] };
    const o = run(m4Zonages, base({ establishments: est('26362') }), data).opportunities[0]!;
    expect(o.missingParameters[0]!.key).toBe('zonage:dispositifs');
  });
  it('code commune manquant : informations manquantes', () => {
    expect(run(m4Zonages, base({ establishments: est(null) })).opportunities[0]!.status).toBe('informations_manquantes');
  });
  it('les sources du zonage et du dispositif sont citées et le calcul les trace', () => {
    const r = run(m4Zonages, base({ establishments: est('26362') }));
    expect(r.opportunities[0]!.sources.map((s) => s.url)).toEqual(['https://exemple.invalid/zonage-de-test', 'https://exemple.invalid/dispositif-de-test']);
    expect(r.referenceIds).toEqual({ zoningDatasets: ['test-zds-demo-2023-2026'], zoningEntries: ['test-ze-26362'], zoneSchemes: ['test-zs-exo-demo'] });
  });
  it('rejeu identique même après remplacement de la table de zonage', () => {
    const original = run(m4Zonages, base({ establishments: est('26362') }));
    const data = clone(TEST_REFERENCE_DATA);
    data.zoningDatasets[0]!.status = 'archive';
    data.zoningDatasets.push({ ...data.zoningDatasets[0]!, id: 'test-zds-v2', version: 2, status: 'publie' });
    expect(run(m4Zonages, base({ establishments: est('26362') }), data).opportunities).toEqual([]); // nouvelle table : plus d'entrée
    expect(replayCalculation(original, { modules: [m4Zonages], parameters: TEST_PARAMETERS, referenceData: data }).identical).toBe(true);
  });
});

describe('M5 – simulateur', () => {
  it('résultat de simulation jamais additionné aux totaux', () => {
    const r = run(m5EpargneSalariale, demoQuickInput());
    expect(r.opportunities[0]!.status).toBe('estime');
    expect(r.opportunities[0]!.countsInTotals).toBe(false);
    expect(r.totals.futureAnnualSavings).toEqual({ low: 0, central: 0, high: 0 });
  });
  it('affiche les conditions de mise en place, dont la non-substitution', () => {
    const d = run(m5EpargneSalariale, demoQuickInput()).opportunities[0]!.calculationDetail as { scenarios: { id: string; conditions: string[] }[] };
    for (const s of d.scenarios.filter((x) => ['interessement', 'interessement_pee_abondement', 'ppv'].includes(x.id))) {
      expect(s.conditions.join(' '), s.id).toMatch(/substitu/);
    }
  });
  it('année sans paramètres publiés : simulation bloquée', () => {
    const input = demoQuickInput();
    input.remunerationSimulation = { ...input.remunerationSimulation!, year: 2025 };
    expect(run(m5EpargneSalariale, input).opportunities[0]!.status).toBe('parametre_manquant');
  });
  it('TMI inconnu : comparaison avant impôt signalée', () => {
    const input = demoQuickInput();
    input.remunerationSimulation = { ...input.remunerationSimulation!, employeeMarginalTaxRate: null };
    const o = run(m5EpargneSalariale, input).opportunities[0]!;
    expect(o.calculationDetail.comparaison).toBe('net avant impôt');
    expect(o.missingInformation.join(' ')).toMatch(/imposition/);
  });
  it('abondement plafonné : résolution exacte de l’équation de coût', () => {
    const s = profitSharingWithMatching(10000, { forfaitSocial: 0, csgCrds: 0.1, individualCap: 1e9, forfaitSocialMatching: 0.2, matchingCap: 1000, matchingMaxRatio: 3 });
    expect(s.detail.abondement).toBe(1000);
    expect(s.detail.interessement).toBeCloseTo(8800, 6); // 10 000 − 1 000 × 1,2
    expect(s.employerCost).toBeCloseTo(10000, 6);
  });
  it('PPV au-delà du seuil de rémunération : non applicable', () => {
    const s = valueSharingBonus(1000, 100000, { cap: 3000, forfaitSocial: 0, csgCrds: 0.1, incomeTaxExempt: true, salaryThreshold: 60000 }, 0.3);
    expect(s.applicable).toBe(false);
  });
  it('titres-restaurant limités au nombre de jours', () => {
    expect(mealVouchers(5000, 100, { maxExemptEmployerShare: 7, maxEmployerRatio: 0.6 }).detail.nombreTitres).toBe(100);
  });
});

describe('Cumul et assiettes hiérarchiques', () => {
  it('chevauchement par préfixe', () => {
    expect(assiettesOverlap('cotisations_patronales:allegements:2024', 'cotisations_patronales:allegements:2024:999')).toBe(true);
    expect(assiettesOverlap('cotisations_patronales:allegements:2024', 'cotisations_patronales:allegements:2025')).toBe(false);
    expect(assiettesOverlap('cotisations_patronales:atmp:2024:x', 'cotisations_patronales:allegements:2024')).toBe(false);
    expect(assiettesOverlap('a:b', 'a:bc')).toBe(false);
  });
  it('une exonération zonale chiffrée ne s’additionne pas à la réduction générale de la même année', () => {
    const zonal: CalculationModule = { ...m4Zonages, id: 'FAKE_ZONAL', compute: () => [{
      ...run(m4Zonages, base({ establishments: [{ id: 'e', siret: '99900000100015', inseeCode: '26362', atRiskCode: null }] })).opportunities[0]!,
      moduleId: 'FAKE_ZONAL', status: 'estime', amounts: { low: 100, central: 100, high: 100 },
    }] };
    const r = runCalculation(demoQuickInput(), { modules: [MODULE_REGISTRY[0]!, zonal], parameters: TEST_PARAMETERS, dataset: 'test', referenceData: TEST_REFERENCE_DATA });
    expect(r.cumulationConflicts.length).toBeGreaterThan(0);
    expect(r.cumulationConflicts[0]!.assiette).toMatch(/^cotisations_patronales:allegements:2023$/);
    // Les années de M1 en conflit sont exclues : le total est inférieur au total M1 seul.
    const m1Only = runCalculation(demoQuickInput(), { modules: [MODULE_REGISTRY[0]!], parameters: TEST_PARAMETERS, dataset: 'test' });
    expect(r.totals.pastRecovery.central).toBeLessThan(m1Only.totals.pastRecovery.central);
  });
});

describe('Boulangerie Démo – 5 modules de bout en bout', () => {
  const r = runCalculation(demoQuickInput(), { modules: MODULE_REGISTRY, parameters: TEST_PARAMETERS, dataset: 'test', referenceData: TEST_REFERENCE_DATA });
  it('détecte les quatre anomalies volontaires', () => {
    const by = (id: string) => r.opportunities.filter((o) => o.moduleId === id);
    expect(by('M1_REDUCTION_GENERALE').every((o) => o.status === 'estime')).toBe(true);
    expect(by('M2_AIDES_EMBAUCHE').find((o) => o.status === 'estime')!.amounts!.central).toBe(3000);
    expect(by('M3_TAUX_AT').find((o) => o.status === 'estime')!.amounts!.central).toBe(2014.91);
    expect(by('M4_ZONAGES')[0]!.status).toBe('a_confirmer');
    expect(by('M5_EPARGNE_SALARIALE')[0]!.countsInTotals).toBe(false);
  });
  it('aucun conflit de cumul, totaux passé/futur séparés', () => {
    expect(r.cumulationConflicts).toEqual([]);
    const m1 = r.opportunities.filter((o) => o.moduleId === 'M1_REDUCTION_GENERALE').reduce((a, o) => a + o.amounts!.central, 0);
    expect(r.totals.pastRecovery.central).toBeCloseTo(m1 + 3000 + 2014.91, 2);
    expect(r.totals.futureAnnualSavings.central).toBe(0); // M5 hors totaux, M3 sans erreur sur la dernière année
  });
  it('reproductible et rejouable', () => {
    expect(replayCalculation(r, { modules: MODULE_REGISTRY, parameters: TEST_PARAMETERS, referenceData: TEST_REFERENCE_DATA }).identical).toBe(true);
  });
  it('avec le jeu officiel actuel, aucun montant n’est produit', () => {
    const off = runCalculation(demoQuickInput(), { modules: MODULE_REGISTRY, parameters: OFFICIAL_PARAMETERS_SEED, dataset: 'officiel' });
    expect(off.opportunities.every((o) => o.amounts === null)).toBe(true);
  });
});
