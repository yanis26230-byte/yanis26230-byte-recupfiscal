import { describe, expect, it } from 'vitest';
import {
  canonicalJson, demoAdvancedInput, demoQuickInput, indicativeCommission, MODULE_REGISTRY, realCommission,
  replayCalculation, runCalculation, TEST_PARAMETERS, type CalculationModule, type Opportunity,
} from '../src/index.js';

const opts = { modules: MODULE_REGISTRY, parameters: TEST_PARAMETERS, dataset: 'test' as const };

function fakeModule(id: string, kind: Opportunity['kind'], assiette: string, amount: number, extra: Partial<Opportunity> = {}): CalculationModule {
  return {
    id, name: id, description: '', kind: kind === 'recuperation_passee' ? 'retroactif' : 'futur', version: '0.0.1',
    requiredData: [], eligibilityConditions: [], parameterKeys: [], applicablePeriod: { from: '2023-01-01', to: null },
    officialSources: [], requiredDocuments: [],
    compute: () => [{
      moduleId: id, moduleVersion: '0.0.1', name: id, kind, year: 2024, periodFrom: '2024-01-01', periodTo: '2024-12-31',
      amounts: { low: amount, central: amount, high: amount }, status: 'estime', confidence: 'moyen', risk: 'standard',
      conditionsDetected: [], missingInformation: [], missingParameters: [], explanation: '', sources: [], documentsToProvide: [],
      calculationDetail: {}, assiettes: [assiette], countsInTotals: true, ...extra,
    }],
  };
}

