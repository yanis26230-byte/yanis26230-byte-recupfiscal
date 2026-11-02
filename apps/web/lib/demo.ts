import { DEMO_APPRENTICESHIP_CONTRACTS, DEMO_AS_OF_DATE, DEMO_COMPANY, DEMO_ESTABLISHMENT_YEARS, DEMO_REMUNERATION_SIMULATION, demoQuickInput } from '@recupfiscal/engine';
import { BRACKETS, CONSENT_TEXT_VERSION, SCHEMES, type AuditMeta, type StepAnswers } from './questionnaire';

/** Réponses complètes de la Boulangerie Démo (fictive), dérivées des données de test du moteur. */
export function demoAnswers(): { answers: StepAnswers; meta: AuditMeta } {
  const input = demoQuickInput();
  const years = input.quick!.years.map((y) => y.year);
  const est = DEMO_COMPANY.establishments[0];
  const key = 'etab-demo-1';
  const answers: StepAnswers = {
    entreprise: {
      company: { siren: DEMO_COMPANY.siren, legalName: DEMO_COMPANY.legalName, legalForm: DEMO_COMPANY.legalForm, nafCode: DEMO_COMPANY.nafCode,
        sector: 'artisanat_alimentaire', createdOn: null, headcountRange: '10 à 19 salariés', source: 'manuel' },
      establishments: [{ key, siret: est.siret, address: est.address, postalCode: est.postalCode, city: est.city, inseeCode: est.inseeCode, concerned: true }],
      headcountByYear: Object.fromEntries(years.map((y) => [String(y), 12])),
    },
    salaires: {
      years: Object.fromEntries(input.quick!.years.map((y) => [String(y.year), {
        brackets: Object.fromEntries(BRACKETS.map((b) => {
          const v = y.brackets.find((x) => x.bracket === b.id);
          return [b.id, { count: v?.employeeCount ?? 0, partTimeSharePct: (v?.partTimeShare ?? 0) * 100, partTimeRatioPct: v?.partTimeAverageRatio != null ? v.partTimeAverageRatio * 100 : null }];
        })),
        overtimeHours: 0,
        payrollMass: DEMO_ESTABLISHMENT_YEARS.find((e) => e.year === y.year)?.payrollMass ?? null,
      }])) as StepAnswers['salaires']['years'],
    },
    reduction: {
      years: Object.fromEntries(input.quick!.years.map((y) => [String(y.year), { known: true, amount: y.declaredGeneralReduction }])),
      payrollProvider: 'Logiciel fictif',
    },
    taux_at: {
      rates: DEMO_ESTABLISHMENT_YEARS.map((r) => ({ establishmentKey: key, year: r.year, appliedRatePct: r.appliedRate! * 100, notifiedRatePct: r.notifiedRate! * 100, payrollMass: r.payrollMass })),
    },
    alternance: {
      contracts: DEMO_APPRENTICESHIP_CONTRACTS.map((c) => ({ id: c.id, contractType: c.contractType, startMonth: c.startDate.slice(0, 7), durationMonths: c.durationMonths,
        diplomaLevel: c.diplomaLevel ?? null, aidReceived: c.aidReceived, aidAmountReceived: c.aidAmountReceived ?? null })),
    },
    dispositifs: {
      schemes: Object.fromEntries(SCHEMES.map((s) => [s.id, { active: false, annualAmount: null }])) as StepAnswers['dispositifs']['schemes'],
      simulation: { enabled: true, envelopePerEmployee: DEMO_REMUNERATION_SIMULATION.envelopeEmployerCostPerEmployee, employeeCount: DEMO_REMUNERATION_SIMULATION.employeeCount,
        averageGross: DEMO_REMUNERATION_SIMULATION.averageAnnualGrossSalary, tmiPct: DEMO_REMUNERATION_SIMULATION.employeeMarginalTaxRate! * 100, mealDays: DEMO_REMUNERATION_SIMULATION.mealDaysPerYear ?? null },
    },
    recapitulatif: { consent: true, consentTextVersion: CONSENT_TEXT_VERSION },
  };
  return { answers, meta: { years, fixedAsOfDate: DEMO_AS_OF_DATE, isDemo: true } };
}
