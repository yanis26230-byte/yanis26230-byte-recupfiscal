import { addMonths, cmp, completedMonthsBetween, yearOf } from '../../dates.js';
import { formatEuro, roundCents } from '../../money.js';
import { resolveAll } from '../../parameters.js';
import type { ApprenticeshipContractInput, CalculationModule, ContractType, EngineInput, ModuleContext, Opportunity, SourceRef } from '../../types.js';
import { makeOpportunity, range } from '../common.js';

export const M2_ID = 'M2_AIDES_EMBAUCHE';
export const M2_VERSION = '1.0.0';

/** Clés paramétrées par type de contrat, résolues à la date de début du contrat. */
export const m2Keys = (t: ContractType) => ({
  montantAnnuel: `aide_${t}_montant_annuel`,
  dureeMaxMois: `aide_${t}_duree_max_mois`,
  niveauMax: `aide_${t}_niveau_diplome_max`,
  effectifMax: `aide_${t}_effectif_strictement_inferieur_a`,
  delaiDemandeMois: `aide_${t}_delai_demande_mois`,
});

const SOURCES: SourceRef[] = [
  { label: 'Ministère du Travail – aides à l’embauche en alternance', url: 'https://travail-emploi.gouv.fr' },
  { label: 'Service-public entreprendre – aides à l’apprentissage', url: 'https://entreprendre.service-public.fr' },
];
const DOCUMENTS = [
  'Contrat d’apprentissage ou de professionnalisation (CERFA) et accusé de dépôt',
  'Relevé des aides versées (ASP / « Sylae ») ou notification d’attribution',
  'Bulletins de paie de l’alternant',
];

const LABEL: Record<ContractType, string> = { apprentissage: 'Aide à l’apprentissage', professionnalisation: 'Aide au contrat de professionnalisation' };

