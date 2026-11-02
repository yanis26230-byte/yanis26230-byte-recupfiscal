/**
 * Cas de référence par module. Les valeurs attendues ont été calculées à la main, en dehors du
 * code du moteur, avec les paramètres de TEST (fictifs). Le back-office les relancera à chaque
 * publication de paramètre (phase 7) ; ils sont exportés vers la table reference_test_cases.
 */
import { runCalculation } from '../engine.js';
import { DEMO_AS_OF_DATE, demoAdvancedInput, demoQuickInput } from '../fixtures/boulangerie-demo.js';
import { TEST_PARAMETERS } from '../fixtures/test-parameters.js';
import { TEST_REFERENCE_DATA } from '../fixtures/test-reference-data.js';
import { MODULE_REGISTRY } from '../modules/registry.js';
import type { AmountRange, EngineInput, OpportunityKind, OpportunityStatus, ReferenceData, RegulatoryParameter } from '../types.js';

export interface ExpectedOpportunity {
  year?: number;
  kind?: OpportunityKind;
  nameIncludes?: string;
  status: OpportunityStatus;
  /** null = aucun montant attendu. Comparaison au centime. */
  amounts: AmountRange | null;
}

export interface ReferenceCase {
  id: string;
  moduleId: string;
  name: string;
  calculation: string;
  input: EngineInput;
  expected: ExpectedOpportunity[];
}

const emptyCompany = (headcount: Record<string, number>) => ({ siren: null, nafCode: null, headcountByYear: headcount });
const exact = (x: number): AmountRange => ({ low: x, central: x, high: x });

