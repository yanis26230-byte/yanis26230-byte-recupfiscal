import { describe, expect, it } from 'vitest';
import {
  bracketEuroBounds, demoAdvancedInput, demoQuickInput, m1ReductionGenerale, ParameterResolver,
  TEST_PARAMETERS, OFFICIAL_PARAMETERS_SEED, runCalculation, roundCents, type EngineInput, type Opportunity,
} from '../src/index.js';
import { clone } from './helpers.js';

const run = (input: EngineInput, params = TEST_PARAMETERS) =>
  runCalculation(input, { modules: [m1ReductionGenerale], parameters: params, dataset: 'test' });
const byYear = (ops: Opportunity[], y: number) => ops.find((o) => o.year === y)!;

/** Une seule tranche, 2024, entièrement réclamable au 15/01/2027. */
function singleBracketInput(over: Partial<EngineInput['quick']> = {}, declared: number | null = 0): EngineInput {
  return {
    asOfDate: '2027-01-15', mode: 'rapide',
    company: { siren: null, nafCode: null, headcountByYear: { 2024: 10 } },
    quick: { years: [{ year: 2024, averageHeadcount: 10, declaredGeneralReduction: declared,
      brackets: [{ bracket: '1_3_1_6', employeeCount: 1, partTimeShare: 0 }] }], ...over },
  };
}

// SMIC annuel de test 2024 : 12,40 × 151,67 × 12
const SMIC_2024 = 12.4 * 151.67 * 12;

