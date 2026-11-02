import { claimableMonths } from '../../claim.js';
import { yearEnd, yearStart } from '../../dates.js';
import { formatEuro, roundCents } from '../../money.js';
import type { CalculationModule, EngineInput, EstablishmentInput, EstablishmentYearInput, ModuleContext, Opportunity, SourceRef } from '../../types.js';
import { makeOpportunity, range } from '../common.js';

export const M3_ID = 'M3_TAUX_AT';
export const M3_VERSION = '1.0.0';

/** Taux collectif attendu pour un code risque (publié chaque année), utilisé à titre indicatif. */
export const expectedRateKey = (riskCode: string) => `taux_at_collectif_${riskCode}`;

/** En dessous de cet écart (en points de taux), les taux sont considérés identiques. */
export const RATE_EPSILON = 1e-6;

const SOURCES: SourceRef[] = [
  { label: 'Ameli – taux de cotisation AT/MP', url: 'https://www.ameli.fr/entreprise' },
  { label: 'net-entreprises.fr – compte AT/MP', url: 'https://www.net-entreprises.fr' },
];
const DOCUMENTS = ['Notification annuelle du taux AT/MP de chaque établissement (compte AT/MP)', 'Journal de paie ou DSN montrant le taux appliqué', 'Masse salariale de l’établissement'];

const pct = (x: number) => `${(x * 100).toFixed(2).replace('.', ',')} %`;

