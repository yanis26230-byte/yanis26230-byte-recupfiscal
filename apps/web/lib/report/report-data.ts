import type { AmountRange, MissingParameter, Opportunity, ReferenceData, RegulatoryParameter } from '@recupfiscal/engine';
import { BRACKETS, DISCLAIMER, SCHEMES, type AuditMeta, type StepAnswers } from '../questionnaire';

export const REPORT_TEMPLATE_VERSION = 'rapport-v1';

export interface ReportInput {
  answers: StepAnswers;
  meta: AuditMeta;
  isDemo: boolean;
  generatedAt: string;
  commissionRate: number;
  run: {
    id: string; dataset: string; engineVersion: string; moduleVersions: Record<string, string>; asOfDate: string;
    inputHash: string; outputHash: string; totals: { pastRecovery: AmountRange; futureAnnualSavings: AmountRange };
    opportunities: Opportunity[]; parameters: RegulatoryParameter[]; reference: ReferenceData; missingParameters: MissingParameter[];
  };
}

const STATUS: Record<Opportunity['status'], string> = {
  estime: 'Estimé', a_confirmer: 'À confirmer', informations_manquantes: 'Informations manquantes', parametre_manquant: 'Paramètres en cours de validation',
  non_reclamable: 'Non réclamable', aucun_ecart: 'Aucun écart',
};
const CONF = { eleve: 'élevée', moyen: 'moyenne', faible: 'faible' };
const RISK = { faible: 'faible', standard: 'standard', eleve: 'élevé' };

