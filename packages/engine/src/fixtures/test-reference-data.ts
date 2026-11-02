import type { ReferenceData } from '../types.js';

/**
 * Données de zonage de TEST : type de zone FICTIF « zone_demo », dispositif FICTIF.
 * Aucune commune réelle n'est classée ici dans un zonage réel.
 */
export const TEST_REFERENCE_DATA: ReferenceData = {
  zoningDatasets: [
    { id: 'test-zds-demo-2023-2026', zoneType: 'zone_demo', validFrom: '2023-01-01', validTo: '2026-12-31', sourceUrl: 'https://exemple.invalid/zonage-de-test',
      sourceLabel: 'TEST – table de zonage fictive', version: 1, status: 'publie', dataset: 'test' },
  ],
  zoningEntries: [
    // Commune de la Boulangerie Démo, classée (fictivement) jusqu'au 30 juin 2024.
    { id: 'test-ze-26362', datasetId: 'test-zds-demo-2023-2026', inseeCode: '26362', communeName: 'Commune de démonstration', validFrom: '2023-01-01', validTo: '2024-06-30' },
    { id: 'test-ze-00001', datasetId: 'test-zds-demo-2023-2026', inseeCode: '00001', communeName: 'Autre commune de test', validFrom: '2023-01-01', validTo: null },
  ],
  zoneSchemes: [
    { id: 'test-zs-exo-demo', zoneType: 'zone_demo', code: 'EXO_DEMO', name: 'TEST – exonération zonale fictive', description: 'Dispositif fictif de test.',
      conditions: ['TEST – condition fictive : embauche dans la zone'], documentsToProvide: ['TEST – justificatif fictif'],
      sourceUrl: 'https://exemple.invalid/dispositif-de-test', validFrom: '2023-01-01', validTo: null, version: 1, status: 'publie', dataset: 'test' },
  ],
};
