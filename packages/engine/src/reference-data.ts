import { cmp } from './dates.js';
import type { MissingParameter, ParameterDataset, ReferenceData, ZoneScheme, ZoningDataset, ZoningEntry } from './types.js';

export interface ReferenceIds {
  zoningDatasets: string[];
  zoningEntries: string[];
  zoneSchemes: string[];
}

const EMPTY: ReferenceData = { zoningDatasets: [], zoningEntries: [], zoneSchemes: [] };

/**
 * Accès aux données de référence versionnées (zonages, dispositifs zonaux), avec les mêmes
 * règles que les paramètres : jeu publié uniquement, couverture exacte de la période, aucune
 * conclusion en l'absence de table importée. Les éléments utilisés sont mémorisés pour le
 * calculation_run ; en rejeu, seuls les identifiants épinglés sont utilisables.
 */
export class ReferenceResolver {
  private readonly usedDatasets = new Map<string, ZoningDataset>();
  private readonly usedEntries = new Map<string, ZoningEntry>();
  private readonly usedSchemes = new Map<string, ZoneScheme>();
  private readonly data: ReferenceData;

  constructor(
    data: ReferenceData | undefined,
    private readonly options: { dataset: ParameterDataset; pinned?: ReferenceIds },
  ) {
    this.data = data ?? EMPTY;
  }

  private usable(item: { id: string; status: string; dataset: ParameterDataset }, pinned?: string[]): boolean {
    if (item.dataset !== this.options.dataset) return false;
    if (pinned) return pinned.includes(item.id);
    return item.status === 'publie';
  }

  private covers(item: { validFrom: string; validTo: string | null }, from: string, to: string) {
    return cmp(item.validFrom, from) <= 0 && (item.validTo === null || cmp(item.validTo, to) >= 0);
  }

  private overlaps(item: { validFrom: string; validTo: string | null }, from: string, to: string) {
    return cmp(item.validFrom, to) <= 0 && (item.validTo === null || cmp(item.validTo, from) >= 0);
  }

  /** Types de zone pour lesquels au moins un dispositif publié existe sur la période. */
  zoneTypesWithSchemes(from: string, to: string): string[] {
    return [...new Set(this.schemesOverlapping(from, to).map((s) => s.zoneType))].sort();
  }

  private schemesOverlapping(from: string, to: string): ZoneScheme[] {
    return this.data.zoneSchemes.filter((s) => this.usable(s, this.options.pinned?.zoneSchemes) && this.overlaps(s, from, to));
  }

  /** Dispositifs publiés d'un type de zone valables sur la période (pas d'emprunt à une autre période). */
  schemesFor(zoneType: string, from: string, to: string): ZoneScheme[] {
    const list = this.schemesOverlapping(from, to)
      .filter((s) => s.zoneType === zoneType)
      .sort((a, b) => cmp(a.code, b.code));
    list.forEach((s) => this.usedSchemes.set(s.id, s));
    return list;
  }

  /**
   * Classement d'une commune dans un type de zone sur une période. Échec si aucune table
   * publiée ne couvre la période : on ne conclut jamais « hors zone » sans table.
   */
  zoneMembership(
    zoneType: string,
    inseeCode: string,
    from: string,
    to: string,
  ): { ok: true; dataset: ZoningDataset; entries: ZoningEntry[] } | { ok: false; missing: MissingParameter } {
    const key = `zonage:${zoneType}`;
    const candidates = this.data.zoningDatasets.filter((d) => d.zoneType === zoneType && d.dataset === this.options.dataset && this.overlaps(d, from, to));
    const usable = candidates.filter((d) => this.usable(d, this.options.pinned?.zoningDatasets) && this.covers(d, from, to));
    if (usable.length === 0) {
      return {
        ok: false,
        missing: {
          key, periodFrom: from, periodTo: to,
          reason: candidates.length === 0 ? 'absent' : candidates.some((c) => c.status === 'publie') ? 'couverture_partielle' : 'non_publie',
          ...(candidates.length ? { foundStatuses: [...new Set(candidates.map((c) => c.status))] } : {}),
        },
      };
    }
    if (usable.length > 1) return { ok: false, missing: { key, periodFrom: from, periodTo: to, reason: 'ambigu' } };
    const dataset = usable[0]!;
    const entries = this.data.zoningEntries
      .filter((e) => e.datasetId === dataset.id && e.inseeCode === inseeCode && this.overlaps(e, from, to))
      .sort((a, b) => cmp(a.validFrom, b.validFrom));
    this.usedDatasets.set(dataset.id, dataset);
    entries.forEach((e) => this.usedEntries.set(e.id, e));
    return { ok: true, dataset, entries };
  }

  usedIds(): ReferenceIds {
    const ids = (m: Map<string, unknown>) => [...m.keys()].sort();
    return { zoningDatasets: ids(this.usedDatasets), zoningEntries: ids(this.usedEntries), zoneSchemes: ids(this.usedSchemes) };
  }

  usedSnapshot(): ReferenceData {
    const vals = <T extends { id: string }>(m: Map<string, T>) => [...m.values()].sort((a, b) => cmp(a.id, b.id));
    return { zoningDatasets: vals(this.usedDatasets), zoningEntries: vals(this.usedEntries), zoneSchemes: vals(this.usedSchemes) };
  }
}
