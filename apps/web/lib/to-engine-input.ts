import type { EngineInput, SalaryBracketId } from '@recupfiscal/engine';
import { BRACKETS, type AuditMeta, type StepAnswers } from './questionnaire';

/**
 * Convertit les réponses du mode rapide en entrées du moteur. Aucune valeur n'est inventée :
 * une information inconnue reste null et le moteur la signale comme manquante.
 */
export function toEngineInput(answers: StepAnswers, meta: AuditMeta, asOfDate: string): EngineInput {
  const { entreprise, salaires, reduction, taux_at, alternance, dispositifs } = answers;
  const concerned = entreprise.establishments.filter((e) => e.concerned);
  const pct = (x: number | null) => (x === null ? null : x / 100);
  const currentYear = Number(asOfDate.slice(0, 4));
  const sim = dispositifs.simulation;

  return {
    asOfDate,
    mode: 'rapide',
    company: {
      siren: entreprise.company.siren,
      nafCode: entreprise.company.nafCode,
      headcountByYear: Object.fromEntries(meta.years.map((y) => [String(y), entreprise.headcountByYear[String(y)] ?? null])),
    },
    quick: {
      payrollProvider: reduction.payrollProvider,
      years: meta.years.map((year) => {
        const s = salaires.years[String(year)];
        const r = reduction.years[String(year)];
        return {
          year,
          averageHeadcount: entreprise.headcountByYear[String(year)] ?? null,
          declaredGeneralReduction: r?.known ? (r.amount ?? null) : null,
          overtimeHoursApprox: s?.overtimeHours ?? null,
          brackets: BRACKETS.map((b) => {
            const v = s?.brackets[b.id];
            return {
              bracket: b.id as SalaryBracketId,
              employeeCount: v?.count ?? 0,
              partTimeShare: (v?.partTimeSharePct ?? 0) / 100,
              partTimeAverageRatio: pct(v?.partTimeRatioPct ?? null),
            };
          }),
        };
      }),
    },
    establishments: concerned.map((e) => ({ id: e.key, siret: e.siret ?? e.key, inseeCode: e.inseeCode, atRiskCode: null })),
    // Mode rapide : taux déclarés, jamais issus d'une notification validée.
    establishmentYears: taux_at.rates
      .filter((r) => concerned.some((e) => e.key === r.establishmentKey) && meta.years.includes(r.year))
      .map((r) => {
        const single = concerned.length === 1 ? (salaires.years[String(r.year)]?.payrollMass ?? null) : null;
        return {
          establishmentId: r.establishmentKey,
          year: r.year,
          payrollMass: r.payrollMass ?? single,
          notifiedRate: pct(r.notifiedRatePct),
          notifiedRateFromValidatedDocument: false,
          appliedRate: pct(r.appliedRatePct),
        };
      }),
    apprenticeshipContracts: alternance.contracts.map((c) => ({
      id: c.id,
      contractType: c.contractType,
      startDate: `${c.startMonth}-01`,
      startDateApproximate: true,
      durationMonths: c.durationMonths,
      diplomaLevel: c.diplomaLevel,
      aidReceived: c.aidReceived,
      aidAmountReceived: c.aidAmountReceived,
    })),
    remunerationSimulation: sim.enabled && sim.envelopePerEmployee != null && sim.employeeCount != null && sim.averageGross != null
      ? {
          year: currentYear,
          employeeCount: sim.employeeCount,
          envelopeEmployerCostPerEmployee: sim.envelopePerEmployee,
          averageAnnualGrossSalary: sim.averageGross,
          employeeMarginalTaxRate: pct(sim.tmiPct),
          mealDaysPerYear: sim.mealDays,
        }
      : null,
  };
}
