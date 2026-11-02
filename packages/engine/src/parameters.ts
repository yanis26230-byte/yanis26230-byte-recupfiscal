import { addDays, assertIsoDate, cmp } from './dates.js';
import type {
  MissingParameter,
  ParameterDataset,
  RegulatoryParameter,
} from './types.js';

export type Resolved =
  | { ok: true; value: number; parameter: RegulatoryParameter }
  | { ok: false; missing: MissingParameter };

export interface Segment {
  from: string;
  to: string;
  value: number;
  parameter: RegulatoryParameter;
}

export type ResolvedSegments =
  | { ok: true; segments: Segment[] }
  | { ok: false; missing: MissingParameter };

export interface ResolverOptions {
  dataset: ParameterDataset;
  territory?: string;
  /**
   * Rejeu d'un calcul ancien : seuls ces identifiants sont utilisables, quel que soit
   * leur statut actuel (ils étaient publiés au moment du calcul initial).
   */
  pinnedIds?: ReadonlySet<string>;
}

/**
 * Résolution stricte des paramètres réglementaires.
 *
 * Règles (cahier des charges §7) :
 * - seuls les paramètres « publiés » du bon jeu et du bon territoire sont utilisés ;
 * - la valeur doit couvrir EXACTEMENT la période demandée (pas d'extrapolation,
 *   jamais la valeur d'une autre année) ;
 * - en cas d'absence, de chevauchement ou de couverture partielle : échec explicite,
 *   jamais de valeur par défaut.
 *
 * Le résolveur mémorise chaque paramètre utilisé pour l'enregistrer dans calculation_runs.
 */
export class ParameterResolver {
  private readonly used = new Map<string, RegulatoryParameter>();
  private readonly territory: string;

  constructor(
    private readonly all: readonly RegulatoryParameter[],
    private readonly options: ResolverOptions,
  ) {
    this.territory = options.territory ?? 'FR';
  }

  get dataset(): ParameterDataset {
    return this.options.dataset;
  }

  /** Paramètres effectivement utilisés, triés par identifiant. */
  usedParameters(): RegulatoryParameter[] {
    return [...this.used.values()].sort((a, b) => cmp(a.id, b.id));
  }

  private candidates(key: string) {
    return this.all.filter(
      (p) => p.key === key && p.dataset === this.options.dataset && p.territory === this.territory,
    );
  }

  private isUsable(p: RegulatoryParameter): boolean {
    if (this.options.pinnedIds) return this.options.pinnedIds.has(p.id);
    return p.status === 'publie';
  }

  private overlaps(p: RegulatoryParameter, from: string, to: string): boolean {
    return cmp(p.validFrom, to) <= 0 && (p.validTo === null || cmp(p.validTo, from) >= 0);
  }

  /** Une seule valeur publiée doit couvrir toute la période [from, to]. */
  resolve(key: string, from: string, to: string): Resolved {
    const seg = this.resolveSegments(key, from, to);
    if (!seg.ok) return seg;
    if (seg.segments.length !== 1) {
      return { ok: false, missing: { key, periodFrom: from, periodTo: to, reason: 'decoupage_infra_annuel' } };
    }
    const s = seg.segments[0]!;
    return { ok: true, value: s.value, parameter: s.parameter };
  }

  /**
   * Plusieurs valeurs publiées successives peuvent couvrir la période (ex. SMIC revalorisé
   * en cours d'année). La couverture doit être continue, sans trou ni chevauchement.
   */
  resolveSegments(key: string, from: string, to: string): ResolvedSegments {
    assertIsoDate(from);
    assertIsoDate(to);
    const missing = (reason: MissingParameter['reason'], extra?: Partial<MissingParameter>) =>
      ({ ok: false as const, missing: { key, periodFrom: from, periodTo: to, reason, ...extra } });

    const overlapping = this.candidates(key).filter((p) => this.overlaps(p, from, to));
    if (overlapping.length === 0) return missing('absent');

    const usable = overlapping.filter((p) => this.isUsable(p));
    if (usable.length === 0) {
      return missing('non_publie', { foundStatuses: [...new Set(overlapping.map((p) => p.status))] });
    }
    if (usable.some((p) => p.value === null || !Number.isFinite(p.value))) return missing('sans_valeur');

    const sorted = [...usable].sort((a, b) => cmp(a.validFrom, b.validFrom));
    // Chevauchement entre deux versions publiées = ambiguïté, on refuse.
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      if (prev.validTo === null || cmp(prev.validTo, sorted[i]!.validFrom) >= 0) return missing('ambigu');
    }

    // Couverture continue de [from, to].
    const segments: Segment[] = [];
    let cursor = from;
    for (const p of sorted) {
      if (cmp(p.validFrom, cursor) > 0) {
        return missing('couverture_partielle', { foundStatuses: overlapping.map((o) => o.status) });
      }
      const segTo = p.validTo === null || cmp(p.validTo, to) > 0 ? to : p.validTo;
      segments.push({ from: cursor, to: segTo, value: p.value as number, parameter: p });
      if (cmp(segTo, to) >= 0) {
        segments.forEach((s) => this.used.set(s.parameter.id, s.parameter));
        return { ok: true, segments };
      }
      cursor = addDays(segTo, 1);
    }
    return missing('couverture_partielle', { foundStatuses: overlapping.map((o) => o.status) });
  }
}

/**
 * Résout plusieurs clés sur une même période. Renvoie toutes les valeurs ou la liste
 * complète des paramètres manquants (utile pour le back-office : « règles à compléter »).
 */
export function resolveAll<K extends string>(
  resolver: ParameterResolver,
  keys: readonly K[],
  from: string,
  to: string,
): { ok: true; values: Record<K, number> } | { ok: false; missing: MissingParameter[] } {
  const values = {} as Record<K, number>;
  const missing: MissingParameter[] = [];
  for (const k of keys) {
    const r = resolver.resolve(k, from, to);
    if (r.ok) values[k] = r.value;
    else missing.push(r.missing);
  }
  return missing.length ? { ok: false, missing } : { ok: true, values };
}