function computeContract(input: EngineInput, c: ApprenticeshipContractInput, ctx: ModuleContext): Opportunity[] {
  const startYear = yearOf(c.startDate);
  const plannedEnd = addMonths(c.startDate, c.durationMonths);
  const actualEnd = c.endDate && cmp(c.endDate, plannedEnd) < 0 ? c.endDate : plannedEnd;
  const base = {
    moduleId: M2_ID, moduleVersion: M2_VERSION, name: `${LABEL[c.contractType]} – contrat ${c.id}`,
    kind: 'recuperation_passee' as const, year: startYear, periodFrom: c.startDate, periodTo: actualEnd,
  };
  const common: Partial<Opportunity> = {
    sources: SOURCES, documentsToProvide: DOCUMENTS, assiettes: [`aides:embauche:${c.id}`],
    conditionsDetected: ['Conditions d’âge du bénéficiaire et d’éligibilité du contrat à vérifier sur pièces'],
  };

  const keys = m2Keys(c.contractType);
  const r = resolveAll(ctx.params, Object.values(keys), c.startDate, c.startDate);
  if (!r.ok) {
    return [makeOpportunity(base, { ...common, status: 'parametre_manquant', missingParameters: r.missing,
      explanation: `Les montants et conditions de l’aide pour un contrat débuté le ${c.startDate} ne sont pas encore publiés dans la plateforme : calcul suspendu.` })];
  }
  const v = r.values as Record<string, number>;
  const P = {
    montantAnnuel: v[keys.montantAnnuel]!, dureeMaxMois: v[keys.dureeMaxMois]!, niveauMax: v[keys.niveauMax]!,
    effectifMax: v[keys.effectifMax]!, delaiDemandeMois: v[keys.delaiDemandeMois]!,
  };
  const headcount = input.company.headcountByYear[String(startYear)] ?? null;
  const missingInformation: string[] = [];
  if (headcount === null) missingInformation.push(`Effectif moyen ${startYear}`);
  if (c.diplomaLevel == null) missingInformation.push(`Niveau du diplôme préparé (contrat ${c.id})`);
  if (missingInformation.length) {
    return [makeOpportunity(base, { ...common, status: 'informations_manquantes', missingInformation,
      explanation: 'Ces informations sont nécessaires pour vérifier l’éligibilité du contrat à l’aide.' })];
  }
  if (c.diplomaLevel! > P.niveauMax || headcount! >= P.effectifMax) {
    return [makeOpportunity(base, { ...common, status: 'aucun_ecart',
      calculationDetail: { niveauDiplome: c.diplomaLevel, niveauMax: P.niveauMax, effectif: headcount, effectifStrictementInferieurA: P.effectifMax },
      explanation: 'D’après les informations communiquées, ce contrat ne remplit pas les conditions de l’aide (niveau de diplôme ou effectif).' })];
  }

  const executedMonths = completedMonthsBetween(c.startDate, actualEnd);
  const eligibleMonths = Math.min(c.durationMonths, P.dureeMaxMois, executedMonths);
  const elapsedMonths = Math.min(eligibleMonths, completedMonthsBetween(c.startDate, ctx.asOfDate));
  const monthly = P.montantAnnuel / 12;
  const theoretical = roundCents(monthly * eligibleMonths);
  const theoreticalPast = roundCents(monthly * elapsedMonths);
  const theoreticalFuture = roundCents(theoretical - theoreticalPast);
  const requestDeadline = addMonths(c.startDate, P.delaiDemandeMois);
  const detail = {
    montantAnnuelReglementaire: P.montantAnnuel, dureeMaxMois: P.dureeMaxMois, moisExecutes: executedMonths,
    moisEligibles: eligibleMonths, moisEcoules: elapsedMonths, aideTheorique: theoretical, aideTheoriquePassee: theoreticalPast,
    aideTheoriqueRestante: theoreticalFuture, dateLimiteDemande: requestDeadline, aidePercue: c.aidReceived, montantPercu: c.aidAmountReceived ?? null,
    hypotheses: ['Aide calculée au prorata des mois entiers d’exécution du contrat.', ...(c.startDateApproximate ? ['Date de début approximative.'] : [])],
  };
  const confidence = c.startDateApproximate ? 'faible' : 'moyen';

  if (c.aidReceived === 'inconnu' || (c.aidReceived === 'partiellement' && c.aidAmountReceived == null)) {
    return [makeOpportunity(base, { ...common, status: 'informations_manquantes', calculationDetail: detail,
      missingInformation: [`Montant de l’aide déjà perçue pour le contrat ${c.id}`],
      explanation: `L’aide théorique pour ce contrat est estimée à ${formatEuro(theoretical)}. Indiquez ou justifiez les montants déjà perçus pour chiffrer un éventuel manque.` })];
  }
  if (c.aidReceived === 'oui' && c.aidAmountReceived == null) {
    return [makeOpportunity(base, { ...common, status: 'aucun_ecart', calculationDetail: detail,
      explanation: 'Aide déclarée comme perçue : supposée intégralement versée. Transmettez le relevé de versements pour le vérifier.' })];
  }

  const received = c.aidReceived === 'non' ? 0 : c.aidAmountReceived!;
  const missingPast = Math.max(0, theoreticalPast - received);
  const missingFuture = Math.max(0, theoreticalFuture - Math.max(0, received - theoreticalPast));
  if (missingPast + missingFuture < 0.01) {
    return [makeOpportunity(base, { ...common, status: 'aucun_ecart', calculationDetail: detail, explanation: 'Les aides perçues correspondent à l’aide théorique.' })];
  }

  // Aucune demande faite : vérifier le délai de demande. Une aide déjà en partie versée relève
  // d'un contrôle des versements, pas du délai de demande.
  if (c.aidReceived === 'non' && cmp(ctx.asOfDate, requestDeadline) > 0) {
    return [makeOpportunity(base, { ...common, status: 'non_reclamable', calculationDetail: detail,
      explanation: `Non récupérable : le délai de demande a expiré le ${requestDeadline}. À anticiper pour les prochains contrats (aide théorique de ${formatEuro(theoretical)} pour un contrat comparable).` })];
  }

  const out: Opportunity[] = [];
  const conditions = [...common.conditionsDetected!, c.aidReceived === 'non' ? `Demande encore possible jusqu’au ${requestDeadline}` : 'Aide versée partiellement : contrôler les versements'];
  if (missingPast > 0) {
    out.push(makeOpportunity(base, { ...common, status: 'estime', amounts: range(roundCents(missingPast)), confidence, risk: 'faible',
      conditionsDetected: conditions, calculationDetail: detail, periodTo: cmp(ctx.asOfDate, actualEnd) < 0 ? ctx.asOfDate : actualEnd,
      explanation: `L’aide pour ce contrat n’a pas été perçue en totalité : ${formatEuro(missingPast)} pour les mois déjà écoulés.` }));
  }
  if (missingFuture > 0) {
    out.push(makeOpportunity({ ...base, kind: 'economie_future', name: `${base.name} (mois restants)`, periodFrom: ctx.asOfDate }, {
      ...common, status: 'estime', amounts: range(roundCents(missingFuture)), confidence, risk: 'faible', conditionsDetected: conditions,
      calculationDetail: detail, assiettes: [`aides:embauche:${c.id}:a_venir`],
      explanation: `Pour les mois restants du contrat, ${formatEuro(missingFuture)} d’aide restent à percevoir si la demande est faite à temps.` }));
  }
  return out;
}

export const m2AidesEmbauche: CalculationModule = {
  id: M2_ID,
  name: 'Aides à l’apprentissage et à l’embauche en alternance',
  description: 'Compare l’aide réglementaire applicable à la date de conclusion de chaque contrat aux aides perçues, en tenant compte du délai de demande.',
  kind: 'mixte',
  version: M2_VERSION,
  requiredData: ['Date de début, durée et type de chaque contrat', 'Niveau du diplôme préparé', 'Effectif', 'Aides déjà perçues'],
  eligibilityConditions: ['Contrat éligible conclu pendant la période d’application de l’aide', 'Niveau de diplôme et effectif dans les limites paramétrées', 'Demande effectuée dans le délai paramétré'],
  parameterKeys: [...Object.values(m2Keys('apprentissage')), ...Object.values(m2Keys('professionnalisation'))],
  applicablePeriod: { from: '2023-01-01', to: null },
  officialSources: SOURCES,
  requiredDocuments: DOCUMENTS,
  compute(input, ctx) {
    const contracts = [...(input.apprenticeshipContracts ?? [])].sort((a, b) => cmp(a.startDate, b.startDate) || cmp(a.id, b.id));
    return contracts.flatMap((c) => computeContract(input, c, ctx));
  },
};
