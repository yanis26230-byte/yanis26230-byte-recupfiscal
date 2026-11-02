import { monthEnd, monthStart, yearEnd, yearStart } from '../../dates.js';
import { formatEuro, roundCents } from '../../money.js';
import { resolveAll } from '../../parameters.js';
import type { CalculationModule, MissingParameter, ModuleContext, Opportunity, RemunerationSimulationInput, SourceRef } from '../../types.js';
import { M1_KEYS } from '../m1-reduction-generale/params.js';
import { makeOpportunity, range } from '../common.js';
import { mealVouchers, profitSharingPaid, profitSharingWithMatching, salaryLike, valueSharingBonus, type ScenarioId, type ScenarioResult } from './formulas.js';

export const M5_ID = 'M5_EPARGNE_SALARIALE';
export const M5_VERSION = '1.0.0';

export const M5_KEYS = {
  pass: 'pass_annuel',
  seuil1: 'epargne_salariale_seuil_effectif_1',
  seuil2: 'epargne_salariale_seuil_effectif_2',
  tauxPatronalRef: 'm5_taux_patronal_reference',
  tauxSalarialRef: 'm5_taux_salarial_reference',
  csgCrds: 'csg_crds_epargne_salariale_taux',
  interessementPlafondPass: 'interessement_plafond_individuel_ratio_pass',
  abondementPlafondPass: 'abondement_plafond_ratio_pass',
  abondementRatioMax: 'abondement_ratio_max_versement',
  ppvPlafond: 'ppv_plafond_par_salarie',
  ppvSeuilSmic: 'ppv_seuil_remuneration_smic',
  trExoMax: 'titres_restaurant_exoneration_max_par_titre',
  trPartMax: 'titres_restaurant_part_patronale_max_ratio',
} as const;
/** Clés dépendant de la tranche d'effectif (1 : sous le seuil 1, 2 : entre les seuils, 3 : au-delà). */
export const m5BandKeys = (band: 1 | 2 | 3) => ({
  fsInteressement: `forfait_social_interessement_taux_tranche${band}`,
  fsAbondement: `forfait_social_abondement_taux_tranche${band}`,
  fsPpv: `forfait_social_ppv_taux_tranche${band}`,
  ppvCsg: `ppv_taux_csg_crds_salarie_tranche${band}`,
  ppvExoIr: `ppv_exoneration_ir_tranche${band}`,
});

const SOURCES: SourceRef[] = [
  { label: 'BOSS – Épargne salariale', url: 'https://boss.gouv.fr' },
  { label: 'URSSAF – Prime de partage de la valeur, titres-restaurant', url: 'https://www.urssaf.fr' },
  { label: 'Ministère du Travail – épargne salariale', url: 'https://travail-emploi.gouv.fr' },
];

export const SCENARIO_CONDITIONS: Record<ScenarioId, string[]> = {
  augmentation_salaire: ['Engagement pérenne : le coût se reproduit chaque année et peut augmenter les éléments indexés sur le salaire.'],
  prime_classique: ['Soumise aux mêmes cotisations et impôts que le salaire.', 'Une prime versée régulièrement peut devenir un usage obligatoire.'],
  interessement: ['Accord d’intéressement à conclure selon les règles en vigueur, avec une formule liée aux résultats ou aux performances (montant non garanti).',
    'Ne peut se substituer à aucun élément de rémunération (règle de non-substitution).', 'Condition d’ancienneté éventuelle prévue par l’accord ; plafonds individuel et global.'],
  interessement_pee_abondement: ['Accord d’intéressement et plan d’épargne d’entreprise (PEE) à mettre en place.', 'Sommes bloquées sur le PEE, sauf cas de déblocage anticipé prévus par les textes.',
    'Abondement plafonné et limité à un multiple des versements du salarié.', 'Non-substitution à un élément de rémunération.'],
  ppv: ['Mise en place par accord ou décision unilatérale ; modulation selon des critères limitativement prévus.', 'Non-substitution à un élément de rémunération.',
    'Régime d’exonération dépendant de la taille de l’entreprise, de la rémunération du salarié et de l’année.'],
  titres_restaurant: ['Part patronale comprise entre les bornes réglementaires et identique pour les salariés d’une même catégorie.', 'Le salarié finance sa quote-part ; usage réservé aux repas.'],
};

