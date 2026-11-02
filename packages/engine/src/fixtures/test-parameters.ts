import { CLAIM_DELAY_KEY } from '../claim.js';
import { M1_KEYS } from '../modules/m1-reduction-generale/params.js';
import { m2Keys } from '../modules/m2-aides-embauche/index.js';
import { expectedRateKey } from '../modules/m3-taux-at/index.js';
import { M5_KEYS, m5BandKeys } from '../modules/m5-epargne-salariale/index.js';
import type { RegulatoryParameter } from '../types.js';

/**
 * Jeu de paramètres de TEST (dataset « test »).
 * VALEURS FICTIVES, arrondies volontairement, sans lien avec la réglementation réelle.
 * Elles servent uniquement aux tests automatisés et à la Boulangerie Démo.
 * Le moteur ne les utilise jamais pour un calcul réel (dataset distinct).
 */

function p(key: string, value: number, validFrom: string, validTo: string | null, unit = ''): RegulatoryParameter {
  return {
    id: `test-${key}-${validFrom}`,
    key,
    label: `TEST – valeur fictive – ${key}`,
    value,
    unit,
    validFrom,
    validTo,
    territory: 'FR',
    moduleId: null,
    sourceUrl: 'https://exemple.invalid/parametres-de-test',
    verifiedAt: '2026-01-01',
    version: 1,
    status: 'publie',
    dataset: 'test',
    authorId: 'test-author',
    validatorId: 'test-validator',
    note: 'Valeur fictive de test',
  };
}

const yearly = (key: string, values: Record<number, number>) =>
  Object.entries(values).map(([y, v]) => p(key, v, `${y}-01-01`, `${y}-12-31`));

export const TEST_PARAMETERS: RegulatoryParameter[] = [
  // SMIC fictif, revalorisé en cours d'année 2023 pour tester le découpage mensuel.
  p(M1_KEYS.smicHoraire, 12.0, '2023-01-01', '2023-04-30', 'EUR/h'),
  p(M1_KEYS.smicHoraire, 12.2, '2023-05-01', '2023-12-31', 'EUR/h'),
  ...yearly(M1_KEYS.smicHoraire, { 2024: 12.4, 2025: 12.6, 2026: 12.8 }),
  ...yearly(M1_KEYS.dureeMensuelle, { 2023: 151.67, 2024: 151.67, 2025: 151.67, 2026: 151.67 }),
  ...yearly(M1_KEYS.seuilEffectif, { 2023: 50, 2024: 50, 2025: 50, 2026: 50 }),
  ...yearly(M1_KEYS.decimales, { 2023: 4, 2024: 4, 2025: 4, 2026: 4 }),
  ...yearly(M1_KEYS.rgTmaxMoins, { 2023: 0.32, 2024: 0.32, 2025: 0.32 }),
  ...yearly(M1_KEYS.rgTmaxPlus, { 2023: 0.324, 2024: 0.324, 2025: 0.324 }),
  ...yearly(M1_KEYS.rgSeuilSortie, { 2023: 1.6, 2024: 1.6, 2025: 1.6 }),
  ...yearly(M1_KEYS.rgduTminMoins, { 2026: 0.02 }),
  ...yearly(M1_KEYS.rgduTminPlus, { 2026: 0.02 }),
  ...yearly(M1_KEYS.rgduTdeltaMoins, { 2026: 0.38 }),
  ...yearly(M1_KEYS.rgduTdeltaPlus, { 2026: 0.384 }),
  ...yearly(M1_KEYS.rgduPuissance, { 2026: 1.75 }),
  ...yearly(M1_KEYS.rgduSeuilSortie, { 2026: 3 }),
  p(CLAIM_DELAY_KEY, 3, '2020-01-01', null, 'années'),

  // M2 – aides à l'embauche, par date de début de contrat (valeurs fictives).
  ...m2Period('apprentissage', '2023-01-01', '2024-12-31', { montantAnnuel: 5000, dureeMaxMois: 12, niveauMax: 7, effectifMax: 250, delaiDemandeMois: 6 }),
  ...m2Period('apprentissage', '2025-01-01', null, { montantAnnuel: 4000, dureeMaxMois: 12, niveauMax: 7, effectifMax: 250, delaiDemandeMois: 6 }),
  ...m2Period('professionnalisation', '2023-01-01', '2024-12-31', { montantAnnuel: 5000, dureeMaxMois: 12, niveauMax: 7, effectifMax: 250, delaiDemandeMois: 6 }),

  // M3 – taux collectif fictif du code risque de démonstration.
  ...yearly(expectedRateKey('DEMO-AT'), { 2023: 0.021, 2024: 0.021, 2025: 0.021, 2026: 0.021 }),

  // M5 – simulateur, année 2026 uniquement (valeurs fictives).
  ...yearly(M5_KEYS.pass, { 2026: 48000 }),
  ...yearly(M5_KEYS.seuil1, { 2026: 50 }),
  ...yearly(M5_KEYS.seuil2, { 2026: 250 }),
  ...yearly(M5_KEYS.tauxPatronalRef, { 2026: 0.42 }),
  ...yearly(M5_KEYS.tauxSalarialRef, { 2026: 0.22 }),
  ...yearly(M5_KEYS.csgCrds, { 2026: 0.097 }),
  ...yearly(M5_KEYS.interessementPlafondPass, { 2026: 0.75 }),
  ...yearly(M5_KEYS.abondementPlafondPass, { 2026: 0.08 }),
  ...yearly(M5_KEYS.abondementRatioMax, { 2026: 3 }),
  ...yearly(M5_KEYS.ppvPlafond, { 2026: 3000 }),
  ...yearly(M5_KEYS.ppvSeuilSmic, { 2026: 3 }),
  ...yearly(M5_KEYS.trExoMax, { 2026: 7 }),
  ...yearly(M5_KEYS.trPartMax, { 2026: 0.6 }),
  ...m5Band(1, { fsInteressement: 0, fsAbondement: 0, fsPpv: 0, ppvCsg: 0.097, ppvExoIr: 1 }),
  ...m5Band(2, { fsInteressement: 0, fsAbondement: 0.2, fsPpv: 0.2, ppvCsg: 0.097, ppvExoIr: 0 }),
  ...m5Band(3, { fsInteressement: 0.2, fsAbondement: 0.2, fsPpv: 0.2, ppvCsg: 0.097, ppvExoIr: 0 }),
];

function m2Period(t: 'apprentissage' | 'professionnalisation', from: string, to: string | null, v: Record<keyof ReturnType<typeof m2Keys>, number>) {
  const k = m2Keys(t);
  return (Object.keys(k) as (keyof typeof k)[]).map((name) => p(k[name], v[name], from, to));
}

function m5Band(band: 1 | 2 | 3, v: Record<keyof ReturnType<typeof m5BandKeys>, number>) {
  const k = m5BandKeys(band);
  return (Object.keys(k) as (keyof typeof k)[]).map((name) => p(k[name], v[name], '2026-01-01', '2026-12-31'));
}

