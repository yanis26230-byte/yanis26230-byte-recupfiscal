import { M1_KEYS } from '../modules/m1-reduction-generale/params.js';
import { CLAIM_DELAY_KEY } from '../claim.js';
import { m2Keys } from '../modules/m2-aides-embauche/index.js';
import { M5_KEYS, m5BandKeys } from '../modules/m5-epargne-salariale/index.js';
import type { RegulatoryParameter } from '../types.js';

/**
 * Amorce du jeu de paramètres OFFICIELS.
 *
 * Conformément au cahier des charges (§6.4, §7, §19) : AUCUNE valeur n'est inventée.
 * - Toutes les lignes sont au statut « a_renseigner », sans valeur, à compléter par un
 *   administrateur avec la source officielle, puis validées par un second utilisateur.
 * - Seule exception : les valeurs RGDU 2026 (< 50 salariés) fournies par le cahier des charges,
 *   saisies au statut « brouillon » (à vérifier sur urssaf.fr). Un brouillon n'est jamais
 *   utilisé par le moteur.
 */

type Spec = { key: string; label: string; unit: string; moduleId: string | null; years: number[] };

const M1 = 'M1_REDUCTION_GENERALE';
const RG_YEARS = [2023, 2024, 2025];
const ALL_YEARS = [2023, 2024, 2025, 2026];

const SPECS: Spec[] = [
  { key: M1_KEYS.smicHoraire, label: 'SMIC horaire brut', unit: 'EUR/h', moduleId: null, years: ALL_YEARS },
  { key: M1_KEYS.dureeMensuelle, label: 'Durée légale mensuelle du travail', unit: 'h', moduleId: null, years: ALL_YEARS },
  { key: M1_KEYS.seuilEffectif, label: 'Seuil d’effectif pour le coefficient de réduction générale', unit: 'salariés', moduleId: M1, years: ALL_YEARS },
  { key: M1_KEYS.decimales, label: 'Nombre de décimales d’arrondi du coefficient', unit: 'décimales', moduleId: M1, years: ALL_YEARS },
  { key: M1_KEYS.rgTmaxMoins, label: 'Réduction générale – coefficient maximal T (sous le seuil d’effectif)', unit: 'coefficient', moduleId: M1, years: RG_YEARS },
  { key: M1_KEYS.rgTmaxPlus, label: 'Réduction générale – coefficient maximal T (seuil d’effectif et plus)', unit: 'coefficient', moduleId: M1, years: RG_YEARS },
  { key: M1_KEYS.rgSeuilSortie, label: 'Réduction générale – seuil de sortie', unit: 'multiple du SMIC', moduleId: M1, years: RG_YEARS },
  { key: M1_KEYS.rgduTminPlus, label: 'RGDU – Tmin (seuil d’effectif et plus)', unit: 'coefficient', moduleId: M1, years: [2026] },
  { key: M1_KEYS.rgduTdeltaPlus, label: 'RGDU – Tdelta (seuil d’effectif et plus)', unit: 'coefficient', moduleId: M1, years: [2026] },
  { key: M1_KEYS.rgduSeuilSortie, label: 'RGDU – seuil de sortie', unit: 'multiple du SMIC', moduleId: M1, years: [2026] },
];

function row(key: string, label: string, unit: string, moduleId: string | null, year: number, extra: Partial<RegulatoryParameter> = {}): RegulatoryParameter {
  return {
    id: `off-${key}-${year}-v1`,
    key,
    label,
    value: null,
    unit,
    validFrom: `${year}-01-01`,
    validTo: `${year}-12-31`,
    territory: 'FR',
    moduleId,
    sourceUrl: null,
    verifiedAt: null,
    version: 1,
    status: 'a_renseigner',
    dataset: 'officiel',
    authorId: null,
    validatorId: null,
    ...extra,
  };
}

const RGDU_DRAFT_NOTE = 'Valeur issue du cahier des charges – brouillon, à vérifier sur urssaf.fr avant validation.';

export const OFFICIAL_PARAMETERS_SEED: RegulatoryParameter[] = [
  ...SPECS.flatMap((s) => s.years.map((y) => row(s.key, s.label, s.unit, s.moduleId, y))),
  row(M1_KEYS.rgduTminMoins, 'RGDU – Tmin (sous le seuil d’effectif)', 'coefficient', M1, 2026, { value: 0.02, status: 'brouillon', sourceUrl: 'https://www.urssaf.fr', note: RGDU_DRAFT_NOTE }),
  row(M1_KEYS.rgduTdeltaMoins, 'RGDU – Tdelta (sous le seuil d’effectif)', 'coefficient', M1, 2026, { value: 0.3781, status: 'brouillon', sourceUrl: 'https://www.urssaf.fr', note: RGDU_DRAFT_NOTE }),
  row(M1_KEYS.rgduPuissance, 'RGDU – puissance P', 'exposant', M1, 2026, { value: 1.75, status: 'brouillon', sourceUrl: 'https://www.urssaf.fr', note: RGDU_DRAFT_NOTE }),
  ...m2Rows(),
  ...m5Rows(),
  {
    ...row(CLAIM_DELAY_KEY, 'Délai de réclamation des cotisations indûment versées', 'années', null, 2023),
    id: `off-${CLAIM_DELAY_KEY}-v1`,
    validTo: null,
  },
];

/** M2 : une ligne par clé, par type de contrat et par année civile de conclusion (à redécouper par l'administrateur si les règles changent en cours d'année). */
function m2Rows(): RegulatoryParameter[] {
  const labels: Record<string, [string, string]> = {
    montantAnnuel: ['Montant annuel de l’aide (pour 12 mois de contrat)', 'EUR'],
    dureeMaxMois: ['Durée maximale d’éligibilité de l’aide', 'mois'],
    niveauMax: ['Niveau maximal du diplôme préparé', 'niveau'],
    effectifMax: ['Effectif strictement inférieur à', 'salariés'],
    delaiDemandeMois: ['Délai de demande à compter du début du contrat', 'mois'],
  };
  return (['apprentissage', 'professionnalisation'] as const).flatMap((t) => {
    const k = m2Keys(t);
    return (Object.keys(k) as (keyof typeof k)[]).flatMap((name) =>
      [2023, 2024, 2025, 2026].map((y) => row(k[name], `Aide ${t} – ${labels[name]![0]}`, labels[name]![1], 'M2_AIDES_EMBAUCHE', y)));
  });
}

function m5Rows(): RegulatoryParameter[] {
  const M5 = 'M5_EPARGNE_SALARIALE';
  const common = Object.values(M5_KEYS).map((key) => row(key, `Simulateur – ${key}`, '', M5, 2026));
  const bands = ([1, 2, 3] as const).flatMap((b) => Object.values(m5BandKeys(b)).map((key) => row(key, `Simulateur – ${key}`, '', M5, 2026)));
  return [...common, ...bands];
}