/** Montant au format français, espaces simples (compatibles avec les polices PDF standard). */
export function eur(x: number): string {
  const n = Math.round(x);
  return `${n < 0 ? '-' : ''}${String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
}
const range = (r: AmountRange | null) => (!r ? '—' : r.low === r.high ? eur(r.central) : `${eur(r.low)} à ${eur(r.high)}`);
const pct = (x: number) => `${Math.round(x * 100)} %`;
const frDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export interface ReportSection { title: string; rows?: [string, string][]; paragraphs?: string[]; items?: string[] }
export interface ReportOpportunity {
  title: string; subtitle: string; amount: string; status: string; confidenceRisk: string; explanation: string;
  conditions: string[]; missing: string[]; documents: string[]; sources: string[]; calculation: [string, string][]; hypotheses: string[];
}
export interface ReportData {
  title: string; companyLine: string; demoBanner: string | null; generatedLine: string;
  indicators: { past: string; commission: string; netGain: string; future: string };
  sections: ReportSection[]; opportunities: ReportOpportunity[]; disclaimer: string; footer: string;
}

/** Détail de calcul aplati en lignes lisibles (clé, valeur), sans les sous-structures volumineuses. */
function flattenDetail(detail: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(detail)) {
    if (k === 'hypotheses' || v === null || v === undefined) continue;
    if (typeof v === 'number') out.push([k, Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000)]);
    else if (typeof v === 'string' || typeof v === 'boolean') out.push([k, String(v)]);
    else if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) out.push([k, v.join(', ')]);
    else if (Array.isArray(v)) out.push([k, `${v.length} ligne(s) détaillée(s)`]);
    else if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('low' in o && 'high' in o) out.push([k, `${eur(Number(o.low))} à ${eur(Number(o.high))}`]);
      else out.push([k, Object.entries(o).filter(([, x]) => typeof x !== 'object').map(([a, b]) => `${a} = ${b}`).join(' ; ')]);
    }
  }
  return out.slice(0, 18);
}

export function buildReportData(input: ReportInput): ReportData {
  const { answers: a, meta, run } = input;
  const c = a.entreprise.company;
  const t = run.totals;
  const commission = { low: t.pastRecovery.low * input.commissionRate, high: t.pastRecovery.high * input.commissionRate };
  const ops = run.opportunities;
  const years = meta.years.join(', ');

  const declared: [string, string][] = [];
  for (const y of meta.years) {
    const yk = String(y);
    const brackets = a.salaires.years[yk]?.brackets ?? {};
    const desc = BRACKETS.map((b) => ({ b, v: brackets[b.id] })).filter((x) => (x.v?.count ?? 0) > 0)
      .map((x) => `${x.b.label} : ${x.v!.count}${x.v!.partTimeSharePct ? ` (dont ${x.v!.partTimeSharePct} % à temps partiel)` : ''}`).join(' ; ');
    const red = a.reduction.years[yk];
    declared.push([`Effectif moyen ${y}`, String(a.entreprise.headcountByYear[yk] ?? 'non renseigné')]);
    declared.push([`Salaires ${y}`, desc || 'non renseignés']);
    declared.push([`Réduction générale déclarée ${y}`, red?.known && red.amount != null ? eur(red.amount) : 'inconnue']);
  }
  declared.push(['Taux AT renseignés', String(a.taux_at.rates.filter((r) => r.appliedRatePct != null).length)]);
  declared.push(['Contrats d’alternance', String(a.alternance.contracts.length)]);
  declared.push(['Dispositifs en place', SCHEMES.filter((s) => a.dispositifs.schemes[s.id]?.active).map((s) => s.label).join(', ') || 'aucun déclaré']);

  const missingDocs = [...new Set(ops.filter((o) => o.status !== 'aucun_ecart').flatMap((o) => o.documentsToProvide))];
  const missingInfo = [...new Set(ops.flatMap((o) => o.missingInformation))];
  const hypotheses = [...new Set(ops.flatMap((o) => (Array.isArray(o.calculationDetail.hypotheses) ? (o.calculationDetail.hypotheses as string[]) : [])))];
  const params = [...run.parameters].sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : x.validFrom < y.validFrom ? -1 : 1));

  const sections: ReportSection[] = [
    { title: 'Entreprise et périmètre', rows: [
      ['Raison sociale', c.legalName], ['SIREN', c.siren], ['Forme juridique', c.legalForm ?? '—'], ['Code NAF', c.nafCode ?? '—'],
      ['Établissements inclus', a.entreprise.establishments.filter((e) => e.concerned).map((e) => `${e.city || '—'}${e.siret ? ` (${e.siret})` : ''}`).join(' ; ')],
      ['Mode', 'Estimation rapide (déclaratif, sans document)'], ['Années analysées', years], ['Date de référence du calcul', frDate(run.asOfDate)],
      ['Modules', Object.keys(run.moduleVersions).join(', ')],
    ] },
    { title: 'Données déclarées', rows: declared },
    { title: 'Confiance et risques', paragraphs: [
      `${ops.filter((o) => o.status === 'estime').length} opportunité(s) chiffrée(s), ${ops.filter((o) => o.status === 'a_confirmer').length} piste(s) à confirmer, ${ops.filter((o) => o.status === 'informations_manquantes').length} en attente d’informations, ${ops.filter((o) => o.status === 'parametre_manquant').length} en attente de paramètres officiels.`,
      'Le niveau de confiance reflète la précision des données (déclaratives en mode rapide). Le niveau de risque reflète l’exposition en cas de contrôle si la démarche est engagée.',
    ] },
    { title: 'Hypothèses retenues', items: hypotheses.length ? hypotheses : ['Aucune hypothèse particulière.'] },
    { title: 'Informations et documents à fournir', items: [...missingInfo.map((m) => `Information : ${m}`), ...missingDocs.map((d) => `Document : ${d}`)].slice(0, 40) },
    { title: 'Paramètres réglementaires utilisés', rows: params.length
        ? params.map((p) => [`${p.key} (${frDate(p.validFrom)} – ${p.validTo ? frDate(p.validTo) : '…'})`, `${p.value} ${p.unit} · v${p.version} · ${p.sourceUrl ?? 'source non renseignée'}`] as [string, string])
        : [['—', 'Aucun paramètre publié n’a pu être utilisé']] },
    ...(run.missingParameters.length ? [{ title: 'Paramètres officiels en cours de validation', items: run.missingParameters.map((m) => `${m.key} (${frDate(m.periodFrom)} – ${frDate(m.periodTo)})`) }] : []),
    ...(run.reference.zoningDatasets.length ? [{ title: 'Zonages consultés', items: run.reference.zoningDatasets.map((d) => `${d.zoneType} (${frDate(d.validFrom)} – ${d.validTo ? frDate(d.validTo) : '…'}) : ${d.sourceLabel} – ${d.sourceUrl}`) }] : []),
    { title: 'Commission indicative', paragraphs: [
      t.pastRecovery.high > 0
        ? `Commission de ${pct(input.commissionRate)} calculée uniquement sur les sommes réellement remboursées. Sur la base de cette estimation : ${eur(commission.low)} à ${eur(commission.high)}, soit un gain net estimé de ${eur(t.pastRecovery.low - commission.low)} à ${eur(t.pastRecovery.high - commission.high)}.`
        : 'Aucune récupération chiffrée à ce stade : aucune commission.',
      'Les économies futures ne sont pas commissionnées. Rien n’est dû si rien n’est récupéré.',
    ] },
    { title: 'Prochaines étapes', items: [
      'Compléter les informations manquantes et réunir les documents listés.',
      'Faire confirmer chaque opportunité par l’analyse documentaire (mode avancé).',
      'Si vous le souhaitez, confier la démarche de récupération : un mandat précisera les conditions avant toute action.',
    ] },
    { title: 'Traçabilité du calcul', rows: [
      ['Identifiant du calcul', run.id], ['Version du moteur', run.engineVersion],
      ['Versions des modules', Object.entries(run.moduleVersions).map(([k, v]) => `${k} ${v}`).join(' ; ')],
      ['Jeu de paramètres', run.dataset === 'test' ? 'TEST (valeurs fictives de démonstration)' : 'officiel'],
      ['Empreinte des entrées', run.inputHash], ['Empreinte des résultats', run.outputHash],
    ] },
  ];

  const opportunities: ReportOpportunity[] = ops.map((o) => ({
    title: o.name,
    subtitle: `${o.kind === 'recuperation_passee' ? 'Récupération passée' : 'Économie future'} · ${frDate(o.periodFrom)} – ${frDate(o.periodTo)}`,
    amount: o.amounts ? `${range(o.amounts)}${o.countsInTotals ? '' : ' (simulation, non additionnée)'}` : 'Sans montant',
    status: STATUS[o.status],
    confidenceRisk: `Confiance ${CONF[o.confidence]} · risque ${RISK[o.risk]}`,
    explanation: o.explanation,
    conditions: o.conditionsDetected, missing: o.missingInformation, documents: o.documentsToProvide,
    sources: o.sources.map((s) => `${s.label} – ${s.url}`),
    calculation: flattenDetail(o.calculationDetail),
    hypotheses: Array.isArray(o.calculationDetail.hypotheses) ? (o.calculationDetail.hypotheses as string[]) : [],
  }));

  return {
    title: 'Rapport d’estimation',
    companyLine: `${c.legalName} · SIREN ${c.siren}`,
    demoBanner: input.isDemo ? 'DÉMONSTRATION : entreprise fictive et paramètres de test fictifs, sans valeur réglementaire.' : null,
    generatedLine: `Généré le ${frDate(input.generatedAt)} · calcul ${run.id}`,
    indicators: {
      past: t.pastRecovery.high > 0 ? `${eur(t.pastRecovery.low)} à ${eur(t.pastRecovery.high)}` : 'Aucun montant chiffré',
      commission: t.pastRecovery.high > 0 ? `${eur(commission.low)} à ${eur(commission.high)} (${pct(input.commissionRate)})` : '—',
      netGain: t.pastRecovery.high > 0 ? `${eur(t.pastRecovery.low - commission.low)} à ${eur(t.pastRecovery.high - commission.high)}` : '—',
      future: t.futureAnnualSavings.high > 0 ? `jusqu’à ${eur(t.futureAnnualSavings.high)} par an` : 'Aucune économie chiffrée',
    },
    sections, opportunities, disclaimer: DISCLAIMER, footer: `Calcul ${run.id} · ${REPORT_TEMPLATE_VERSION}`,
  };
}
