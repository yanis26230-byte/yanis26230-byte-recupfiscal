import { claimableMonths } from '../../claim.js';
import { cmp, yearEnd, yearOf, yearStart } from '../../dates.js';
import type { CalculationModule, EngineInput, EstablishmentInput, MissingParameter, ModuleContext, Opportunity, SourceRef } from '../../types.js';
import { makeOpportunity } from '../common.js';

export const M4_ID = 'M4_ZONAGES';
export const M4_VERSION = '1.0.0';

/**
 * Années analysées : celles pour lesquelles l'audit contient des données, plus l'année de
 * référence (pour le volet « futur »).
 */
export function analysedYears(input: EngineInput): number[] {
  const years = new Set<number>([yearOf(input.asOfDate)]);
  Object.keys(input.company.headcountByYear).forEach((y) => years.add(Number(y)));
  input.quick?.years.forEach((y) => years.add(y.year));
  input.establishmentYears?.forEach((y) => years.add(y.year));
  return [...years].filter((y) => y >= 2023 && y <= yearOf(input.asOfDate)).sort((a, b) => a - b);
}

function computeEstablishment(input: EngineInput, e: EstablishmentInput, years: number[], ctx: ModuleContext): Opportunity[] {
  const first = years[0]!;
  const last = years.at(-1)!;
  const base = {
    moduleId: M4_ID, moduleVersion: M4_VERSION, kind: 'recuperation_passee' as const,
    year: first, periodFrom: yearStart(first), periodTo: yearEnd(last),
  };
  if (!e.inseeCode) {
    return [makeOpportunity({ ...base, name: `Dispositifs zonaux – établissement ${e.siret}` }, {
      status: 'informations_manquantes', missingInformation: [`Code commune INSEE de l’établissement ${e.siret}`],
      explanation: 'Le code commune est nécessaire pour vérifier les zonages applicables.' })];
  }
  const zoneTypes = ctx.reference.zoneTypesWithSchemes(yearStart(first), yearEnd(last));
  const out: Opportunity[] = [];
  for (const zoneType of zoneTypes) {
    const missing: MissingParameter[] = [];
    const inZoneYears: number[] = [];
    const sources: SourceRef[] = [];
    for (const y of years) {
      const m = ctx.reference.zoneMembership(zoneType, e.inseeCode, yearStart(y), yearEnd(y));
      if (!m.ok) { missing.push(m.missing); continue; }
      if (m.entries.length) {
        inZoneYears.push(y);
        if (!sources.some((s) => s.url === m.dataset.sourceUrl)) sources.push({ label: m.dataset.sourceLabel, url: m.dataset.sourceUrl });
      }
    }
    const name = `Zonage ${zoneType.toUpperCase()} – établissement ${e.siret}`;
    if (missing.length) {
      // Une table de zonage manquante empêche de conclure, même pour les autres années.
      out.push(makeOpportunity({ ...base, name }, { status: 'parametre_manquant', missingParameters: missing,
        calculationDetail: { typeDeZone: zoneType, communeInsee: e.inseeCode, anneesEnZone: inZoneYears },
        explanation: `La table officielle du zonage ${zoneType.toUpperCase()} n’est pas importée pour toute la période : impossible de conclure.` }));
      continue;
    }
    if (!inZoneYears.length) continue; // commune hors zone sur toute la période, d'après des tables sourcées

    const asOfYear = yearOf(ctx.asOfDate);
    const claimInfo = inZoneYears.map((y) => {
      const c = claimableMonths(ctx.params, y, ctx.asOfDate);
      return { year: y, claimableMonths: c.ok ? c.claimableMonths : null };
    });
    const claimMissing = claimInfo.some((c) => c.claimableMonths === null);
    // Années (y compris l'année en cours) ayant au moins un mois écoulé encore réclamable.
    const pastClaimable = claimInfo.filter((c) => (c.claimableMonths?.length ?? 0) > 0).map((c) => c.year);
    const inZoneNow = inZoneYears.includes(asOfYear) &&
      ctx.reference.zoneMembership(zoneType, e.inseeCode, ctx.asOfDate, ctx.asOfDate).ok;

    for (const scheme of ctx.reference.schemesFor(zoneType, yearStart(inZoneYears[0]!), yearEnd(inZoneYears.at(-1)!))) {
      const schemeYears = inZoneYears.filter((y) => cmp(scheme.validFrom, yearEnd(y)) <= 0 && (scheme.validTo === null || cmp(scheme.validTo, yearStart(y)) >= 0));
      if (!schemeYears.length) continue;
      const detail = { typeDeZone: zoneType, communeInsee: e.inseeCode, dispositif: scheme.code, anneesEnZone: schemeYears, reclamabilite: claimInfo,
        estimation: 'Aucune estimation automatique : l’application dépend des embauches, des rémunérations et des conditions du dispositif.' };
      const common: Partial<Opportunity> = {
        status: 'a_confirmer', confidence: 'faible', risk: 'standard', calculationDetail: detail,
        conditionsDetected: [`Commune ${e.inseeCode} classée ${zoneType.toUpperCase()} en ${schemeYears.join(', ')}`, ...scheme.conditions],
        sources: [...sources, { label: scheme.name, url: scheme.sourceUrl }], documentsToProvide: scheme.documentsToProvide,
        missingParameters: claimMissing ? [{ key: 'delai_reclamation_cotisations_annees', periodFrom: ctx.asOfDate, periodTo: ctx.asOfDate, reason: 'non_publie' }] : [],
        assiettes: schemeYears.map((y) => `cotisations_patronales:allegements:${y}:${e.siret}`),
      };
      const pastYears = schemeYears.filter((y) => pastClaimable.includes(y));
      if (pastYears.length) {
        out.push(makeOpportunity({ ...base, name: `${scheme.name} – établissement ${e.siret}`, year: pastYears[0]!, periodFrom: yearStart(pastYears[0]!), periodTo: yearEnd(pastYears.at(-1)!) }, {
          ...common, explanation: `L’établissement est situé dans une commune classée ${zoneType.toUpperCase()}. Le dispositif « ${scheme.name} » est potentiellement applicable sur ${pastYears.join(', ')} : à confirmer par l’analyse de vos embauches et de vos déclarations.` }));
      } else if (!inZoneNow) {
        out.push(makeOpportunity({ ...base, name: `${scheme.name} – établissement ${e.siret}` }, { ...common, status: 'non_reclamable',
          explanation: `La commune était classée ${zoneType.toUpperCase()} sur ${schemeYears.join(', ')}, mais ces périodes ne sont plus réclamables.` }));
      }
      if (inZoneNow && schemeYears.includes(asOfYear)) {
        out.push(makeOpportunity({ ...base, kind: 'economie_future', name: `${scheme.name} – établissement ${e.siret} (à venir)`, year: asOfYear, periodFrom: ctx.asOfDate, periodTo: yearEnd(asOfYear) }, {
          ...common, assiettes: [`cotisations_patronales:allegements:futur:${e.siret}`],
          explanation: `La commune est actuellement classée ${zoneType.toUpperCase()} : le dispositif « ${scheme.name} » est à étudier pour vos prochaines embauches.` }));
      }
    }
  }
  return out;
}

