/**
 * BOULANGERIE DÉMO — ENTREPRISE FICTIVE, À USAGE DE TEST ET DE DÉMONSTRATION UNIQUEMENT.
 *
 * 12 salariés (dont 2 apprentis), 1 établissement, données 2023-2026.
 * Anomalies volontaires :
 *  1. Réduction générale sous-appliquée :
 *     - E07 (temps partiel) : réduction non appliquée en 2024 et 2025 ;
 *     - E03 : réduction appliquée à 50 % en 2025 ;
 *     - E09 et E10 : RGDU non appliquée en 2026 (la paie a gardé l'ancien seuil de sortie).
 *  2. Taux AT appliqué en paie (2,70 %) différent du taux notifié (2,10 %) en 2024.
 *  3. Aide à l'apprentissage du contrat de E11 perçue seulement en partie (2 000 € sur 5 000 €).
 *  4. Commune de l'établissement classée dans un zonage FICTIF jusqu'à mi-2024.
 *
 * Les montants « appliqués » sont générés avec les paramètres de TEST (valeurs fictives).
 */

import { rgCoefficient, rgduCoefficient } from '../modules/m1-reduction-generale/formulas.js';
import type { AnonymizedEmployee, ApprenticeshipContractInput, EngineInput, EstablishmentInput, EstablishmentYearInput, PayrollLine, QuickYearInput, RemunerationSimulationInput } from '../types.js';

export const DEMO_AS_OF_DATE = '2026-11-02';
export const DEMO_SIREN = '999000001';

export const DEMO_COMPANY = {
  siren: DEMO_SIREN,
  legalName: 'Boulangerie Démo (entreprise fictive)',
  legalForm: 'SARL',
  nafCode: '10.71C',
  sector: 'artisanat_alimentaire',
  isDemo: true,
  establishments: [
    { siret: '99900000100015', address: '1 rue de la Démonstration', postalCode: '26000', city: 'Valence', inseeCode: '26362', atRiskCode: 'DEMO-AT' },
  ],
} as const;

interface DemoEmployee {
  id: string;
  /** Rémunération en multiple du SMIC horaire (identique chaque mois). */
  multiple: number;
  /** Quotité de travail. */
  ratio: number;
  contract: 'CDI' | 'apprentissage';
}

export const DEMO_EMPLOYEES: DemoEmployee[] = [
  { id: 'E01', multiple: 1.05, ratio: 1, contract: 'CDI' },
  { id: 'E02', multiple: 1.05, ratio: 1, contract: 'CDI' },
  { id: 'E03', multiple: 1.2, ratio: 1, contract: 'CDI' },
  { id: 'E04', multiple: 1.2, ratio: 1, contract: 'CDI' },
  { id: 'E05', multiple: 1.25, ratio: 1, contract: 'CDI' },
  { id: 'E06', multiple: 1.4, ratio: 1, contract: 'CDI' },
  { id: 'E07', multiple: 1.15, ratio: 0.6, contract: 'CDI' },
  { id: 'E08', multiple: 1.5, ratio: 1, contract: 'CDI' },
  { id: 'E09', multiple: 1.8, ratio: 1, contract: 'CDI' },
  { id: 'E10', multiple: 2.6, ratio: 1, contract: 'CDI' },
  { id: 'E11', multiple: 0.53, ratio: 1, contract: 'apprentissage' },
  { id: 'E12', multiple: 0.61, ratio: 1, contract: 'apprentissage' },
];

// Paramètres de TEST (fictifs) utilisés pour générer les montants appliqués par la « paie ».
const TEST_SMIC: Record<number, (month: number) => number> = {
  2023: (m) => (m <= 4 ? 12.0 : 12.2),
  2024: () => 12.4,
  2025: () => 12.6,
  2026: () => 12.8,
};
const HOURS_FULL_TIME = 151.67;
const testCoefficient = (year: number, m: number) =>
  year <= 2025
    ? rgCoefficient(m, { tmax: 0.32, exitThreshold: 1.6, decimals: 4 })
    : rgduCoefficient(m, { tmin: 0.02, tdelta: 0.38, power: 1.75, exitThreshold: 3, decimals: 4 });

