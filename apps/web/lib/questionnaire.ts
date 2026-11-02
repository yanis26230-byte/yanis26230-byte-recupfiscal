import { z } from 'zod';
import type { SectorId, StepId } from './sectors';

/** Code partagé client/serveur : aucune dépendance serveur ici. */
export const QUESTIONNAIRE_VERSION = 'rapide-v1';
export const CONSENT_TEXT_VERSION = 'consentement-v1';
export const CONSENT_TEXT =
  'J’accepte que les informations saisies soient enregistrées et traitées pour calculer cette estimation, conformément à la politique de confidentialité. Aucune donnée nominative sur les salariés n’est demandée.';

/** Mention obligatoire (cahier des charges §9), affichée sur chaque page de résultats et dans le rapport. */
export const DISCLAIMER =
  'Ces résultats sont des estimations fondées sur les informations communiquées. Ils ne constituent ni une validation fiscale ou sociale, ni une garantie de remboursement. Chaque opportunité doit être confirmée par une analyse documentaire.';

export const STEPS: { id: StepId; title: string; short: string }[] = [
  { id: 'entreprise', title: 'Votre entreprise', short: 'Entreprise' },
  { id: 'salaires', title: 'Répartition des salaires', short: 'Salaires' },
  { id: 'reduction', title: 'Réduction de cotisations déjà appliquée', short: 'Réduction' },
  { id: 'taux_at', title: 'Taux accident du travail', short: 'Taux AT' },
  { id: 'alternance', title: 'Apprentis et alternants', short: 'Alternance' },
  { id: 'dispositifs', title: 'Dispositifs existants', short: 'Dispositifs' },
  { id: 'recapitulatif', title: 'Récapitulatif et calcul', short: 'Récapitulatif' },
];

/** Mêmes identifiants que le moteur (vérifié par test). */
export const BRACKETS = [
  { id: 'lt_1_1', label: 'Moins de 1,1 SMIC', low: 1.0, high: 1.1 },
  { id: '1_1_1_3', label: '1,1 à 1,3 SMIC', low: 1.1, high: 1.3 },
  { id: '1_3_1_6', label: '1,3 à 1,6 SMIC', low: 1.3, high: 1.6 },
  { id: '1_6_2', label: '1,6 à 2 SMIC', low: 1.6, high: 2.0 },
  { id: '2_2_5', label: '2 à 2,5 SMIC', low: 2.0, high: 2.5 },
  { id: '2_5_3', label: '2,5 à 3 SMIC', low: 2.5, high: 3.0 },
  { id: 'gt_3', label: 'Plus de 3 SMIC', low: 3.0, high: null },
] as const;
export type BracketId = (typeof BRACKETS)[number]['id'];
const bracketIds = BRACKETS.map((b) => b.id) as [BracketId, ...BracketId[]];

export const SCHEMES = [
  { id: 'interessement', label: 'Intéressement' },
  { id: 'participation', label: 'Participation' },
  { id: 'pee', label: 'Plan d’épargne entreprise (PEE)' },
  { id: 'abondement', label: 'Abondement' },
  { id: 'ppv', label: 'Prime de partage de la valeur (PPV)' },
  { id: 'titres_restaurant', label: 'Titres-restaurant' },
] as const;
export type SchemeId = (typeof SCHEMES)[number]['id'];
const schemeIds = SCHEMES.map((s) => s.id) as [SchemeId, ...SchemeId[]];

const sectorIds = ['batiment', 'artisanat_alimentaire', 'commerce', 'restauration', 'industrie', 'autre'] as const satisfies readonly SectorId[];

const money = z.number().finite().min(0).max(100_000_000);
const pct = z.number().finite().min(0).max(100);
const yearKey = z.string().regex(/^\d{4}$/);
const text = (max: number) => z.string().trim().max(max);

