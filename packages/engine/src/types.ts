/**
 * Types publics du moteur de calcul.
 * Le moteur est indépendant de l'interface et de la base : il reçoit des données
 * figées + une liste de paramètres réglementaires, et produit des opportunités.
 */

// ---------------------------------------------------------------------------
// Paramètres réglementaires
// ---------------------------------------------------------------------------

export type ParameterStatus = 'a_renseigner' | 'brouillon' | 'valide' | 'publie' | 'archive';

/**
 * Jeu de paramètres. Les paramètres de test (Boulangerie Démo, tests unitaires)
 * sont strictement séparés des paramètres officiels : le moteur ne mélange jamais
 * les deux jeux dans un même calcul.
 */
export type ParameterDataset = 'officiel' | 'test';

export interface RegulatoryParameter {
  id: string;
  key: string;
  label: string;
  /** null tant que le paramètre est « à renseigner ». */
  value: number | null;
  unit: string;
  /** Date ISO (AAAA-MM-JJ) incluse. */
  validFrom: string;
  /** Date ISO incluse, null = sans date de fin connue. */
  validTo: string | null;
  territory: string;
  moduleId: string | null;
  sourceUrl: string | null;
  verifiedAt: string | null;
  version: number;
  status: ParameterStatus;
  dataset: ParameterDataset;
  authorId: string | null;
  validatorId: string | null;
  note?: string;
}

export type MissingParameterReason =
  | 'absent' // aucune ligne pour cette clé sur la période
  | 'non_publie' // une ligne existe mais n'est pas au statut « publié »
  | 'sans_valeur' // ligne publiée sans valeur (incohérence de saisie)
  | 'couverture_partielle' // la période n'est pas entièrement couverte
  | 'ambigu' // plusieurs versions publiées se chevauchent
  | 'decoupage_infra_annuel'; // la valeur change en cours de période alors que la formule exige une valeur unique

export interface MissingParameter {
  key: string;
  periodFrom: string;
  periodTo: string;
  reason: MissingParameterReason;
  /** Statuts des lignes trouvées mais inutilisables (aide au back-office). */
  foundStatuses?: ParameterStatus[];
}

// ---------------------------------------------------------------------------
// Opportunités
// ---------------------------------------------------------------------------

export type OpportunityKind = 'recuperation_passee' | 'economie_future';
export type ConfidenceLevel = 'eleve' | 'moyen' | 'faible';
export type RiskLevel = 'faible' | 'standard' | 'eleve';

export type OpportunityStatus =
  | 'estime' // montants calculés
  | 'parametre_manquant' // calcul bloqué : paramètre absent ou non publié
  | 'informations_manquantes' // calcul impossible sans données client supplémentaires
  | 'non_reclamable' // écart détecté mais période prescrite / hors délai
  | 'aucun_ecart' // calcul fait, rien à récupérer (ou non éligible)
  | 'a_confirmer'; // piste détectée sans conclusion ferme : analyse documentaire ou experte requise, sans montant

export interface AmountRange {
  low: number;
  central: number;
  high: number;
}

export interface SourceRef {
  label: string;
  url: string;
}

export interface Opportunity {
  moduleId: string;
  moduleVersion: string;
  name: string;
  kind: OpportunityKind;
  year: number;
  periodFrom: string;
  periodTo: string;
  /** null si le statut n'est pas « estime » : jamais de montant sans calcul complet. */
  amounts: AmountRange | null;
  status: OpportunityStatus;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  conditionsDetected: string[];
  missingInformation: string[];
  missingParameters: MissingParameter[];
  explanation: string;
  sources: SourceRef[];
  documentsToProvide: string[];
  /** Détail du calcul, sérialisable, affiché dans le rapport et le back-office. */
  calculationDetail: Record<string, unknown>;
  /**
   * Assiettes consommées, hiérarchiques (« a:b:c ») : deux assiettes se chevauchent si elles
   * sont égales ou si l'une est un préfixe de l'autre (règles de cumul).
   */
  assiettes: string[];
  /**
   * false pour un résultat de simulation (ex. M5) : affiché, mais jamais additionné aux totaux
   * de récupération ou d'économies.
   */
  countsInTotals: boolean;
}

// ---------------------------------------------------------------------------
// Données d'entrée
// ---------------------------------------------------------------------------

export type AuditMode = 'rapide' | 'avance';

/** Tranches du mode rapide, en multiple du SMIC (rémunération équivalent temps plein). */
export const SALARY_BRACKETS = [
  'lt_1_1',
  '1_1_1_3',
  '1_3_1_6',
  '1_6_2',
  '2_2_5',
  '2_5_3',
  'gt_3',
] as const;
export type SalaryBracketId = (typeof SALARY_BRACKETS)[number];

export interface SalaryBracketInput {
  bracket: SalaryBracketId;
  employeeCount: number;
  /** Part (0..1) des salariés de la tranche à temps partiel. */
  partTimeShare: number;
  /** Quotité moyenne de travail des temps partiels (0..1), si connue. */
  partTimeAverageRatio?: number | null;
}

export interface QuickYearInput {
  year: number;
  averageHeadcount: number | null;
  brackets: SalaryBracketInput[];
  /** Montant annuel de réduction générale déjà appliqué, null = « je ne sais pas ». */
  declaredGeneralReduction: number | null;
  overtimeHoursApprox?: number | null;
}

export interface QuickModeInput {
  years: QuickYearInput[];
  payrollProvider?: string | null;
}

export interface AnonymizedEmployee {
  internalId: string;
  establishmentId: string | null;
  contractType: string;
  entryDate: string | null;
}

