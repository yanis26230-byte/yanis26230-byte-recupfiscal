import { claimableMonths, CLAIM_DELAY_KEY } from '../../claim.js';
import { yearEnd, yearStart } from '../../dates.js';
import { roundCents, sum } from '../../money.js';
import type {
  CalculationModule,
  EngineInput,
  ModuleContext,
  Opportunity,
  PayrollLine,
  QuickYearInput,
  SalaryBracketId,
  SourceRef,
} from '../../types.js';
import { regimeForYear } from './formulas.js';
import { M1_KEYS, resolveYearParams, type YearParams } from './params.js';

export const M1_ID = 'M1_REDUCTION_GENERALE';
export const M1_VERSION = '1.1.0';

const SOURCES: SourceRef[] = [
  { label: 'BOSS – Allègements généraux', url: 'https://boss.gouv.fr/portail/accueil/allegements-generaux.html' },
  { label: 'URSSAF – Réduction générale des cotisations', url: 'https://www.urssaf.fr' },
];

const DOCUMENTS = [
  'Journaux de paie annuels (ou DSN) des années concernées',
  'Détail de la réduction générale appliquée par salarié (bulletins ou état récapitulatif)',
  'Durée du travail contractuelle des salariés à temps partiel',
];

/** Bornes des tranches du mode rapide, en multiple du SMIC temps plein. */
export const BRACKET_BOUNDS: Record<SalaryBracketId, { low: number; high: number; label: string }> = {
  lt_1_1: { low: 1.0, high: 1.1, label: 'moins de 1,1 SMIC' },
  '1_1_1_3': { low: 1.1, high: 1.3, label: '1,1 à 1,3 SMIC' },
  '1_3_1_6': { low: 1.3, high: 1.6, label: '1,3 à 1,6 SMIC' },
  '1_6_2': { low: 1.6, high: 2.0, label: '1,6 à 2 SMIC' },
  '2_2_5': { low: 2.0, high: 2.5, label: '2 à 2,5 SMIC' },
  '2_5_3': { low: 2.5, high: 3.0, label: '2,5 à 3 SMIC' },
  gt_3: { low: 3.0, high: 3.0, label: 'plus de 3 SMIC' },
};

/**
 * Hypothèse d'estimation (pas un paramètre réglementaire) : quotité moyenne des temps
 * partiels quand l'utilisateur ne la connaît pas. Affichée dans le détail du calcul.
 */
export const PART_TIME_RATIO_HYPOTHESIS = { low: 0.5, central: 0.65, high: 0.8 } as const;

const SAMPLES = 20;
/**
 * Hypothèse : en mode avancé, un écart individuel annuel inférieur à 1 € est attribué aux
 * arrondis mensuels de la paie et ignoré (ni sous- ni sur-application).
 */
export const ROUNDING_TOLERANCE_EUR = 1;
const EPS = 1e-6;

/** Équivalent en euros annuels bruts de chaque tranche, pour l'affichage du questionnaire. */
export function bracketEuroBounds(annualSmicFullTime: number) {
  return Object.fromEntries(
    Object.entries(BRACKET_BOUNDS).map(([id, b]) => [
      id,
      { low: roundCents(b.low * annualSmicFullTime), high: id === 'gt_3' ? null : roundCents(b.high * annualSmicFullTime) },
    ]),
  ) as Record<SalaryBracketId, { low: number; high: number | null }>;
}

/** Réduction annuelle pour un équivalent temps plein payé m SMIC. */
function reductionPerFte(p: YearParams, m: number): number {
  return p.coefficient(m) * m * p.annualSmicFullTime;
}

/** Min / milieu / max de la réduction sur une tranche [a, b[ (la fonction n'est pas forcément monotone). */
function bracketRange(p: YearParams, a: number, b: number) {
  const top = b > a ? b - EPS : a;
  const values: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) values.push(reductionPerFte(p, a + ((top - a) * i) / SAMPLES));
  return { low: Math.min(...values), central: reductionPerFte(p, (a + b) / 2), high: Math.max(...values) };
}