function round(s: ScenarioResult): ScenarioResult {
  const r = (x: number | null) => (x === null ? null : roundCents(x));
  return { ...s, employerCost: roundCents(s.employerCost), employerContributions: roundCents(s.employerContributions), employeeContributions: roundCents(s.employeeContributions),
    netBeforeTax: roundCents(s.netBeforeTax), incomeTax: r(s.incomeTax), netAfterTax: r(s.netAfterTax), unusedEnvelope: roundCents(s.unusedEnvelope),
    detail: Object.fromEntries(Object.entries(s.detail).map(([k, v]) => [k, roundCents(v)])) };
}

function simulate(sim: RemunerationSimulationInput, headcount: number, ctx: ModuleContext): Opportunity {
  const from = yearStart(sim.year);
  const to = yearEnd(sim.year);
  const base = { moduleId: M5_ID, moduleVersion: M5_VERSION, name: 'Simulateur rémunération et épargne salariale', kind: 'economie_future' as const,
    year: sim.year, periodFrom: from, periodTo: to };
  const common: Partial<Opportunity> = { sources: SOURCES, countsInTotals: false, assiettes: [`remuneration:simulation:${sim.year}`],
    documentsToProvide: ['Taux de cotisations effectifs de l’entreprise (journal de paie)', 'Accords existants (intéressement, participation, PEE)'] };
  const missing: MissingParameter[] = [];
  const C = sim.envelopeEmployerCostPerEmployee;
  const tmi = sim.employeeMarginalTaxRate;
  const missingInformation: string[] = [];
  if (tmi === null) missingInformation.push('Taux marginal d’imposition des salariés (comparaison faite avant impôt)');

  // Taux de référence : ceux de l'entreprise s'ils sont connus, sinon les taux de référence publiés.
  const rates: { employer: number | null; employee: number | null } = { employer: sim.employerRateOverride ?? null, employee: sim.employeeRateOverride ?? null };
  if (rates.employer === null || rates.employee === null) {
    const r = resolveAll(ctx.params, [M5_KEYS.tauxPatronalRef, M5_KEYS.tauxSalarialRef], from, to);
    if (r.ok) {
      rates.employer ??= r.values[M5_KEYS.tauxPatronalRef];
      rates.employee ??= r.values[M5_KEYS.tauxSalarialRef];
    } else missing.push(...r.missing);
  }
  const common2 = resolveAll(ctx.params, [M5_KEYS.pass, M5_KEYS.seuil1, M5_KEYS.seuil2, M5_KEYS.csgCrds], from, to);
  if (!common2.ok) missing.push(...common2.missing);
  if (rates.employer === null || rates.employee === null || !common2.ok) {
    return makeOpportunity(base, { ...common, status: 'parametre_manquant', missingParameters: missing,
      explanation: `Les taux et plafonds ${sim.year} nécessaires au simulateur ne sont pas encore publiés : simulation suspendue.` });
  }
  const c = common2.values;
  const band: 1 | 2 | 3 = headcount < c[M5_KEYS.seuil1] ? 1 : headcount < c[M5_KEYS.seuil2] ? 2 : 3;
  const bk = m5BandKeys(band);
  const scenarios: ScenarioResult[] = [
    salaryLike('augmentation_salaire', 'Augmentation de salaire', C, rates.employer, rates.employee, tmi),
    salaryLike('prime_classique', 'Prime classique', C, rates.employer, rates.employee, tmi),
  ];
  const notComputed: { id: ScenarioId; reason: string }[] = [];
  const tryGroup = (id: ScenarioId, keys: string[], f: (v: Record<string, number>) => ScenarioResult | null, reasonIfNull?: string) => {
    const r = resolveAll(ctx.params, keys, from, to);
    if (!r.ok) { missing.push(...r.missing); notComputed.push({ id, reason: 'Paramètres non publiés' }); return; }
    const s = f(r.values as Record<string, number>);
    if (s) scenarios.push(s);
    else notComputed.push({ id, reason: reasonIfNull ?? 'Non calculé' });
  };
  const pass = c[M5_KEYS.pass];
  tryGroup('interessement', [M5_KEYS.interessementPlafondPass, bk.fsInteressement], (v) =>
    profitSharingPaid(C, { forfaitSocial: v[bk.fsInteressement]!, csgCrds: c[M5_KEYS.csgCrds], individualCap: v[M5_KEYS.interessementPlafondPass]! * pass }, tmi));
  tryGroup('interessement_pee_abondement', [M5_KEYS.interessementPlafondPass, bk.fsInteressement, M5_KEYS.abondementPlafondPass, M5_KEYS.abondementRatioMax, bk.fsAbondement], (v) =>
    profitSharingWithMatching(C, { forfaitSocial: v[bk.fsInteressement]!, csgCrds: c[M5_KEYS.csgCrds], individualCap: v[M5_KEYS.interessementPlafondPass]! * pass,
      forfaitSocialMatching: v[bk.fsAbondement]!, matchingCap: v[M5_KEYS.abondementPlafondPass]! * pass, matchingMaxRatio: v[M5_KEYS.abondementRatioMax]! }));

  // Le seuil de rémunération de la PPV est exprimé en SMIC annuel de l'année simulée.
  const smic: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const r = ctx.params.resolve(M1_KEYS.smicHoraire, monthStart(sim.year, m), monthEnd(sim.year, m));
    if (r.ok) smic.push(r.value);
  }
  const hours = ctx.params.resolve(M1_KEYS.dureeMensuelle, from, to);
  if (smic.length === 12 && hours.ok) {
    const annualSmic = smic.reduce((a, s) => a + s * hours.value, 0);
    tryGroup('ppv', [M5_KEYS.ppvPlafond, M5_KEYS.ppvSeuilSmic, bk.fsPpv, bk.ppvCsg, bk.ppvExoIr], (v) =>
      valueSharingBonus(C, sim.averageAnnualGrossSalary, { cap: v[M5_KEYS.ppvPlafond]!, forfaitSocial: v[bk.fsPpv]!, csgCrds: v[bk.ppvCsg]!,
        incomeTaxExempt: v[bk.ppvExoIr] === 1, salaryThreshold: v[M5_KEYS.ppvSeuilSmic]! * annualSmic }, tmi));
  } else {
    missing.push({ key: M1_KEYS.smicHoraire, periodFrom: from, periodTo: to, reason: 'non_publie' });
    notComputed.push({ id: 'ppv', reason: 'SMIC de l’année non publié' });
  }
  if (sim.mealDaysPerYear == null) {
    missingInformation.push('Nombre de jours de repas par an (titres-restaurant)');
    notComputed.push({ id: 'titres_restaurant', reason: 'Nombre de jours de repas inconnu' });
  } else {
    tryGroup('titres_restaurant', [M5_KEYS.trExoMax, M5_KEYS.trPartMax], (v) =>
      mealVouchers(C, sim.mealDaysPerYear!, { maxExemptEmployerShare: v[M5_KEYS.trExoMax]!, maxEmployerRatio: v[M5_KEYS.trPartMax]! }));
  }

  const metric = (s: ScenarioResult) => (tmi === null ? s.netBeforeTax : s.netAfterTax!);
  const baseline = scenarios.find((s) => s.id === 'prime_classique')!;
  const compared = scenarios.map((s) => {
    const gain = s.applicable ? metric(s) - metric(baseline) : null;
    // Coût pour verser le même net que la prime classique (linéaire tant que les plafonds ne sont pas atteints).
    const reachable = s.applicable && metric(s) >= metric(baseline) && metric(s) > 0;
    const costAtEqualNet = reachable ? (s.employerCost / metric(s)) * metric(baseline) : null;
    return { ...round(s), rawGain: gain, conditions: SCENARIO_CONDITIONS[s.id], gainNetParSalarieVsPrime: gain === null ? null : roundCents(gain),
      coutEmployeurPourNetEgal: costAtEqualNet === null ? null : roundCents(costAtEqualNet),
      economieEmployeurANetEgal: costAtEqualNet === null ? null : roundCents(C - costAtEqualNet) };
  });
  const alternatives = compared.filter((s) => s.id !== 'prime_classique' && s.id !== 'augmentation_salaire' && s.applicable);
  const best = [...alternatives].sort((a, b) => (b.rawGain ?? 0) - (a.rawGain ?? 0))[0];
  const detail = { annee: sim.year, trancheEffectif: band, enveloppeParSalarie: C, salaries: sim.employeeCount, tauxPatronal: rates.employer, tauxSalarial: rates.employee,
    tauxSource: sim.employerRateOverride != null ? 'entreprise' : 'référence paramétrée', comparaison: tmi === null ? 'net avant impôt' : 'net après impôt',
    scenarios: compared.map(({ rawGain: _raw, ...rest }) => rest), scenariosNonCalcules: notComputed,
    hypotheses: ['Impôt sur le revenu approché : net × taux marginal d’imposition.', 'Taux de cotisations moyens appliqués à l’enveloppe (hors réduction générale propre à chaque salaire).',
      'Résultat de simulation : non additionné aux économies ni aux récupérations.'] };

  if (!alternatives.length) {
    return makeOpportunity(base, { ...common, status: 'parametre_manquant', missingParameters: missing, missingInformation, calculationDetail: detail,
      explanation: 'Seuls les scénarios salariaux ont pu être simulés : les paramètres des autres dispositifs ne sont pas encore publiés.' });
  }
  // Arrondi uniquement en fin de calcul (pas de multiplication d'un montant déjà arrondi).
  const gain = best!.rawGain ?? 0;
  if (gain <= 0) {
    return makeOpportunity(base, { ...common, status: 'aucun_ecart', missingParameters: missing, missingInformation, calculationDetail: detail,
      explanation: 'Pour cette enveloppe, aucun dispositif ne procure davantage de net au salarié que la prime classique.' });
  }
  const total = roundCents(gain * sim.employeeCount);
  return makeOpportunity(base, {
    ...common, status: 'estime', amounts: range(total), confidence: 'faible', risk: 'standard', missingParameters: missing, missingInformation,
    calculationDetail: detail, conditionsDetected: best!.conditions,
    explanation: `Pour un même coût de ${formatEuro(C)} par salarié, « ${best!.label} » procurerait environ ${formatEuro(gain)} de plus par salarié qu’une prime classique, soit ${formatEuro(total)} pour ${sim.employeeCount} salarié(s). Ces dispositifs ne remplacent pas librement le salaire : vérifiez les conditions de mise en place.`,
  });
}