function computeEstablishmentYear(
  e: EstablishmentInput,
  y: EstablishmentYearInput,
  isLatest: boolean,
  ctx: ModuleContext,
): Opportunity[] {
  const base = {
    moduleId: M3_ID, moduleVersion: M3_VERSION, name: `Taux accident du travail – établissement ${e.siret}`,
    kind: 'recuperation_passee' as const, year: y.year, periodFrom: yearStart(y.year), periodTo: yearEnd(y.year),
  };
  const common: Partial<Opportunity> = {
    sources: SOURCES, documentsToProvide: DOCUMENTS,
    assiettes: [`cotisations_patronales:atmp:${y.year}:${e.siret}`],
  };

  const missingInformation: string[] = [];
  if (y.appliedRate === null) missingInformation.push(`Taux AT appliqué en paie (${e.siret}, ${y.year})`);
  if (y.payrollMass === null) missingInformation.push(`Masse salariale de l’établissement ${e.siret} (${y.year})`);
  if (missingInformation.length) {
    return [makeOpportunity(base, { ...common, status: 'informations_manquantes', missingInformation,
      explanation: 'Ces informations sont nécessaires pour vérifier le taux accident du travail appliqué.' })];
  }
  const applied = y.appliedRate!;
  const mass = y.payrollMass!;

  // Sans notification officielle validée : jamais de conclusion ferme.
  if (!y.notifiedRateFromValidatedDocument || y.notifiedRate === null) {
    let expected: number | null = null;
    const missingParameters = [];
    if (e.atRiskCode) {
      const r = ctx.params.resolve(expectedRateKey(e.atRiskCode), yearStart(y.year), yearEnd(y.year));
      if (r.ok) expected = r.value;
      else missingParameters.push(r.missing);
    }
    const reference = y.notifiedRate ?? expected;
    const potential = reference !== null && applied - reference > RATE_EPSILON ? roundCents(mass * (applied - reference)) : null;
    return [makeOpportunity(base, {
      ...common, status: 'a_confirmer', confidence: 'faible', missingParameters,
      missingInformation: [`Notification officielle du taux AT/MP ${y.year} (${e.siret})`],
      calculationDetail: { tauxApplique: applied, tauxNotifieDeclare: y.notifiedRate, tauxCollectifAttendu: expected, masseSalariale: mass, ecartPotentielNonConfirme: potential },
      conditionsDetected: potential !== null ? [`Anomalie à vérifier : taux appliqué ${pct(applied)} supérieur au taux de référence ${pct(reference!)}`] : [],
      explanation: potential !== null
        ? `Anomalie à vérifier : le taux appliqué semble supérieur au taux de référence. Sans la notification officielle, aucune conclusion ne peut être tirée.`
        : 'Transmettez la notification officielle de taux AT/MP pour vérifier le taux appliqué.',
    })];
  }

  const notified = y.notifiedRate;
  const diff = applied - notified;
  const detail = { tauxApplique: applied, tauxNotifie: notified, ecartDeTaux: Number(diff.toFixed(6)), masseSalariale: mass };
  if (Math.abs(diff) <= RATE_EPSILON) {
    return [makeOpportunity(base, { ...common, status: 'aucun_ecart', confidence: 'eleve', calculationDetail: detail,
      explanation: `Le taux appliqué en ${y.year} correspond au taux notifié (${pct(notified)}).` })];
  }
  if (diff < 0) {
    return [makeOpportunity(base, { ...common, status: 'a_confirmer', confidence: 'eleve', risk: 'eleve', calculationDetail: detail,
      conditionsDetected: ['Taux appliqué inférieur au taux notifié : risque de régularisation'],
      explanation: `Attention : le taux appliqué (${pct(applied)}) est inférieur au taux notifié (${pct(notified)}). Il ne s’agit pas d’un gain mais d’un risque de redressement à corriger.` })];
  }

  const claim = claimableMonths(ctx.params, y.year, ctx.asOfDate);
  if (!claim.ok) {
    return [makeOpportunity(base, { ...common, status: 'parametre_manquant', missingParameters: [claim.missing], calculationDetail: detail,
      explanation: 'Le délai de réclamation n’est pas encore publié : impossible de dire si cette période est encore réclamable.' })];
  }
  const fraction = claim.claimableMonths.length / 12;
  const annualOverpayment = mass * diff;
  const fullDetail = { ...detail, tropVerseAnnuel: roundCents(annualOverpayment), moisReclamables: claim.claimableMonths, fractionReclamable: fraction,
    hypotheses: ['Masse salariale répartie uniformément sur les 12 mois.'] };
  const confidence = y.appliedRateFromValidatedDocument ? 'eleve' : 'moyen';
  const out: Opportunity[] = [];
  if (fraction === 0) {
    out.push(makeOpportunity(base, { ...common, status: 'non_reclamable', calculationDetail: fullDetail,
      explanation: `Un taux trop élevé a été appliqué en ${y.year}, mais cette période n’est plus réclamable.` }));
  } else {
    const amount = roundCents(annualOverpayment * fraction);
    out.push(makeOpportunity(base, { ...common, status: 'estime', amounts: range(amount), confidence, risk: 'faible', calculationDetail: fullDetail,
      conditionsDetected: [`Taux appliqué ${pct(applied)} au lieu de ${pct(notified)} notifié`],
      explanation: `Le taux accident du travail appliqué en paie (${pct(applied)}) dépasse le taux notifié (${pct(notified)}) : environ ${formatEuro(amount)} de cotisations payées en trop sur les mois encore réclamables.` }));
  }
  if (isLatest) {
    out.push(makeOpportunity({ ...base, kind: 'economie_future', name: `${base.name} (correction du taux)` }, {
      ...common, status: 'estime', amounts: range(roundCents(annualOverpayment)), confidence: 'faible', risk: 'faible', calculationDetail: fullDetail,
      assiettes: [`cotisations_patronales:atmp:futur:${e.siret}`],
      conditionsDetected: ['À confirmer : le taux erroné est-il toujours appliqué ?', 'Le taux notifié change chaque année'],
      explanation: `Si le taux erroné est toujours appliqué, le corriger économiserait environ ${formatEuro(annualOverpayment)} par an (sur la base de la masse salariale ${y.year}).` }));
  }
  return out;
}

export const m3TauxAt: CalculationModule = {
  id: M3_ID,
  name: 'Taux accident du travail par établissement',
  description: 'Compare, par établissement et par année, le taux AT/MP notifié, le taux appliqué en paie et le taux attendu pour le code risque.',
  kind: 'mixte',
  version: M3_VERSION,
  requiredData: ['Taux appliqué en paie', 'Notification officielle du taux', 'Masse salariale de l’établissement', 'Code risque'],
  eligibilityConditions: ['Taux appliqué supérieur au taux notifié', 'Période encore réclamable'],
  parameterKeys: ['delai_reclamation_cotisations_annees', 'taux_at_collectif_<code risque>'],
  applicablePeriod: { from: '2023-01-01', to: null },
  officialSources: SOURCES,
  requiredDocuments: DOCUMENTS,
  compute(input: EngineInput, ctx) {
    const out: Opportunity[] = [];
    const establishments = [...(input.establishments ?? [])].sort((a, b) => (a.siret < b.siret ? -1 : 1));
    for (const e of establishments) {
      const years = (input.establishmentYears ?? []).filter((y) => y.establishmentId === e.id).sort((a, b) => a.year - b.year);
      const latest = years.at(-1)?.year;
      for (const y of years) out.push(...computeEstablishmentYear(e, y, y.year === latest, ctx));
    }
    return out;
  },
};
