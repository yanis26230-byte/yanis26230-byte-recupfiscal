/**
 * Secteur déduit du code NAF (rév. 2) : personnalise l'aide contextuelle du questionnaire.
 * Secteurs prioritaires : bâtiment et artisanat, commerce, restauration, industrie.
 */
export type SectorId = 'batiment' | 'artisanat_alimentaire' | 'commerce' | 'restauration' | 'industrie' | 'autre';

export const SECTOR_LABELS: Record<SectorId, string> = {
  batiment: 'Bâtiment et travaux',
  artisanat_alimentaire: 'Artisanat alimentaire',
  commerce: 'Commerce',
  restauration: 'Restauration et hébergement',
  industrie: 'Industrie et fabrication',
  autre: 'Autre activité',
};

/** Boulangerie, pâtisserie, charcuterie : artisanat alimentaire (même si classés en section C). */
const ARTISANAT_ALIMENTAIRE = ['10.13B', '10.71B', '10.71C', '10.71D', '47.24Z', '47.22Z', '47.29Z'];

export function sectorFromNaf(naf: string | null | undefined): SectorId {
  if (!naf) return 'autre';
  const code = naf.trim().toUpperCase();
  if (ARTISANAT_ALIMENTAIRE.includes(code)) return 'artisanat_alimentaire';
  const division = Number(code.slice(0, 2));
  if (!Number.isFinite(division)) return 'autre';
  if (division >= 41 && division <= 43) return 'batiment';
  if (division >= 55 && division <= 56) return 'restauration';
  if (division >= 45 && division <= 47) return 'commerce';
  if (division >= 10 && division <= 33) return 'industrie';
  return 'autre';
}

export type StepId = 'entreprise' | 'salaires' | 'reduction' | 'taux_at' | 'alternance' | 'dispositifs' | 'recapitulatif';

/**
 * Aide contextuelle : où trouver l'information, sans affirmation réglementaire chiffrée.
 * Les textes sectoriels sont à relire par un expert métier (DECISIONS.md D-034).
 */
const COMMON_HELP: Record<StepId, string> = {
  entreprise: 'L’effectif moyen annuel figure dans votre déclaration sociale nominative (DSN) ou auprès de votre expert-comptable. Une estimation suffit à ce stade.',
  salaires: 'Classez chaque salarié selon son salaire brut annuel en équivalent temps plein. L’équivalent en euros de chaque tranche est affiché lorsque le SMIC de l’année est disponible dans la plateforme. Aucune donnée nominative n’est demandée.',
  reduction: 'Le montant annuel de la « réduction générale des cotisations » apparaît dans le récapitulatif annuel de votre logiciel de paie ou peut être fourni par votre expert-comptable. Si vous ne le connaissez pas, cochez « je ne sais pas » : nous ne chiffrerons alors pas d’écart.',
  taux_at: 'Le taux accident du travail est notifié chaque année pour chaque établissement, sur votre compte AT/MP (net-entreprises.fr). Le taux appliqué figure sur vos bulletins de paie.',
  alternance: 'Indiquez chaque contrat d’apprentissage ou de professionnalisation, même terminé. Une date de début approximative (mois) suffit.',
  dispositifs: 'Ces informations servent à vous proposer des leviers pour l’avenir. Le simulateur est facultatif.',
  recapitulatif: 'Vérifiez vos réponses avant le calcul. Vous pourrez revenir en arrière pour les corriger.',
};

const SECTOR_HELP: Partial<Record<SectorId, Partial<Record<StepId, string>>>> = {
  batiment: {
    salaires: 'Bâtiment : comptez tous les compagnons, ETAM et cadres. Les indemnités de petits déplacements et de trajet ne font pas partie du salaire brut à indiquer si elles sont versées en remboursement de frais.',
    taux_at: 'Bâtiment : chaque chantier permanent ou établissement peut avoir son propre taux AT. Reportez le taux de chaque établissement concerné.',
    alternance: 'Bâtiment : pensez aux apprentis en CAP, BP et bac pro, y compris ceux partis en cours de contrat.',
  },
  artisanat_alimentaire: {
    salaires: 'Artisanat alimentaire : les avantages en nature (repas fournis) font partie du salaire brut. Comptez aussi les vendeurs et vendeuses à temps partiel.',
    alternance: 'Artisanat alimentaire : les contrats d’apprentissage (CAP boulanger, pâtissier, vendeur…) sont fréquents ; indiquez-les tous.',
  },
  restauration: {
    salaires: 'Restauration : les avantages en nature repas font partie du salaire brut. Les extras et saisonniers sont à compter au prorata de leur temps de présence.',
    dispositifs: 'Restauration : si vous fournissez déjà les repas, les titres-restaurant ne sont généralement pas pertinents.',
  },
  commerce: {
    salaires: 'Commerce : comptez les salariés à temps partiel dans leur tranche en équivalent temps plein, et indiquez leur part.',
  },
  industrie: {
    taux_at: 'Industrie : le taux AT dépend du code risque et, au-delà d’un certain effectif, de la sinistralité propre de l’établissement. Vérifiez la notification de chaque site.',
  },
};

export function helpFor(step: StepId, sector: SectorId): { common: string; sector: string | null } {
  return { common: COMMON_HELP[step], sector: SECTOR_HELP[sector]?.[step] ?? null };
}