export interface PayrollLine {
  employeeInternalId: string;
  year: number;
  month: number; // 1..12
  /** Rémunération brute soumise à cotisations du mois (heures supplémentaires comprises). */
  gross: number;
  /** Heures rémunérées du mois, heures supplémentaires/complémentaires comprises, hors majoration. */
  hoursPaid: number;
  overtimeHours: number;
  /** Réduction générale effectivement appliquée sur le bulletin. */
  reductionApplied: number;
  /** Une ligne issue d'un import n'est utilisée qu'après validation. */
  validated: boolean;
}

export interface AdvancedModeInput {
  employees: AnonymizedEmployee[];
  payrollLines: PayrollLine[];
}

export type ContractType = 'apprentissage' | 'professionnalisation';
export type AidReceived = 'oui' | 'non' | 'partiellement' | 'inconnu';

export interface ApprenticeshipContractInput {
  id: string;
  employeeInternalId?: string | null;
  contractType: ContractType;
  /** Date de début d'exécution du contrat (sert de date de conclusion pour les paramètres). */
  startDate: string;
  startDateApproximate?: boolean;
  durationMonths: number;
  /** Date de fin anticipée (rupture), si connue. */
  endDate?: string | null;
  diploma?: string | null;
  /** Niveau du diplôme préparé (nomenclature des certifications : 3 = CAP … 7 = master). */
  diplomaLevel?: number | null;
  aidReceived: AidReceived;
  aidAmountReceived?: number | null;
}

export interface EstablishmentInput {
  id: string;
  siret: string;
  inseeCode: string | null;
  atRiskCode: string | null;
}

export interface EstablishmentYearInput {
  establishmentId: string;
  year: number;
  /** Masse salariale brute de l'établissement. */
  payrollMass: number | null;
  /** Taux AT/MP notifié par la CARSAT (fraction : 0,021 = 2,10 %). */
  notifiedRate: number | null;
  /** true seulement si le taux notifié provient d'une notification officielle validée. */
  notifiedRateFromValidatedDocument: boolean;
  /** Taux appliqué en paie. */
  appliedRate: number | null;
  appliedRateFromValidatedDocument?: boolean;
}

export interface RemunerationSimulationInput {
  year: number;
  employeeCount: number;
  /** Enveloppe annuelle de coût employeur par salarié, identique pour chaque scénario. */
  envelopeEmployerCostPerEmployee: number;
  averageAnnualGrossSalary: number;
  /** Taux marginal d'imposition supposé du salarié (hypothèse saisie), null = inconnu. */
  employeeMarginalTaxRate: number | null;
  /** Nombre de jours de repas éligibles par an (titres-restaurant), null = inconnu. */
  mealDaysPerYear?: number | null;
  /** Taux effectifs de l'entreprise s'ils sont connus (sinon taux de référence paramétrés). */
  employerRateOverride?: number | null;
  employeeRateOverride?: number | null;
}

export interface EngineInput {
  /** Date de référence du calcul (figée : rend le calcul reproductible). */
  asOfDate: string;
  mode: AuditMode;
  company: {
    siren: string | null;
    nafCode: string | null;
    /** Effectif moyen par année, utilisé pour les seuils (ex. < 50 salariés). */
    headcountByYear: Record<string, number | null>;
  };
  quick?: QuickModeInput;
  advanced?: AdvancedModeInput;
  establishments?: EstablishmentInput[];
  establishmentYears?: EstablishmentYearInput[];
  apprenticeshipContracts?: ApprenticeshipContractInput[];
  remunerationSimulation?: RemunerationSimulationInput | null;
}

// ---------------------------------------------------------------------------
// Contrat d'un module
// ---------------------------------------------------------------------------

export type ModuleKind = 'retroactif' | 'futur' | 'mixte';

export interface ModuleContext {
  params: import('./parameters.js').ParameterResolver;
  reference: import('./reference-data.js').ReferenceResolver;
  asOfDate: string;
}

// ---------------------------------------------------------------------------
// Données de référence versionnées (zonages)
// ---------------------------------------------------------------------------

/** Import d'une table de zonage officielle pour un type de zone et une période. */
export interface ZoningDataset {
  id: string;
  zoneType: string;
  validFrom: string;
  validTo: string | null;
  sourceUrl: string;
  sourceLabel: string;
  version: number;
  status: ParameterStatus;
  dataset: ParameterDataset;
}

/** Une commune classée dans un zonage. Jamais sans jeu de données sourcé. */
export interface ZoningEntry {
  id: string;
  datasetId: string;
  inseeCode: string;
  communeName: string | null;
  validFrom: string;
  validTo: string | null;
}

/** Dispositif rattaché à un type de zone, saisi par l'administrateur avec sa source. */
export interface ZoneScheme {
  id: string;
  zoneType: string;
  code: string;
  name: string;
  description: string;
  conditions: string[];
  documentsToProvide: string[];
  sourceUrl: string;
  validFrom: string;
  validTo: string | null;
  version: number;
  status: ParameterStatus;
  dataset: ParameterDataset;
}

export interface ReferenceData {
  zoningDatasets: ZoningDataset[];
  zoningEntries: ZoningEntry[];
  zoneSchemes: ZoneScheme[];
}

export interface CalculationModule {
  id: string;
  name: string;
  description: string;
  kind: ModuleKind;
  version: string;
  requiredData: string[];
  eligibilityConditions: string[];
  parameterKeys: string[];
  applicablePeriod: { from: string; to: string | null };
  officialSources: SourceRef[];
  requiredDocuments: string[];
  /** Fonction de calcul déterministe : aucun aléa, aucune horloge, aucune IA. */
  compute(input: EngineInput, ctx: ModuleContext): Opportunity[];
}
