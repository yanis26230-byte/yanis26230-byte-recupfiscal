import { createHash } from 'node:crypto';
import { detectCumulationConflicts, type CumulationConflict, type CumulationRule } from './cumulation.js';
import { assertIsoDate } from './dates.js';
import { roundCents } from './money.js';
import { ParameterResolver } from './parameters.js';
import { ReferenceResolver, type ReferenceIds } from './reference-data.js';
import type {
  AmountRange,
  CalculationModule,
  EngineInput,
  MissingParameter,
  Opportunity,
  ParameterDataset,
  ReferenceData,
  RegulatoryParameter,
} from './types.js';

export const ENGINE_VERSION = '0.2.0';

export interface Totals {
  /** Récupération passée estimée (opportunités « estime », hors conflits de cumul). */
  pastRecovery: AmountRange;
  /** Économies futures annuelles estimées. Jamais additionnées à la récupération passée. */
  futureAnnualSavings: AmountRange;
}

export interface CalculationRunRecord {
  /** Empreinte déterministe des entrées (moteur, modules, paramètres, données). */
  inputHash: string;
  engineVersion: string;
  moduleVersions: Record<string, string>;
  dataset: ParameterDataset;
  /** Identifiants exacts des paramètres utilisés. */
  parameterIds: string[];
  /** Copie figée des paramètres utilisés (valeurs, versions, sources) pour l'audit. */
  parameterSnapshot: RegulatoryParameter[];
  /** Données de référence utilisées (zonages, dispositifs zonaux) : identifiants et copie. */
  referenceIds: ReferenceIds;
  referenceSnapshot: ReferenceData;
  frozenInput: EngineInput;
  opportunities: Opportunity[];
  cumulationConflicts: CumulationConflict[];
  /** Paramètres manquants agrégés : « règles à compléter » côté back-office. */
  missingParameters: MissingParameter[];
  totals: Totals;
  /** Empreinte des sorties : sert à vérifier un rejeu à l'identique. */
  outputHash: string;
}

/** JSON canonique (clés triées) pour des empreintes stables. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function deepFreezeClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function addRange(acc: AmountRange, r: AmountRange): AmountRange {
  return { low: acc.low + r.low, central: acc.central + r.central, high: acc.high + r.high };
}

const ZERO: AmountRange = { low: 0, central: 0, high: 0 };

export function computeTotals(opportunities: readonly Opportunity[], conflicts: readonly CumulationConflict[]): Totals {
  const conflicted = new Set(conflicts.flatMap((c) => c.moduleIds.flatMap((m) => c.assiettes.map((a) => `${m}|${a}`))));
  const isConflicted = (o: Opportunity) => o.assiettes.some((a) => conflicted.has(`${o.moduleId}|${a}`));
  let past = ZERO;
  let future = ZERO;
  for (const o of opportunities) {
    if (o.status !== 'estime' || !o.amounts || !o.countsInTotals || isConflicted(o)) continue;
    if (o.kind === 'recuperation_passee') past = addRange(past, o.amounts);
    else future = addRange(future, o.amounts);
  }
  const r = (x: AmountRange): AmountRange => ({ low: roundCents(x.low), central: roundCents(x.central), high: roundCents(x.high) });
  return { pastRecovery: r(past), futureAnnualSavings: r(future) };
}

export interface RunOptions {
  modules: readonly CalculationModule[];
  parameters: readonly RegulatoryParameter[];
  dataset: ParameterDataset;
  cumulationRules?: readonly CumulationRule[];
  referenceData?: ReferenceData;
  /** Usage interne (rejeu) : restreint la résolution à ces identifiants. */
  pinnedParameterIds?: ReadonlySet<string>;
  pinnedReferenceIds?: ReferenceIds;
}

/**
 * Exécute les modules actifs sur des données figées. Fonction pure : même entrée,
 * mêmes paramètres, mêmes versions => même sortie, octet pour octet.
 */