export const m5EpargneSalariale: CalculationModule = {
  id: M5_ID,
  name: 'Épargne salariale et rémunération',
  description: 'Compare, pour une même enveloppe, le coût employeur, les prélèvements et le net salarié de six modes de rémunération.',
  kind: 'futur',
  version: M5_VERSION,
  requiredData: ['Enveloppe par salarié', 'Nombre de salariés', 'Rémunération moyenne', 'Effectif', 'Taux marginal d’imposition (facultatif)'],
  eligibilityConditions: ['Conditions de mise en place propres à chaque dispositif (accord, ancienneté, plafonds, non-substitution)'],
  parameterKeys: [...Object.values(M5_KEYS), ...Object.values(m5BandKeys(1)), ...Object.values(m5BandKeys(2)), ...Object.values(m5BandKeys(3)), M1_KEYS.smicHoraire, M1_KEYS.dureeMensuelle],
  applicablePeriod: { from: '2023-01-01', to: null },
  officialSources: SOURCES,
  requiredDocuments: [],
  compute(input, ctx) {
    const sim = input.remunerationSimulation;
    if (!sim) return [];
    const headcount = input.company.headcountByYear[String(sim.year)] ?? null;
    if (headcount === null) {
      return [makeOpportunity({ moduleId: M5_ID, moduleVersion: M5_VERSION, name: 'Simulateur rémunération et épargne salariale', kind: 'economie_future',
        year: sim.year, periodFrom: yearStart(sim.year), periodTo: yearEnd(sim.year) }, { status: 'informations_manquantes', countsInTotals: false,
        missingInformation: [`Effectif moyen ${sim.year}`], explanation: 'L’effectif est nécessaire pour déterminer les taux applicables.' })];
    }
    return [simulate(sim, headcount, ctx)];
  },
};