export const REFERENCE_CASES: ReferenceCase[] = [
  {
    id: 'RC-M1-01', moduleId: 'M1_REDUCTION_GENERALE', name: 'Mode rapide : 1 salarié entre 1,3 et 1,6 SMIC en 2024, aucune réduction déclarée',
    calculation: 'SMIC annuel = 12,40 × 151,67 × 12 = 22 568,50. Haut : C(1,3) = 0,32/0,6 × (1,6/1,3 − 1) = 0,1231 → 0,1231 × 1,3 × 22 568,50 = 3 611,64. Central : C(1,45) = 0,0552 → 1 806,38. Bas : C(1,6⁻) ≈ 0.',
    input: { asOfDate: '2027-01-15', mode: 'rapide', company: emptyCompany({ 2024: 10 }),
      quick: { years: [{ year: 2024, averageHeadcount: 10, declaredGeneralReduction: 0, brackets: [{ bracket: '1_3_1_6', employeeCount: 1, partTimeShare: 0 }] }] } },
    expected: [{ year: 2024, status: 'estime', amounts: { low: 0, central: 1806.38, high: 3611.64 } }],
  },
  {
    id: 'RC-M1-02', moduleId: 'M1_REDUCTION_GENERALE', name: 'Mode avancé, Boulangerie Démo : réductions oubliées 2024-2026',
    calculation: '2024 : E07, C(1,15) = 0,2087 × 12 × 1 297,66 = 3 249,86. 2025 : E07 0,2087 × 12 × 1 318,59 = 3 302,28 + E03 (0,1778 × 27 519,00 = 4 892,88) − 12 × 203,87 = 2 446,44 → 5 748,72. 2026 (RGDU) : E09 0,0756 × 34 944,80 = 2 641,83 + E10 0,0243 × 50 475,80 = 1 226,56 → 3 868,39.',
    input: demoAdvancedInput(),
    expected: [
      { year: 2024, status: 'estime', amounts: exact(3249.86) },
      { year: 2025, status: 'estime', amounts: exact(5748.72) },
      { year: 2026, status: 'estime', amounts: exact(3868.39) },
    ],
  },
  {
    id: 'RC-M2-01', moduleId: 'M2_AIDES_EMBAUCHE', name: 'Contrat d’apprentissage partiellement aidé (Boulangerie Démo, E11)',
    calculation: 'Début 02/09/2024, 24 mois, aide 5 000 €/an limitée à 12 mois → 5 000 €, entièrement échue au 02/11/2026. Perçu 2 000 € → 3 000 € manquants. Contrat E12 : aide déclarée perçue → aucun écart.',
    input: demoQuickInput(),
    expected: [
      { nameIncludes: 'C-E12', status: 'aucun_ecart', amounts: null },
      { nameIncludes: 'C-E11', kind: 'recuperation_passee', status: 'estime', amounts: exact(3000) },
    ],
  },
  {
    id: 'RC-M2-02', moduleId: 'M2_AIDES_EMBAUCHE', name: 'Aide jamais demandée, délai de demande expiré',
    calculation: 'Début 15/01/2024 + délai de 6 mois = 15/07/2024 < 02/11/2026 → non récupérable, à anticiper.',
    input: { asOfDate: DEMO_AS_OF_DATE, mode: 'rapide', company: emptyCompany({ 2024: 12 }),
      apprenticeshipContracts: [{ id: 'C1', contractType: 'apprentissage', startDate: '2024-01-15', durationMonths: 24, diplomaLevel: 4, aidReceived: 'non' }] },
    expected: [{ status: 'non_reclamable', amounts: null }],
  },
  {
    id: 'RC-M2-03', moduleId: 'M2_AIDES_EMBAUCHE', name: 'Contrat récent sans aide, demande encore possible',
    calculation: 'Début 01/08/2026, aide 2025+ 4 000 €/an sur 12 mois. Au 02/11/2026 : 3 mois écoulés → 1 000 € passés ; 9 mois restants → 3 000 € à percevoir.',
    input: { asOfDate: DEMO_AS_OF_DATE, mode: 'rapide', company: emptyCompany({ 2026: 12 }),
      apprenticeshipContracts: [{ id: 'C2', contractType: 'apprentissage', startDate: '2026-08-01', durationMonths: 12, diplomaLevel: 3, aidReceived: 'non' }] },
    expected: [
      { kind: 'recuperation_passee', status: 'estime', amounts: exact(1000) },
      { kind: 'economie_future', status: 'estime', amounts: exact(3000) },
    ],
  },
  {
    id: 'RC-M3-01', moduleId: 'M3_TAUX_AT', name: 'Taux AT appliqué supérieur au taux notifié (Boulangerie Démo 2024)',
    calculation: 'Masse 2024 = 335 818,68 € ; écart 2,70 % − 2,10 % = 0,60 % → 2 014,91 €, 12 mois réclamables au 02/11/2026. 2025 : taux identiques → aucun écart.',
    input: demoQuickInput(),
    expected: [
      { year: 2024, kind: 'recuperation_passee', status: 'estime', amounts: exact(2014.91) },
      { year: 2025, kind: 'recuperation_passee', status: 'aucun_ecart', amounts: null },
    ],
  },
  {
    id: 'RC-M3-02', moduleId: 'M3_TAUX_AT', name: 'Sans notification officielle : anomalie à vérifier, aucun montant',
    calculation: 'Taux appliqué 3 % > taux collectif de test 2,10 %, mais aucune notification validée → à confirmer, sans montant.',
    input: { asOfDate: DEMO_AS_OF_DATE, mode: 'rapide', company: emptyCompany({ 2025: 12 }),
      establishments: [{ id: 'e1', siret: '99900000100015', inseeCode: null, atRiskCode: 'DEMO-AT' }],
      establishmentYears: [{ establishmentId: 'e1', year: 2025, payrollMass: 100000, notifiedRate: null, notifiedRateFromValidatedDocument: false, appliedRate: 0.03 }] },
    expected: [{ year: 2025, status: 'a_confirmer', amounts: null }],
  },
  {
    id: 'RC-M4-01', moduleId: 'M4_ZONAGES', name: 'Commune déclassée mi-2024 (Boulangerie Démo, zonage fictif)',
    calculation: 'Commune 26362 classée du 01/01/2023 au 30/06/2024 → piste à confirmer sur 2023-2024 ; plus classée au 02/11/2026 → pas de volet futur.',
    input: demoQuickInput(),
    expected: [{ year: 2023, kind: 'recuperation_passee', status: 'a_confirmer', amounts: null }],
  },
  {
    id: 'RC-M4-02', moduleId: 'M4_ZONAGES', name: 'Commune toujours classée : volets passé et futur',
    calculation: 'Commune 00001 classée sans date de fin → piste passée (2023-2026) et piste pour les prochaines embauches.',
    input: { asOfDate: DEMO_AS_OF_DATE, mode: 'rapide', company: emptyCompany({ 2023: 5, 2024: 5, 2025: 5, 2026: 5 }),
      establishments: [{ id: 'e1', siret: '99900000200014', inseeCode: '00001', atRiskCode: null }] },
    expected: [
      { year: 2023, kind: 'recuperation_passee', status: 'a_confirmer', amounts: null },
      { year: 2026, kind: 'economie_future', status: 'a_confirmer', amounts: null },
    ],
  },
  {
    id: 'RC-M5-01', moduleId: 'M5_EPARGNE_SALARIALE', name: 'Simulateur, enveloppe de 1 000 € par salarié (Boulangerie Démo 2026)',
    calculation: 'Prime : brut 1 000/1,42 = 704,23 ; net 549,30 ; IR 11 % → 488,87. Titres-restaurant : 142 titres × 7 € = 994 € exonérés → +505,13 €/salarié, × 12 = 6 061,52 € (simulation, hors totaux).',
    input: demoQuickInput(),
    expected: [{ year: 2026, kind: 'economie_future', status: 'estime', amounts: exact(6061.52) }],
  },
];

export interface ReferenceCaseResult {
  id: string;
  passed: boolean;
  failures: string[];
}

export function runReferenceCase(
  rc: ReferenceCase,
  parameters: readonly RegulatoryParameter[] = TEST_PARAMETERS,
  referenceData: ReferenceData = TEST_REFERENCE_DATA,
): ReferenceCaseResult {
  const module = MODULE_REGISTRY.find((m) => m.id === rc.moduleId);
  if (!module) return { id: rc.id, passed: false, failures: [`Module ${rc.moduleId} introuvable`] };
  const run = runCalculation(rc.input, { modules: [module], parameters, dataset: 'test', referenceData });
  const failures: string[] = [];
  for (const e of rc.expected) {
    const found = run.opportunities.find((o) =>
      (e.year === undefined || o.year === e.year) && (e.kind === undefined || o.kind === e.kind) && (e.nameIncludes === undefined || o.name.includes(e.nameIncludes)));
    const label = JSON.stringify({ year: e.year, kind: e.kind, nameIncludes: e.nameIncludes });
    if (!found) { failures.push(`${label} : opportunité absente`); continue; }
    if (found.status !== e.status) failures.push(`${label} : statut ${found.status} au lieu de ${e.status}`);
    if (JSON.stringify(found.amounts) !== JSON.stringify(e.amounts)) failures.push(`${label} : montants ${JSON.stringify(found.amounts)} au lieu de ${JSON.stringify(e.amounts)}`);
  }
  return { id: rc.id, passed: failures.length === 0, failures };
}