function baseOpportunity(year: number, partial: Partial<Opportunity>): Opportunity {
  return {
    moduleId: M1_ID,
    moduleVersion: M1_VERSION,
    name: 'Réduction générale des cotisations patronales',
    kind: 'recuperation_passee',
    year,
    periodFrom: yearStart(year),
    periodTo: yearEnd(year),
    amounts: null,
    status: 'estime',
    confidence: 'faible',
    risk: 'standard',
    conditionsDetected: [],
    missingInformation: [],
    missingParameters: [],
    explanation: '',
    sources: SOURCES,
    documentsToProvide: DOCUMENTS,
    calculationDetail: {},
    // Assiette large : toute exonération zonale sur les cotisations patronales de l'année la chevauche.
    assiettes: [`cotisations_patronales:allegements:${year}`],
    countsInTotals: true,
    ...partial,
  };
}

function headcountFor(input: EngineInput, year: number, q?: QuickYearInput): number | null {
  return q?.averageHeadcount ?? input.company.headcountByYear[String(year)] ?? null;
}

function finalize(
  year: number,
  ctx: ModuleContext,
  gap: { low: number; central: number; high: number },
  claimFraction: (months: number[]) => number,
  common: Partial<Opportunity>,
): Opportunity {
  const claim = claimableMonths(ctx.params, year, ctx.asOfDate);
  if (!claim.ok) {
    return baseOpportunity(year, {
      ...common,
      status: 'parametre_manquant',
      missingParameters: [claim.missing],
      explanation: "Le délai de réclamation n'est pas encore publié : impossible de dire si cette période est encore réclamable.",
    });
  }
  const f = claimFraction(claim.claimableMonths);
  const detail = { ...(common.calculationDetail ?? {}), delaiReclamationAnnees: claim.delayYears, moisReclamables: claim.claimableMonths, fractionReclamable: f };
  if (gap.high <= 0) {
    return baseOpportunity(year, { ...common, status: 'aucun_ecart', calculationDetail: detail,
      explanation: `Pour ${year}, la réduction déclarée correspond ou dépasse la réduction estimée : aucun écart en votre faveur détecté.` });
  }
  if (f === 0) {
    return baseOpportunity(year, { ...common, status: 'non_reclamable', calculationDetail: detail,
      explanation: `Un écart est possible pour ${year}, mais cette période n'est plus réclamable (délai de ${claim.delayYears} an(s) dépassé). Vérifiez l'application de la réduction pour l'avenir.` });
  }
  const amounts = { low: roundCents(gap.low * f), central: roundCents(gap.central * f), high: roundCents(gap.high * f) };
  return baseOpportunity(year, { ...common, status: 'estime', amounts, calculationDetail: detail });
}

// ---------------------------------------------------------------------------
// Mode rapide : calcul par tranche
// ---------------------------------------------------------------------------