describe('M1 – mode rapide', () => {
  it('cas de référence : 1 salarié entre 1,3 et 1,6 SMIC en 2024, rien de déclaré', () => {
    const o = byYear(run(singleBracketInput()).opportunities, 2024);
    expect(o.status).toBe('estime');
    // haut : borne basse 1,3 SMIC, coefficient 0,1231
    expect(o.amounts!.high).toBe(roundCents(0.1231 * 1.3 * SMIC_2024));
    // central : milieu 1,45 SMIC, coefficient 0,32/0,6 × (1,6/1,45 − 1) = 0,0552
    expect(o.amounts!.central).toBe(roundCents(0.0552 * 1.45 * SMIC_2024));
    // bas : borne haute (1,6 SMIC exclu) → coefficient quasi nul
    expect(o.amounts!.low).toBeLessThan(1);
    expect(o.confidence).toBe('moyen');
    expect(o.kind).toBe('recuperation_passee');
  });

  it('écart = réduction théorique − réduction déclarée, jamais négatif', () => {
    const o = byYear(run(singleBracketInput({}, 1000)).opportunities, 2024);
    expect(o.amounts!.high).toBe(roundCents(0.1231 * 1.3 * SMIC_2024 - 1000));
    expect(o.amounts!.low).toBe(0);
  });

  it('réduction déclarée inconnue : pas de montant, confiance faible, document demandé', () => {
    const o = byYear(run(singleBracketInput({}, null)).opportunities, 2024);
    expect(o.status).toBe('informations_manquantes');
    expect(o.amounts).toBeNull();
    expect(o.confidence).toBe('faible');
    expect(o.missingInformation.join(' ')).toMatch(/réduction générale appliqué/);
  });

  it('déclaré supérieur à l’estimation : aucun écart, sans montant', () => {
    const o = byYear(run(singleBracketInput({}, 100_000)).opportunities, 2024);
    expect(o.status).toBe('aucun_ecart');
    expect(o.amounts).toBeNull();
  });

  it('proratise les temps partiels avec la quotité saisie', () => {
    const input = singleBracketInput();
    input.quick!.years[0]!.brackets = [{ bracket: '1_3_1_6', employeeCount: 2, partTimeShare: 0.5, partTimeAverageRatio: 0.5 }];
    const o = byYear(run(input).opportunities, 2024);
    // 2 salariés dont 1 à mi-temps = 1,5 ETP
    expect(o.amounts!.high).toBe(roundCents(0.1231 * 1.3 * SMIC_2024 * 1.5));
  });

  it('quotité inconnue : hypothèse affichée et information demandée', () => {
    const input = singleBracketInput();
    input.quick!.years[0]!.brackets = [{ bracket: '1_3_1_6', employeeCount: 2, partTimeShare: 0.5 }];
    const o = byYear(run(input).opportunities, 2024);
    expect(o.confidence).toBe('faible');
    expect(o.missingInformation.join(' ')).toMatch(/Quotité/);
    expect(JSON.stringify(o.calculationDetail)).toMatch(/hypothèse 0.5 à 0.8/);
  });

  it('au-delà du seuil de sortie : aucune réduction', () => {
    const input = singleBracketInput();
    input.quick!.years[0]!.brackets = [{ bracket: '2_2_5', employeeCount: 5, partTimeShare: 0 }];
    expect(byYear(run(input).opportunities, 2024).status).toBe('aucun_ecart');
  });

  it('équivalents en euros des tranches', () => {
    const b = bracketEuroBounds(20000);
    expect(b.lt_1_1).toEqual({ low: 20000, high: 22000 });
    expect(b.gt_3).toEqual({ low: 60000, high: null });
  });

  it('un paramètre 2024 manquant bloque 2024 sans emprunter 2023 ou 2025', () => {
    const params = TEST_PARAMETERS.filter((p) => !(p.key === 'rg_tmax_moins_seuil_effectif' && p.validFrom === '2024-01-01'));
    const r = run(demoQuickInput(), params);
    const o2024 = byYear(r.opportunities, 2024);
    expect(o2024.status).toBe('parametre_manquant');
    expect(o2024.amounts).toBeNull();
    expect(o2024.missingParameters).toEqual([
      { key: 'rg_tmax_moins_seuil_effectif', periodFrom: '2024-01-01', periodTo: '2024-12-31', reason: 'absent' },
    ]);
    expect(byYear(r.opportunities, 2023).status).toBe('estime');
    expect(byYear(r.opportunities, 2025).status).toBe('estime');
    expect(r.parameterIds.some((id) => id.includes('rg_tmax_moins_seuil_effectif-2024'))).toBe(false);
  });

  it('un calcul 2024 utilise exclusivement des paramètres valables en 2024', () => {
    const input = singleBracketInput();
    const r = run(input);
    for (const p of r.parameterSnapshot) {
      if (p.key === 'delai_reclamation_cotisations_annees') continue; // lu à la date de référence
      expect(p.validFrom <= '2024-01-01' || p.validFrom.startsWith('2024')).toBe(true);
      expect(p.validTo === null || p.validTo >= '2024-01-01').toBe(true);
      expect(p.validFrom <= '2024-12-31').toBe(true);
    }
  });

  it('un paramètre au statut brouillon n’est pas utilisé', () => {
    const params = TEST_PARAMETERS.map((p) => (p.key === 'rgdu_puissance' ? { ...p, status: 'brouillon' as const } : p));
    const o = byYear(run(demoQuickInput(), params).opportunities, 2026);
    expect(o.status).toBe('parametre_manquant');
    expect(o.missingParameters[0]).toMatchObject({ key: 'rgdu_puissance', reason: 'non_publie', foundStatuses: ['brouillon'] });
  });

  it('effectif inconnu : informations manquantes', () => {
    const input = singleBracketInput();
    input.quick!.years[0]!.averageHeadcount = null;
    input.company.headcountByYear = {};
    expect(byYear(run(input).opportunities, 2024).status).toBe('informations_manquantes');
  });

  it('année prescrite : non réclamable, sans montant', () => {
    const input = singleBracketInput();
    input.asOfDate = '2028-06-01';
    const o = byYear(run(input).opportunities, 2024);
    expect(o.status).toBe('non_reclamable');
    expect(o.amounts).toBeNull();
  });

  it('jeu officiel actuel : tout est bloqué (aucune valeur inventée)', () => {
    const r = runCalculation(demoQuickInput(), { modules: [m1ReductionGenerale], parameters: OFFICIAL_PARAMETERS_SEED, dataset: 'officiel' });
    expect(r.opportunities.every((o) => o.status === 'parametre_manquant' && o.amounts === null)).toBe(true);
    expect(r.totals.pastRecovery).toEqual({ low: 0, central: 0, high: 0 });
    const rgdu = r.missingParameters.find((m) => m.key === 'rgdu_puissance');
    expect(rgdu).toMatchObject({ reason: 'non_publie', foundStatuses: ['brouillon'] });
  });
});

