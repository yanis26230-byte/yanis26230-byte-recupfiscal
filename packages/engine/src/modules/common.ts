import type { Opportunity } from '../types.js';

type Required = Pick<Opportunity, 'moduleId' | 'moduleVersion' | 'name' | 'kind' | 'year' | 'periodFrom' | 'periodTo'>;

/** Construit une opportunité avec des valeurs prudentes par défaut (pas de montant, confiance faible). */
export function makeOpportunity(base: Required, partial: Partial<Opportunity>): Opportunity {
  return {
    amounts: null,
    status: 'a_confirmer',
    confidence: 'faible',
    risk: 'standard',
    conditionsDetected: [],
    missingInformation: [],
    missingParameters: [],
    explanation: '',
    sources: [],
    documentsToProvide: [],
    calculationDetail: {},
    assiettes: [],
    countsInTotals: true,
    ...base,
    ...partial,
  };
}

export function range(x: number) {
  return { low: x, central: x, high: x };
}