export const companySchema = z.object({
  siren: z.string().regex(/^\d{9}$/, 'SIREN : 9 chiffres'),
  legalName: text(200).min(1, 'Raison sociale obligatoire'),
  legalForm: text(100).nullable(),
  nafCode: z.string().trim().regex(/^\d{2}\.?\d{2}[A-Z]?$/i, 'Code NAF invalide (ex. 10.71C)').nullable(),
  sector: z.enum(sectorIds),
  createdOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  headcountRange: text(60).nullable(),
  source: z.enum(['api', 'manuel']),
});
export type CompanyAnswers = z.infer<typeof companySchema>;

export const establishmentSchema = z.object({
  key: z.string().min(1).max(40),
  siret: z.string().regex(/^\d{14}$/, 'SIRET : 14 chiffres').nullable(),
  address: text(200),
  postalCode: z.string().trim().regex(/^(\d{5})?$/, 'Code postal : 5 chiffres'),
  city: text(100),
  inseeCode: z.string().regex(/^[0-9][0-9AB][0-9]{3}$/).nullable(),
  concerned: z.boolean(),
});
export type EstablishmentAnswers = z.infer<typeof establishmentSchema>;

export const stepSchemas = {
  entreprise: z.object({
    company: companySchema,
    establishments: z.array(establishmentSchema).min(1).max(50),
    headcountByYear: z.record(yearKey, z.number().finite().min(0).max(10_000).nullable()),
  }),
  salaires: z.object({
    years: z.record(yearKey, z.object({
      brackets: z.record(z.enum(bracketIds), z.object({
        count: z.number().int().min(0).max(5000),
        partTimeSharePct: pct,
        partTimeRatioPct: z.number().min(1).max(100).nullable(),
      })),
      overtimeHours: money.nullable(),
      payrollMass: money.nullable(),
    })),
  }),
  reduction: z.object({
    years: z.record(yearKey, z.object({ known: z.boolean(), amount: money.nullable() })),
    payrollProvider: text(100).nullable(),
  }),
  taux_at: z.object({
    rates: z.array(z.object({
      establishmentKey: z.string().min(1).max(40),
      year: z.number().int(),
      appliedRatePct: z.number().min(0).max(30).nullable(),
      notifiedRatePct: z.number().min(0).max(30).nullable(),
      payrollMass: money.nullable(),
    })).max(300),
  }),
  alternance: z.object({
    contracts: z.array(z.object({
      id: z.string().min(1).max(40),
      contractType: z.enum(['apprentissage', 'professionnalisation']),
      startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois au format AAAA-MM'),
      durationMonths: z.number().int().min(1).max(48),
      diplomaLevel: z.number().int().min(3).max(8).nullable(),
      aidReceived: z.enum(['oui', 'non', 'partiellement', 'inconnu']),
      aidAmountReceived: money.nullable(),
    })).max(50),
  }),
  dispositifs: z.object({
    schemes: z.record(z.enum(schemeIds), z.object({ active: z.boolean().nullable(), annualAmount: money.nullable() })),
    simulation: z.object({
      enabled: z.boolean(),
      envelopePerEmployee: z.number().min(0).max(100_000).nullable(),
      employeeCount: z.number().int().min(1).max(5000).nullable(),
      averageGross: money.nullable(),
      tmiPct: z.number().min(0).max(60).nullable(),
      mealDays: z.number().int().min(0).max(366).nullable(),
    }),
  }),
  recapitulatif: z.object({ consent: z.boolean(), consentTextVersion: z.string().max(40) }),
} satisfies Record<StepId, z.ZodTypeAny>;

export type StepAnswers = { [K in StepId]: z.infer<(typeof stepSchemas)[K]> };
export type Answers = Partial<StepAnswers>;

/** Métadonnées fixées par le serveur, jamais modifiables par le client. */
export interface AuditMeta {
  years: number[];
  /** Date de référence figée (démonstration) ; null = date du jour au moment du calcul. */
  fixedAsOfDate: string | null;
  isDemo: boolean;
}

/** Années du mode rapide : les deux années civiles précédentes et l'année en cours. */
export function quickModeYears(today: string): number[] {
  const y = Number(today.slice(0, 4));
  return [y - 2, y - 1, y];
}