function computeQuickYear(input: EngineInput, q: QuickYearInput, ctx: ModuleContext): Opportunity {
  const year = q.year;
  const headcount = headcountFor(input, year, q);
  if (headcount === null) {
    return baseOpportunity(year, { status: 'informations_manquantes', missingInformation: [`Effectif moyen ${year}`],
      explanation: "L'effectif moyen est nécessaire pour déterminer le coefficient applicable." });
  }
  const yp = resolveYearParams(ctx.params, year, headcount);
  if (!yp.ok) {
    return baseOpportunity(year, { status: 'parametre_manquant', missingParameters: yp.missing,
      explanation: `Les paramètres officiels ${year} de la réduction générale ne sont pas encore publiés dans la plateforme : calcul suspendu.` });
  }
  const p = yp.params;
  const missingInformation: string[] = [];
  const hypotheses: string[] = [
    'Rémunérations des tranches exprimées en équivalent temps plein.',
    'Heures supplémentaires non prises en compte en mode rapide.',
    'Réduction et cotisations réparties uniformément sur les 12 mois pour le calcul du délai de réclamation.',
  ];
  const rows = q.brackets.filter((b) => b.employeeCount > 0).map((b) => {
    const bounds = BRACKET_BOUNDS[b.bracket];
    const perFte = bracketRange(p, bounds.low, bounds.high);
    const share = Math.min(1, Math.max(0, b.partTimeShare));
    let ratio: { low: number; central: number; high: number };
    if (share === 0) ratio = { low: 1, central: 1, high: 1 };
    else if (b.partTimeAverageRatio != null) ratio = { low: b.partTimeAverageRatio, central: b.partTimeAverageRatio, high: b.partTimeAverageRatio };
    else {
      ratio = PART_TIME_RATIO_HYPOTHESIS;
      missingInformation.push(`Quotité moyenne des temps partiels (${bounds.label}, ${year})`);
    }
    const fte = (r: number) => b.employeeCount * (1 - share + share * r);
    return {
      tranche: b.bracket,
      libelle: bounds.label,
      salaries: b.employeeCount,
      partTempsPartiel: share,
      reductionParEtp: { low: roundCents(perFte.low), central: roundCents(perFte.central), high: roundCents(perFte.high) },
      etp: { low: fte(ratio.low), central: fte(ratio.central), high: fte(ratio.high) },
      reduction: { low: perFte.low * fte(ratio.low), central: perFte.central * fte(ratio.central), high: perFte.high * fte(ratio.high) },
    };
  });
  if (rows.some((r) => r.partTempsPartiel > 0 && missingInformation.length)) {
    hypotheses.push(`Quotité des temps partiels inconnue : hypothèse ${PART_TIME_RATIO_HYPOTHESIS.low} à ${PART_TIME_RATIO_HYPOTHESIS.high}.`);
  }
  const theoretical = {
    low: sum(rows.map((r) => r.reduction.low)),
    central: sum(rows.map((r) => r.reduction.central)),
    high: sum(rows.map((r) => r.reduction.high)),
  };
  const calculationDetail = {
    mode: 'rapide',
    regime: p.regime,
    tailleEntreprise: p.sizeBand,
    effectif: headcount,
    smicAnnuelTempsPlein: roundCents(p.annualSmicFullTime),
    parametresCoefficient: p.coefficientParams,
    tranches: rows.map((r) => ({ ...r, reduction: { low: roundCents(r.reduction.low), central: roundCents(r.reduction.central), high: roundCents(r.reduction.high) } })),
    reductionTheorique: { low: roundCents(theoretical.low), central: roundCents(theoretical.central), high: roundCents(theoretical.high) },
    reductionDeclaree: q.declaredGeneralReduction,
    hypotheses,
  };

  if (q.declaredGeneralReduction === null) {
    return baseOpportunity(year, {
      status: 'informations_manquantes',
      confidence: 'faible',
      calculationDetail,
      missingInformation: [...missingInformation, `Montant de réduction générale appliqué en ${year}`],
      explanation: `Nous estimons la réduction à laquelle vous aviez droit en ${year} entre ${fmt(theoretical.low)} et ${fmt(theoretical.high)}, mais sans le montant déjà appliqué par votre paie nous ne pouvons pas chiffrer d'écart. Transmettez votre journal de paie annuel.`,
    });
  }
  const d = q.declaredGeneralReduction;
  const gap = { low: Math.max(0, theoretical.low - d), central: Math.max(0, theoretical.central - d), high: Math.max(0, theoretical.high - d) };
  const conditions = [`Régime : ${p.regime === 'rgdu' ? 'réduction générale dégressive unique' : 'réduction générale'}`, `Effectif ${headcount} (${p.sizeBand === 'moins_seuil' ? 'sous le seuil' : 'au-delà du seuil'})`];
  if (d > theoretical.high) conditions.push('Réduction déclarée supérieure à l’estimation haute : à vérifier (risque de sur-application).');
  return finalize(year, ctx, gap, (months) => months.length / 12, {
    confidence: missingInformation.length ? 'faible' : 'moyen',
    risk: 'standard',
    conditionsDetected: conditions,
    missingInformation,
    calculationDetail,
    explanation: `D'après la répartition de vos salaires, la réduction générale ${year} aurait pu atteindre ${fmt(theoretical.low)} à ${fmt(theoretical.high)}, contre ${fmt(d)} déclarés. L'écart, limité aux mois encore réclamables, est une estimation à confirmer par vos journaux de paie.`,
  });
}

