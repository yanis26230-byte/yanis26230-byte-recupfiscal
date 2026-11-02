import { describe, expect, it } from 'vitest';
import { MODULE_REGISTRY, REFERENCE_CASES, runReferenceCase } from '../src/index.js';

describe('Cas de référence', () => {
  it('chaque module a au moins un cas de référence', () => {
    for (const m of MODULE_REGISTRY) expect(REFERENCE_CASES.some((c) => c.moduleId === m.id), m.id).toBe(true);
  });
  it.each(REFERENCE_CASES.map((c) => [c.id, c] as const))('%s', (_id, rc) => {
    expect(runReferenceCase(rc).failures).toEqual([]);
  });
});
