import type { RegulatoryParameter } from '../src/index.js';
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export function param(over: Partial<RegulatoryParameter> & Pick<RegulatoryParameter, 'id' | 'key' | 'validFrom'>): RegulatoryParameter {
  return {
    label: over.key, value: 1, unit: '', validTo: null, territory: 'FR', moduleId: null, sourceUrl: 'https://exemple.invalid',
    verifiedAt: null, version: 1, status: 'publie', dataset: 'test', authorId: 'a', validatorId: 'b', ...over,
  };
}