// ---------------------------------------------------------------------------
// Mode avancé : salarié par salarié, mois par mois (données validées uniquement)
// ---------------------------------------------------------------------------

function computeAdvancedYear(input: EngineInput, year: number, lines: PayrollLine[], unvalidated: number, ctx: ModuleContext): Opportunity {
  const headcount = headcountFor(input, year);
  if (headcount === null) {
    return baseOpportunity(year, { status: 'informations_manquantes', missingInformation: [`Effectif moyen ${year}`],
      explanation: "L'effectif moyen est nécessaire pour déterminer le coefficient applicable." });
  }
  const yp = resolveYearParams(ctx.params, year, headcount);
  if (!yp.ok) {
    return baseOpportunity(year, { status: 'parametre_manquant', missingParameters: yp.missing,
      explanation: `Les paramètres officiels ${year} de la réduction générale ne sont pas encore publiés dans la plateforme : calcul suspendu.` });
  }
  const p = yp.params;
  const claim = claimableMonths(ctx.params, year, ctx.asOfDate);
  const claimable = new Set(claim.ok ? claim.claimableMonths : []);

  const byEmployee = new Map<string, PayrollLine[]>();
  for (const l of lines) {
    if (!byEmployee.has(l.employeeInternalId)) byEmployee.set(l.employeeInternalId, []);
    byEmployee.get(l.employeeInternalId)!.push(l);
  }
  const employees = [...byEmployee.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, ls]) => {
    const rab = sum(ls.map((l) => l.gross));
    const smicRef = sum(ls.map((l) => p.smicHourlyByMonth[l.month - 1]! * l.hoursPaid));
    const m = smicRef > 0 ? rab / smicRef : 0;
    const coefficient = p.coefficient(m);
    const theoretical = roundCents(coefficient * rab);
    const declared = roundCents(sum(ls.map((l) => l.reductionApplied)));
    const rawGap = roundCents(theoretical - declared);
    const gap = Math.abs(rawGap) < ROUNDING_TOLERANCE_EUR ? 0 : rawGap;
    const months = ls.map((l) => l.month);
    const fraction = months.length ? months.filter((mo) => claimable.has(mo)).length / months.length : 0;
    return { id, mois: months.length, rab: roundCents(rab), smicReference: roundCents(smicRef), multipleSmic: Number(m.toFixed(4)), coefficient, reductionTheorique: theoretical, reductionDeclaree: declared, ecart: gap, fractionReclamable: fraction };
  });

  const underApplied = sum(employees.filter((e) => e.ecart > 0).map((e) => e.ecart * e.fractionReclamable));
  const overApplied = sum(employees.filter((e) => e.ecart < 0).map((e) => -e.ecart * e.fractionReclamable));
  const net = Math.max(0, underApplied - overApplied);
  const totalGap = sum(employees.filter((e) => e.ecart > 0).map((e) => e.ecart));
  const conditions = [`Calcul individuel sur ${employees.length} salarié(s) et ${lines.length} mois de paie validés`];
  if (overApplied > 0) conditions.push(`Sur-application détectée pour certains salariés (${fmt(overApplied)} sur la période réclamable) : déduite de l'estimation basse, à régulariser.`);
  const missingInformation = unvalidated > 0 ? [`${unvalidated} ligne(s) de paie ${year} importée(s) non validée(s), exclue(s) du calcul`] : [];

  const calculationDetail = {
    mode: 'avance', regime: p.regime, tailleEntreprise: p.sizeBand, effectif: headcount,
    parametresCoefficient: p.coefficientParams, smicHoraireParMois: p.smicHourlyByMonth, salaries: employees,
    sousApplicationReclamable: roundCents(underApplied), surApplicationReclamable: roundCents(overApplied),
    hypotheses: ['SMIC de référence = Σ (SMIC horaire du mois × heures rémunérées hors majoration).', 'Écart individuel réparti uniformément sur les mois travaillés pour le délai de réclamation.', `Écarts individuels inférieurs à ${ROUNDING_TOLERANCE_EUR} € attribués aux arrondis et ignorés.`],
  };
  // high = écart brut si rien n'est réclamable : permet de distinguer « aucun écart » de « non réclamable ».
  return finalize(year, ctx, { low: net, central: net, high: underApplied > 0 ? underApplied : Math.max(0, totalGap) },
    // la fraction réclamable est déjà appliquée salarié par salarié
    () => (underApplied > 0 ? 1 : 0),
    {
      confidence: unvalidated > 0 ? 'moyen' : 'eleve',
      risk: overApplied > 0 ? 'standard' : 'faible',
      conditionsDetected: conditions,
      missingInformation,
      calculationDetail,
      explanation: `Le recalcul salarié par salarié de la réduction générale ${year} fait apparaître une sous-application de ${fmt(underApplied)} sur les mois encore réclamables${overApplied > 0 ? `, partiellement compensée par une sur-application de ${fmt(overApplied)}` : ''}.`,
    },
  );
}

