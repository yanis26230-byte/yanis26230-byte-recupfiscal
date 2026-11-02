import { monthEnd, monthStart, yearEnd, yearStart } from '../../dates.js';
import { resolveAll, type ParameterResolver } from '../../parameters.js';
import type { MissingParameter } from '../../types.js';
import { regimeForYear, rgCoefficient, rgduCoefficient, type CoefficientFn, type Regime } from './formulas.js';

export const M1_KEYS = {
  smicHoraire: 'smic_horaire',
  dureeMensuelle: 'duree_legale_mensuelle_heures',
  seuilEffectif: 'reduction_generale_seuil_effectif',
  decimales: 'reduction_generale_arrondi_coefficient_decimales',
  rgTmaxMoins: 'rg_tmax_moins_seuil_effectif',
  rgTmaxPlus: 'rg_tmax_seuil_effectif_et_plus',
  rgSeuilSortie: 'rg_seuil_sortie_smic',
  rgduTminMoins: 'rgdu_tmin_moins_seuil_effectif',
  rgduTminPlus: 'rgdu_tmin_seuil_effectif_et_plus',
  rgduTdeltaMoins: 'rgdu_tdelta_moins_seuil_effectif',
  rgduTdeltaPlus: 'rgdu_tdelta_seuil_effectif_et_plus',
  rgduPuissance: 'rgdu_puissance',
  rgduSeuilSortie: 'rgdu_seuil_sortie_smic',
} as const;

export interface YearParams {
  year: number;
  regime: Regime;
  sizeBand: 'moins_seuil' | 'seuil_et_plus';
  /** SMIC horaire de chaque mois (index 0 = janvier). */
  smicHourlyByMonth: number[];
  monthlyLegalHours: number;
  /** SMIC annuel temps plein = Σ SMIC horaire du mois × durée légale mensuelle. */
  annualSmicFullTime: number;
  coefficient: CoefficientFn;
  exitThreshold: number;
  coefficientParams: Record<string, number>;
}

export type YearParamsResult = { ok: true; params: YearParams } | { ok: false; missing: MissingParameter[] };

/**
 * Résout tous les paramètres M1 d'une année. Chaque paramètre doit couvrir l'année entière
 * (sauf le SMIC, résolu mois par mois car il peut être revalorisé en cours d'année).
 */
export function resolveYearParams(resolver: ParameterResolver, year: number, headcount: number): YearParamsResult {
  const regime = regimeForYear(year);
  if (!regime) throw new Error(`Année hors périmètre du module M1 : ${year}`);
  const from = yearStart(year);
  const to = yearEnd(year);
  const missing: MissingParameter[] = [];

  const common = resolveAll(resolver, [M1_KEYS.dureeMensuelle, M1_KEYS.seuilEffectif, M1_KEYS.decimales], from, to);
  if (!common.ok) missing.push(...common.missing);

  const smicHourlyByMonth: number[] = [];
  const smicMissing: MissingParameter[] = [];
  for (let m = 1; m <= 12; m++) {
    const r = resolver.resolve(M1_KEYS.smicHoraire, monthStart(year, m), monthEnd(year, m));
    if (r.ok) smicHourlyByMonth.push(r.value);
    else smicMissing.push(r.missing);
  }
  // Toute l'année manquante pour la même raison : une seule ligne « règle à compléter ».
  if (smicMissing.length === 12 && new Set(smicMissing.map((x) => x.reason)).size === 1) {
    missing.push({ ...smicMissing[0]!, periodFrom: from, periodTo: to });
  } else missing.push(...smicMissing);

  // Sans seuil publié, la taille est inconnue : on contrôle les clés des deux tailles pour
  // lister au back-office l'ensemble des règles à compléter.
  const seuil = common.ok ? common.values[M1_KEYS.seuilEffectif] : null;
  const decimals = common.ok ? common.values[M1_KEYS.decimales] : 0;
  const sizeBand = seuil === null ? null : headcount < seuil ? ('moins_seuil' as const) : ('seuil_et_plus' as const);
  const pick = <T,>(moins: T, plus: T): T[] => (sizeBand === null ? [moins, plus] : [sizeBand === 'seuil_et_plus' ? plus : moins]);

  let coefficient: CoefficientFn | null = null;
  let exitThreshold = 0;
  let coefficientParams: Record<string, number> = {};

  if (regime === 'rg_ancienne') {
    const tmaxKeys = pick(M1_KEYS.rgTmaxMoins, M1_KEYS.rgTmaxPlus);
    const r = resolveAll(resolver, [...tmaxKeys, M1_KEYS.rgSeuilSortie], from, to);
    if (!r.ok) missing.push(...r.missing);
    else if (sizeBand !== null) {
      const p = { tmax: r.values[tmaxKeys[0]!], exitThreshold: r.values[M1_KEYS.rgSeuilSortie], decimals };
      coefficient = (m) => rgCoefficient(m, p);
      exitThreshold = p.exitThreshold;
      coefficientParams = { ...p };
    }
  } else {
    const tminKeys = pick(M1_KEYS.rgduTminMoins, M1_KEYS.rgduTminPlus);
    const tdeltaKeys = pick(M1_KEYS.rgduTdeltaMoins, M1_KEYS.rgduTdeltaPlus);
    const r = resolveAll(resolver, [...tminKeys, ...tdeltaKeys, M1_KEYS.rgduPuissance, M1_KEYS.rgduSeuilSortie], from, to);
    if (!r.ok) missing.push(...r.missing);
    else if (sizeBand !== null) {
      const p = {
        tmin: r.values[tminKeys[0]!],
        tdelta: r.values[tdeltaKeys[0]!],
        power: r.values[M1_KEYS.rgduPuissance],
        exitThreshold: r.values[M1_KEYS.rgduSeuilSortie],
        decimals,
      };
      coefficient = (m) => rgduCoefficient(m, p);
      exitThreshold = p.exitThreshold;
      coefficientParams = { ...p };
    }
  }

  if (missing.length || !coefficient || !common.ok || sizeBand === null) return { ok: false, missing: dedupe(missing) };
  const monthlyLegalHours = common.values[M1_KEYS.dureeMensuelle];
  const annualSmicFullTime = smicHourlyByMonth.reduce((a, s) => a + s * monthlyLegalHours, 0);
  return {
    ok: true,
    params: { year, regime, sizeBand, smicHourlyByMonth, monthlyLegalHours, annualSmicFullTime, coefficient, exitThreshold, coefficientParams },
  };
}

function dedupe(ms: MissingParameter[]): MissingParameter[] {
  const seen = new Map<string, MissingParameter>();
  for (const m of ms) seen.set(`${m.key}|${m.periodFrom}|${m.periodTo}`, m);
  return [...seen.values()];
}