export function defaultAnswers(step: StepId, years: number[], establishments: EstablishmentAnswers[]): StepAnswers[StepId] {
  const yk = years.map(String);
  switch (step) {
    case 'salaires':
      return { years: Object.fromEntries(yk.map((y) => [y, {
        brackets: Object.fromEntries(BRACKETS.map((b) => [b.id, { count: 0, partTimeSharePct: 0, partTimeRatioPct: null }])),
        overtimeHours: null, payrollMass: null }])) } as StepAnswers['salaires'];
    case 'reduction':
      return { years: Object.fromEntries(yk.map((y) => [y, { known: false, amount: null }])), payrollProvider: null };
    case 'taux_at':
      return { rates: establishments.filter((e) => e.concerned).flatMap((e) => years.map((year) => ({
        establishmentKey: e.key, year, appliedRatePct: null, notifiedRatePct: null, payrollMass: null }))) };
    case 'alternance':
      return { contracts: [] };
    case 'dispositifs':
      return { schemes: Object.fromEntries(SCHEMES.map((s) => [s.id, { active: null, annualAmount: null }])) as StepAnswers['dispositifs']['schemes'],
        simulation: { enabled: false, envelopePerEmployee: null, employeeCount: null, averageGross: null, tmiPct: null, mealDays: null } };
    case 'recapitulatif':
      return { consent: false, consentTextVersion: CONSENT_TEXT_VERSION };
    case 'entreprise':
      throw new Error('L’étape entreprise est initialisée à la création de l’audit');
  }
}

export interface Issue { step: StepId; message: string; blocking: boolean }

/** Contrôles avant calcul : bloquants (données indispensables) et avertissements. */
export function submissionIssues(answers: Answers, meta: AuditMeta): Issue[] {
  const issues: Issue[] = [];
  const e = answers.entreprise;
  if (!e) return [{ step: 'entreprise', message: 'Les informations sur l’entreprise sont manquantes.', blocking: true }];
  if (!e.establishments.some((x) => x.concerned)) issues.push({ step: 'entreprise', message: 'Sélectionnez au moins un établissement concerné.', blocking: true });
  for (const y of meta.years) {
    const h = e.headcountByYear[String(y)];
    if (h == null) issues.push({ step: 'entreprise', message: `Indiquez l’effectif moyen ${y}.`, blocking: true });
    const brackets = answers.salaires?.years[String(y)]?.brackets;
    const total = brackets ? Object.values(brackets).reduce((a, b) => a + b.count, 0) : 0;
    if (h != null && h > 0 && total === 0) issues.push({ step: 'salaires', message: `Répartissez les salariés par tranche de salaire pour ${y}.`, blocking: true });
    if (h != null && total > 0 && Math.abs(total - h) > Math.max(2, 0.2 * h)) {
      issues.push({ step: 'salaires', message: `${y} : ${total} salarié(s) répartis pour un effectif moyen de ${h}. Vérifiez la répartition.`, blocking: false });
    }
    const red = answers.reduction?.years[String(y)];
    if (red?.known && red.amount == null) issues.push({ step: 'reduction', message: `Indiquez le montant de réduction ${y} ou cochez « je ne sais pas ».`, blocking: true });
  }
  const sim = answers.dispositifs?.simulation;
  if (sim?.enabled && (sim.envelopePerEmployee == null || sim.employeeCount == null || sim.averageGross == null)) {
    issues.push({ step: 'dispositifs', message: 'Complétez l’enveloppe, le nombre de salariés et le salaire moyen du simulateur, ou désactivez-le.', blocking: true });
  }
  if (!answers.recapitulatif?.consent) issues.push({ step: 'recapitulatif', message: 'Votre consentement est nécessaire pour lancer le calcul.', blocking: true });
  return issues;
}

/** Saisie française : « 1 234,5 » -> 1234.5 ; vide -> null. */
export function parseFrNumber(input: string): number | null {
  const s = input.replace(/[\s  €%]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formatEur(x: number, decimals = 0): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(x);
}