function fmt(x: number): string {
  return `${Math.round(x).toLocaleString('fr-FR').replace(/ | /g, ' ')} €`;
}

export const m1ReductionGenerale: CalculationModule = {
  id: M1_ID,
  name: 'Réduction générale des cotisations patronales',
  description:
    "Recalcule la réduction générale (2023-2025) puis la réduction générale dégressive unique (à partir de 2026) et la compare à la réduction déclarée, sur les seules périodes encore réclamables.",
  kind: 'retroactif',
  version: M1_VERSION,
  requiredData: ['Effectif moyen annuel', 'Répartition des salaires par tranche (mode rapide) ou paie mensuelle par salarié (mode avancé)', 'Réduction générale déclarée'],
  eligibilityConditions: ['Employeur du secteur privé soumis à l’assurance chômage', 'Rémunérations inférieures au seuil de sortie du régime de l’année'],
  parameterKeys: [...Object.values(M1_KEYS), CLAIM_DELAY_KEY],
  applicablePeriod: { from: '2023-01-01', to: null },
  officialSources: SOURCES,
  requiredDocuments: DOCUMENTS,
  compute(input, ctx) {
    const out: Opportunity[] = [];
    const advancedYears = new Set<number>();
    if (input.mode === 'avance' && input.advanced) {
      const byYear = new Map<number, PayrollLine[]>();
      const unvalidated = new Map<number, number>();
      for (const l of input.advanced.payrollLines) {
        if (!regimeForYear(l.year)) continue;
        if (!l.validated) { unvalidated.set(l.year, (unvalidated.get(l.year) ?? 0) + 1); continue; }
        if (!byYear.has(l.year)) byYear.set(l.year, []);
        byYear.get(l.year)!.push(l);
      }
      for (const [year, lines] of [...byYear.entries()].sort(([a], [b]) => a - b)) {
        advancedYears.add(year);
        out.push(computeAdvancedYear(input, year, lines, unvalidated.get(year) ?? 0, ctx));
      }
    }
    // Les années sans paie validée retombent sur le mode rapide : aucune donnée n'est perdue.
    for (const q of [...(input.quick?.years ?? [])].sort((a, b) => a.year - b.year)) {
      if (!regimeForYear(q.year) || advancedYears.has(q.year)) continue;
      out.push(computeQuickYear(input, q, ctx));
    }
    return out.sort((a, b) => a.year - b.year);
  },
};