/** Coefficient d'application de la « paie » de démo : 1 = correct, 0 = oublié, 0,5 = à moitié. */
function payrollApplicationFactor(year: number, id: string): number {
  if (id === 'E07' && (year === 2024 || year === 2025)) return 0;
  if (id === 'E03' && year === 2025) return 0.5;
  // Ancien seuil de sortie conservé à tort en 2026 : rien n'est appliqué au-delà de 1,6 SMIC.
  if (year === 2026 && (id === 'E09' || id === 'E10')) return 0;
  return 1;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function demoPayrollLines(years: number[] = [2024, 2025, 2026], lastMonth2026 = 10): PayrollLine[] {
  const lines: PayrollLine[] = [];
  for (const year of years) {
    const months = year === 2026 ? lastMonth2026 : 12;
    for (const e of DEMO_EMPLOYEES) {
      for (let month = 1; month <= months; month++) {
        const hours = r2(HOURS_FULL_TIME * e.ratio);
        const gross = r2(e.multiple * TEST_SMIC[year]!(month) * hours);
        const applied = r2(testCoefficient(year, e.multiple) * gross * payrollApplicationFactor(year, e.id));
        lines.push({ employeeInternalId: e.id, year, month, gross, hoursPaid: hours, overtimeHours: 0, reductionApplied: applied, validated: true });
      }
    }
  }
  return lines;
}

/** Réduction déclarée annuelle (12 mois) générée par la paie de démo, pour le mode rapide. */
function declaredAnnual(year: number): number {
  let total = 0;
  for (const e of DEMO_EMPLOYEES) {
    for (let month = 1; month <= 12; month++) {
      const gross = r2(e.multiple * TEST_SMIC[year]!(month) * r2(HOURS_FULL_TIME * e.ratio));
      total += r2(testCoefficient(year, e.multiple) * gross * payrollApplicationFactor(year, e.id));
    }
  }
  return r2(total);
}

function quickYear(year: number): QuickYearInput {
  return {
    year,
    averageHeadcount: 12,
    declaredGeneralReduction: declaredAnnual(year),
    overtimeHoursApprox: 0,
    brackets: [
      { bracket: 'lt_1_1', employeeCount: 4, partTimeShare: 0 },
      { bracket: '1_1_1_3', employeeCount: 4, partTimeShare: 0.25, partTimeAverageRatio: 0.6 },
      { bracket: '1_3_1_6', employeeCount: 2, partTimeShare: 0 },
      { bracket: '1_6_2', employeeCount: 1, partTimeShare: 0 },
      { bracket: '2_2_5', employeeCount: 0, partTimeShare: 0 },
      { bracket: '2_5_3', employeeCount: 1, partTimeShare: 0 },
      { bracket: 'gt_3', employeeCount: 0, partTimeShare: 0 },
    ],
  };
}

export const DEMO_ANONYMIZED_EMPLOYEES: AnonymizedEmployee[] = DEMO_EMPLOYEES.map((e) => ({
  internalId: e.id,
  establishmentId: '99900000100015',
  contractType: e.contract,
  entryDate: e.id === 'E11' ? '2024-09-02' : e.id === 'E12' ? '2023-09-04' : '2021-03-01',
}));

export const DEMO_ESTABLISHMENTS: EstablishmentInput[] = [
  { id: 'etab-demo-1', siret: '99900000100015', inseeCode: '26362', atRiskCode: 'DEMO-AT' },
];

/** Masse salariale annuelle (12 mois) générée par la paie de démo. */
export function demoPayrollMass(year: number): number {
  let total = 0;
  for (const e of DEMO_EMPLOYEES) {
    for (let month = 1; month <= 12; month++) total += r2(e.multiple * TEST_SMIC[year]!(month) * r2(HOURS_FULL_TIME * e.ratio));
  }
  return r2(total);
}

export const DEMO_ESTABLISHMENT_YEARS: EstablishmentYearInput[] = [
  { establishmentId: 'etab-demo-1', year: 2024, payrollMass: demoPayrollMass(2024), notifiedRate: 0.021, notifiedRateFromValidatedDocument: true, appliedRate: 0.027 },
  { establishmentId: 'etab-demo-1', year: 2025, payrollMass: demoPayrollMass(2025), notifiedRate: 0.021, notifiedRateFromValidatedDocument: true, appliedRate: 0.021 },
];

export const DEMO_APPRENTICESHIP_CONTRACTS: ApprenticeshipContractInput[] = [
  { id: 'C-E11', employeeInternalId: 'E11', contractType: 'apprentissage', startDate: '2024-09-02', durationMonths: 24, diploma: 'CAP Boulanger', diplomaLevel: 3, aidReceived: 'partiellement', aidAmountReceived: 2000 },
  { id: 'C-E12', employeeInternalId: 'E12', contractType: 'apprentissage', startDate: '2023-09-04', durationMonths: 24, diploma: 'CAP Boulanger', diplomaLevel: 3, aidReceived: 'oui', aidAmountReceived: null },
];

export const DEMO_REMUNERATION_SIMULATION: RemunerationSimulationInput = {
  year: 2026, employeeCount: 12, envelopeEmployerCostPerEmployee: 1000, averageAnnualGrossSalary: 28000, employeeMarginalTaxRate: 0.11, mealDaysPerYear: 200,
};

export function demoQuickInput(): EngineInput {
  return {
    asOfDate: DEMO_AS_OF_DATE,
    mode: 'rapide',
    company: { siren: DEMO_SIREN, nafCode: DEMO_COMPANY.nafCode, headcountByYear: { 2023: 12, 2024: 12, 2025: 12, 2026: 12 } },
    quick: { years: [2023, 2024, 2025, 2026].map(quickYear), payrollProvider: 'Logiciel fictif' },
    establishments: DEMO_ESTABLISHMENTS,
    establishmentYears: DEMO_ESTABLISHMENT_YEARS,
    apprenticeshipContracts: DEMO_APPRENTICESHIP_CONTRACTS,
    remunerationSimulation: DEMO_REMUNERATION_SIMULATION,
  };
}

export function demoAdvancedInput(): EngineInput {
  return {
    ...demoQuickInput(),
    mode: 'avance',
    advanced: { employees: DEMO_ANONYMIZED_EMPLOYEES, payrollLines: demoPayrollLines() },
  };
}