describe('calculation_runs – traçabilité et reproductibilité', () => {
  it('enregistre version du moteur, versions des modules, paramètres et entrées figées', () => {
    const r = runCalculation(demoQuickInput(), opts);
    expect(r.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(r.moduleVersions).toEqual({
      M1_REDUCTION_GENERALE: '1.1.0', M2_AIDES_EMBAUCHE: '1.0.0', M3_TAUX_AT: '1.0.0', M4_ZONAGES: '1.0.0', M5_EPARGNE_SALARIALE: '1.0.0',
    });
    expect(r.parameterIds.length).toBeGreaterThan(5);
    expect(r.parameterIds).toEqual([...r.parameterIds].sort());
    expect(r.parameterSnapshot.map((p) => p.id)).toEqual(r.parameterIds);
    expect(r.frozenInput).toEqual(demoQuickInput());
    expect(r.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('les entrées sont figées : modifier l’objet source après coup ne change rien', () => {
    const input = demoQuickInput();
    const r = runCalculation(input, opts);
    input.quick!.years[0]!.declaredGeneralReduction = 0;
    expect(r.frozenInput.quick!.years[0]!.declaredGeneralReduction).not.toBe(0);
  });

  it('deux exécutions identiques produisent exactement le même résultat', () => {
    const a = runCalculation(demoAdvancedInput(), opts);
    const b = runCalculation(demoAdvancedInput(), opts);
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.outputHash).toBe(b.outputHash);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('un ancien calcul se rejoue à l’identique même après publication d’une nouvelle version des paramètres', () => {
    const original = runCalculation(demoAdvancedInput(), opts);
    // Le SMIC 2024 est corrigé : l'ancienne version est archivée, une version 2 est publiée.
    const updated = TEST_PARAMETERS.flatMap((p) =>
      p.key === 'smic_horaire' && p.validFrom === '2024-01-01'
        ? [{ ...p, status: 'archive' as const }, { ...p, id: `${p.id}-v2`, version: 2, value: 12.5 }]
        : [p]);
    const fresh = runCalculation(demoAdvancedInput(), { ...opts, parameters: updated });
    expect(fresh.outputHash).not.toBe(original.outputHash);
    expect(fresh.parameterIds).toContain('test-smic_horaire-2024-01-01-v2');

    const replay = replayCalculation(original, { modules: MODULE_REGISTRY, parameters: updated });
    expect(replay.identical).toBe(true);
  });

  it('le rejeu échoue explicitement si un paramètre a disparu ou si un module a changé de version', () => {
    const original = runCalculation(demoQuickInput(), opts);
    const r1 = replayCalculation(original, { modules: MODULE_REGISTRY, parameters: TEST_PARAMETERS.slice(1) });
    expect(r1.identical).toBe(false);
    const bumped = MODULE_REGISTRY.map((m) => ({ ...m, version: '9.9.9' }));
    const r2 = replayCalculation(original, { modules: bumped, parameters: TEST_PARAMETERS });
    expect(r2).toMatchObject({ identical: false });
  });

  it('refuse deux modules avec le même identifiant', () => {
    expect(() => runCalculation(demoQuickInput(), { ...opts, modules: [MODULE_REGISTRY[0]!, MODULE_REGISTRY[0]!] })).toThrow(/double/);
  });
});

describe('Invariants des opportunités', () => {
  it('refuse un montant sur une opportunité non estimée', () => {
    const bad = fakeModule('BAD', 'recuperation_passee', 'x', 10, { status: 'parametre_manquant' });
    expect(() => runCalculation(demoQuickInput(), { ...opts, modules: [bad] })).toThrow(/ne peut pas porter de montant/);
  });
  it('refuse une opportunité estimée sans montant', () => {
    const bad = fakeModule('BAD', 'recuperation_passee', 'x', 10, { amounts: null });
    expect(() => runCalculation(demoQuickInput(), { ...opts, modules: [bad] })).toThrow(/doit porter un montant/);
  });
});

describe('Totaux et règles de cumul', () => {
  it('récupération passée et économies futures sont totalisées séparément', () => {
    const past = fakeModule('P', 'recuperation_passee', 'a', 1000);
    const fut = fakeModule('F', 'economie_future', 'b', 300);
    const r = runCalculation(demoQuickInput(), { ...opts, modules: [past, fut] });
    expect(r.totals.pastRecovery.central).toBe(1000);
    expect(r.totals.futureAnnualSavings.central).toBe(300);
  });

  it('refuse d’additionner deux modules sur la même assiette sans règle de cumul', () => {
    const a = fakeModule('A', 'recuperation_passee', 'cotisations:2024', 1000);
    const b = fakeModule('B', 'recuperation_passee', 'cotisations:2024', 500);
    const r = runCalculation(demoQuickInput(), { ...opts, modules: [a, b] });
    expect(r.cumulationConflicts).toHaveLength(1);
    expect(r.totals.pastRecovery.central).toBe(0);
  });

  it('additionne si une règle de cumul explicite l’autorise', () => {
    const a = fakeModule('A', 'recuperation_passee', 'cotisations:2024', 1000);
    const b = fakeModule('B', 'recuperation_passee', 'cotisations:2024', 500);
    const r = runCalculation(demoQuickInput(), {
      ...opts, modules: [a, b],
      cumulationRules: [{ id: 'r1', assiettePrefix: 'cotisations:', moduleIds: ['B', 'A'], description: 'test', sourceUrl: 'https://exemple.invalid' }],
    });
    expect(r.cumulationConflicts).toHaveLength(0);
    expect(r.totals.pastRecovery.central).toBe(1500);
  });

  it('les opportunités non estimées ne comptent jamais dans les totaux', () => {
    const r = runCalculation(demoQuickInput(), { ...opts, parameters: [] });
    expect(r.totals.pastRecovery).toEqual({ low: 0, central: 0, high: 0 });
    expect(r.missingParameters.length).toBeGreaterThan(0);
  });
});

describe('Commission', () => {
  it('commission indicative de 25 % et gain net sur la fourchette passée', () => {
    const c = indicativeCommission({ low: 1000, central: 2000, high: 4000 }, 0.25);
    expect(c.commission).toEqual({ low: 250, central: 500, high: 1000 });
    expect(c.netGain).toEqual({ low: 750, central: 1500, high: 3000 });
  });
  it('commission réelle uniquement sur un remboursement justifié saisi par un administrateur', () => {
    const rec = { amountReimbursed: 3249.86, receivedOn: '2027-03-01', proofDocumentId: 'doc-1', recordedByRole: 'admin' };
    expect(realCommission(rec, 0.25)).toBe(812.47);
    expect(() => realCommission({ ...rec, recordedByRole: 'analyst' }, 0.25)).toThrow();
    expect(() => realCommission({ ...rec, proofDocumentId: null }, 0.25)).toThrow();
    expect(() => realCommission({ ...rec, amountReimbursed: 0 }, 0.25)).toThrow();
    expect(() => realCommission(rec, 1.5)).toThrow();
  });
});