export const m4Zonages: CalculationModule = {
  id: M4_ID,
  name: 'Aides et exonérations zonales',
  description: 'Recherche, pour la commune de chaque établissement, les zonages officiels importés (versionnés par période, avec source) et les dispositifs associés.',
  kind: 'mixte',
  version: M4_VERSION,
  requiredData: ['Code commune INSEE de chaque établissement'],
  eligibilityConditions: ['Commune classée dans une table de zonage officielle publiée', 'Conditions propres à chaque dispositif (saisies avec leur source)'],
  parameterKeys: ['delai_reclamation_cotisations_annees', 'zonage:<type de zone> (tables importées)'],
  applicablePeriod: { from: '2023-01-01', to: null },
  officialSources: [],
  requiredDocuments: [],
  compute(input, ctx) {
    const years = analysedYears(input);
    if (!years.length) return [];
    if (!ctx.reference.zoneTypesWithSchemes(yearStart(years[0]!), yearEnd(years.at(-1)!)).length) {
      return [makeOpportunity({ moduleId: M4_ID, moduleVersion: M4_VERSION, name: 'Dispositifs zonaux', kind: 'recuperation_passee',
        year: years[0]!, periodFrom: yearStart(years[0]!), periodTo: yearEnd(years.at(-1)!) }, {
        status: 'parametre_manquant',
        missingParameters: [{ key: 'zonage:dispositifs', periodFrom: yearStart(years[0]!), periodTo: yearEnd(years.at(-1)!), reason: 'absent' }],
        explanation: 'Aucun dispositif zonal n’est encore publié dans la plateforme : analyse des zonages suspendue.' })];
    }
    const establishments = [...(input.establishments ?? [])].sort((a, b) => (a.siret < b.siret ? -1 : 1));
    return establishments.flatMap((e) => computeEstablishment(input, e, years, ctx));
  },
};