export function runCalculation(input: EngineInput, options: RunOptions): CalculationRunRecord {
  assertIsoDate(input.asOfDate);
  const frozenInput = deepFreezeClone(input);
  const resolver = new ParameterResolver(options.parameters, {
    dataset: options.dataset,
    pinnedIds: options.pinnedParameterIds,
  });
  const reference = new ReferenceResolver(options.referenceData, { dataset: options.dataset, pinned: options.pinnedReferenceIds });
  const modules = [...options.modules].sort((a, b) => (a.id < b.id ? -1 : 1));
  const ids = new Set<string>();
  for (const m of modules) {
    if (ids.has(m.id)) throw new Error(`Module en double : ${m.id}`);
    ids.add(m.id);
  }

  const opportunities: Opportunity[] = [];
  for (const m of modules) {
    for (const o of m.compute(deepFreezeClone(frozenInput), { params: resolver, reference, asOfDate: frozenInput.asOfDate })) {
      if (o.status !== 'estime' && o.amounts !== null) {
        throw new Error(`Module ${m.id} : une opportunité au statut « ${o.status} » ne peut pas porter de montant.`);
      }
      if (o.status === 'estime' && o.amounts === null) {
        throw new Error(`Module ${m.id} : une opportunité « estime » doit porter un montant.`);
      }
      opportunities.push(o);
    }
  }

  const conflicts = detectCumulationConflicts(opportunities, options.cumulationRules ?? []);
  const totals = computeTotals(opportunities, conflicts);
  const used = resolver.usedParameters();
  const moduleVersions = Object.fromEntries(modules.map((m) => [m.id, m.version]));
  const parameterIds = used.map((p) => p.id);
  const referenceIds = reference.usedIds();

  const missingMap = new Map<string, MissingParameter>();
  for (const o of opportunities) {
    for (const mp of o.missingParameters) missingMap.set(`${mp.key}|${mp.periodFrom}|${mp.periodTo}`, mp);
  }
  const missingParameters = [...missingMap.values()].sort((a, b) =>
    canonicalJson(a) < canonicalJson(b) ? -1 : 1,
  );

  const inputHash = sha256(
    canonicalJson({ engineVersion: ENGINE_VERSION, moduleVersions, dataset: options.dataset, parameterIds, referenceIds, frozenInput }),
  );
  const outputHash = sha256(canonicalJson({ opportunities, conflicts, totals }));

  return {
    inputHash,
    engineVersion: ENGINE_VERSION,
    moduleVersions,
    dataset: options.dataset,
    parameterIds,
    parameterSnapshot: deepFreezeClone(used),
    referenceIds,
    referenceSnapshot: deepFreezeClone(reference.usedSnapshot()),
    frozenInput,
    opportunities,
    cumulationConflicts: conflicts,
    missingParameters,
    totals,
    outputHash,
  };
}

export type ReplayResult =
  | { identical: true; run: CalculationRunRecord }
  | { identical: false; reason: string; run?: CalculationRunRecord };

/**
 * Rejoue un calcul enregistré avec exactement les mêmes paramètres (par identifiant),
 * même s'ils ont été archivés depuis. Les versions de modules doivent correspondre.
 */
export function replayCalculation(
  record: CalculationRunRecord,
  options: {
    modules: readonly CalculationModule[];
    parameters: readonly RegulatoryParameter[];
    cumulationRules?: readonly CumulationRule[];
    referenceData?: ReferenceData;
  },
): ReplayResult {
  if (record.engineVersion !== ENGINE_VERSION) {
    return { identical: false, reason: `Version du moteur différente (${record.engineVersion} ≠ ${ENGINE_VERSION}).` };
  }
  for (const [id, v] of Object.entries(record.moduleVersions)) {
    const m = options.modules.find((x) => x.id === id);
    if (!m || m.version !== v) return { identical: false, reason: `Module ${id} en version ${v} indisponible.` };
  }
  const modules = options.modules.filter((m) => m.id in record.moduleVersions);
  const available = new Set(options.parameters.map((p) => p.id));
  const absent = record.parameterIds.filter((id) => !available.has(id));
  if (absent.length) return { identical: false, reason: `Paramètres introuvables : ${absent.join(', ')}` };
  const ref = options.referenceData;
  const refAvailable = new Set([
    ...(ref?.zoningDatasets ?? []).map((d) => d.id),
    ...(ref?.zoningEntries ?? []).map((e) => e.id),
    ...(ref?.zoneSchemes ?? []).map((z) => z.id),
  ]);
  const refAbsent = [...record.referenceIds.zoningDatasets, ...record.referenceIds.zoningEntries, ...record.referenceIds.zoneSchemes]
    .filter((id) => !refAvailable.has(id));
  if (refAbsent.length) return { identical: false, reason: `Données de référence introuvables : ${refAbsent.join(', ')}` };

  const run = runCalculation(record.frozenInput, {
    modules,
    parameters: options.parameters,
    dataset: record.dataset,
    cumulationRules: options.cumulationRules,
    referenceData: options.referenceData,
    pinnedParameterIds: new Set(record.parameterIds),
    pinnedReferenceIds: record.referenceIds,
  });
  if (run.outputHash !== record.outputHash) return { identical: false, reason: 'Résultats différents.', run };
  return { identical: true, run };
}