describe('M1 – mode avancé (Boulangerie Démo)', () => {
  const r = run(demoAdvancedInput());

  it('2024 : seule la réduction oubliée du temps partiel E07 ressort', () => {
    // E07 : 1,15 SMIC, 91 h/mois ; coefficient 0,2087 ; brut mensuel 1,15 × 12,40 × 91 = 1 297,66
    const expected = roundCents(0.2087 * 1297.66 * 12);
    const o = byYear(r.opportunities, 2024);
    expect(o.status).toBe('estime');
    expect(o.confidence).toBe('eleve');
    expect(o.amounts).toEqual({ low: expected, central: expected, high: expected });
  });

  it('2025 : E07 oublié + E03 appliqué à moitié', () => {
    const e07 = roundCents(0.2087 * 1318.59 * 12); // 1,15 × 12,60 × 91
    const e03Gross = 2293.25; // 1,2 × 12,60 × 151,67 arrondi
    const e03 = roundCents(roundCents(0.1778 * e03Gross * 12) - roundCents(0.1778 * e03Gross * 0.5) * 12);
    const o = byYear(r.opportunities, 2025);
    expect(o.amounts!.central).toBeCloseTo(e07 + e03, 2);
  });

  it('2026 (RGDU) : E09 et E10 oubliés sur 10 mois', () => {
    const e09 = roundCents(0.0756 * 3494.48 * 10);
    const e10 = roundCents(0.0243 * 5047.58 * 10);
    expect(byYear(r.opportunities, 2026).amounts!.central).toBeCloseTo(e09 + e10, 2);
  });

  it('2023 sans paie importée : retombe sur le mode rapide (aucune donnée perdue)', () => {
    const o = byYear(r.opportunities, 2023);
    expect(o.calculationDetail.mode).toBe('rapide');
    expect(o.calculationDetail.moisReclamables).toEqual([10, 11, 12]);
  });

  it('les lignes importées non validées sont exclues', () => {
    const input = demoAdvancedInput();
    input.advanced!.payrollLines = input.advanced!.payrollLines.map((l) => (l.year === 2024 && l.employeeInternalId === 'E07' ? { ...l, validated: false } : l));
    const o = byYear(run(input).opportunities, 2024);
    expect(o.status).toBe('aucun_ecart');
    expect(o.missingInformation.join(' ')).toMatch(/12 ligne\(s\) de paie 2024 importée\(s\) non validée\(s\)/);
  });

  it('détecte une sur-application et la déduit de l’estimation basse', () => {
    const input = demoAdvancedInput();
    input.advanced!.payrollLines = input.advanced!.payrollLines.map((l) =>
      l.year === 2024 && l.employeeInternalId === 'E10' ? { ...l, reductionApplied: 100 } : l);
    const o = byYear(run(input).opportunities, 2024);
    const e07 = roundCents(0.2087 * 1297.66 * 12);
    expect(o.amounts!.high).toBeCloseTo(e07, 2);
    expect(o.amounts!.low).toBeCloseTo(e07 - 1200, 2);
    expect(o.conditionsDetected.join(' ')).toMatch(/Sur-application/);
  });

  it('le mode avancé est plus précis que le mode rapide et reste dans sa fourchette', () => {
    const quick = run(demoQuickInput());
    for (const y of [2024, 2025, 2026]) {
      const q = byYear(quick.opportunities, y).amounts!;
      const a = byYear(r.opportunities, y).amounts!;
      expect(a.central).toBeGreaterThanOrEqual(q.low);
      expect(a.central).toBeLessThanOrEqual(q.high);
    }
  });
});

describe('M1 – contrat de module', () => {
  it('déclare ses paramètres, sources et justificatifs', () => {
    expect(m1ReductionGenerale.parameterKeys).toContain('smic_horaire');
    expect(m1ReductionGenerale.officialSources.length).toBeGreaterThan(0);
    expect(m1ReductionGenerale.requiredDocuments.length).toBeGreaterThan(0);
  });
  it('n’utilise pas de résolveur partagé entre deux calculs (pas d’état caché)', () => {
    const a = run(demoQuickInput());
    const b = run(clone(demoQuickInput()));
    expect(a.outputHash).toBe(b.outputHash);
    void ParameterResolver;
  });
});
