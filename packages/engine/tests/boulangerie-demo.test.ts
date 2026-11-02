import { describe, expect, it } from 'vitest';
import { m1ReductionGenerale, DEMO_COMPANY, DEMO_EMPLOYEES, demoAdvancedInput, demoQuickInput, indicativeCommission, MODULE_REGISTRY, runCalculation, TEST_PARAMETERS } from '../src/index.js';

describe('Boulangerie Démo – bout en bout moteur', () => {
  it('est clairement identifiée comme fictive', () => {
    expect(DEMO_COMPANY.isDemo).toBe(true);
    expect(DEMO_COMPANY.legalName).toMatch(/fictive/);
    expect(DEMO_EMPLOYEES).toHaveLength(12);
    expect(DEMO_EMPLOYEES.filter((e) => e.contract === 'apprentissage')).toHaveLength(2);
  });

  it('ses paramètres de test sont distincts du jeu officiel', () => {
    expect(TEST_PARAMETERS.every((p) => p.dataset === 'test' && p.label.startsWith('TEST'))).toBe(true);
  });

  for (const [label, factory] of [['rapide', demoQuickInput], ['avancé', demoAdvancedInput]] as const) {
    it(`mode ${label} : détecte la sous-application de la réduction générale sur 2023-2026`, () => {
      const r = runCalculation(factory(), { modules: [m1ReductionGenerale], parameters: TEST_PARAMETERS, dataset: 'test' });
      expect(r.opportunities.map((o) => o.year)).toEqual([2023, 2024, 2025, 2026]);
      expect(r.opportunities.every((o) => o.status === 'estime')).toBe(true);
      expect(r.totals.pastRecovery.central).toBeGreaterThan(0);
      expect(r.totals.pastRecovery.low).toBeLessThanOrEqual(r.totals.pastRecovery.central);
      expect(r.totals.pastRecovery.central).toBeLessThanOrEqual(r.totals.pastRecovery.high);
      expect(r.totals.futureAnnualSavings).toEqual({ low: 0, central: 0, high: 0 });
      const c = indicativeCommission(r.totals.pastRecovery, 0.25);
      expect(c.netGain.central).toBeCloseTo(r.totals.pastRecovery.central * 0.75, 1);
    });
  }

  it('mode avancé : montant de référence figé (test de non-régression)', () => {
    const r = runCalculation(demoAdvancedInput(), { modules: MODULE_REGISTRY, parameters: TEST_PARAMETERS, dataset: 'test' });
    const adv = r.opportunities.filter((o) => o.calculationDetail.mode === 'avance');
    expect(adv.map((o) => [o.year, o.amounts!.central])).toMatchInlineSnapshot(`
      [
        [
          2024,
          3249.86,
        ],
        [
          2025,
          5748.72,
        ],
        [
          2026,
          3868.39,
        ],
      ]
    `);
  });
});
