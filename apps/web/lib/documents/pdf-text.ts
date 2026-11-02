import type { AtRateFieldValue, ExtractedFieldDraft, ExtractionResult } from './types';

/** Classification par mots-clés du texte (déterministe). Sans couche texte : saisie manuelle. */
const RULES: { type: ExtractionResult['documentType']; all: RegExp[] }[] = [
  { type: 'notification_at', all: [/taux/i, /accidents? du travail|AT\/MP|ATMP/i, /notifi/i] },
  { type: 'bulletin_paie', all: [/bulletin de (paie|salaire)/i, /net (à|a) payer/i] },
  { type: 'contrat_apprentissage', all: [/contrat d.apprentissage/i] },
  { type: 'justificatif_aide', all: [/aide/i, /(versement|attribution)/i, /(apprenti|alternance|embauche)/i] },
  { type: 'liasse_fiscale', all: [/(2050|2033|liasse)/i, /(bilan|compte de r[ée]sultat)/i] },
];

export function classifyText(text: string): { type: ExtractionResult['documentType']; confidence: number } {
  for (const r of RULES) if (r.all.every((re) => re.test(text))) return { type: r.type, confidence: 0.7 };
  return { type: 'inconnu', confidence: 0 };
}

export const AT_EXTRACTOR = 'regles:notification-at-v1';

/**
 * Notification de taux AT/MP : recherche d'un taux en pourcentage et d'une année d'effet.
 * Extraction prudente (confiance 0,6), toujours soumise à validation ; plusieurs taux trouvés =
 * aucune extraction automatique (ambiguïté).
 */
export function extractAtRates(pages: string[]): { fields: ExtractedFieldDraft[]; notes: string[] } {
  const fields: ExtractedFieldDraft[] = [];
  const notes: string[] = [];
  pages.forEach((text, p) => {
    const rates = [...text.matchAll(/taux\s+(?:net\s+)?(?:notifi[ée]\s+|applicable\s+|de\s+cotisation\s+)?(?:[^\d%]{0,40})?(\d{1,2}[,.]\d{1,2})\s*%/gi)].map((m) => Number(m[1]!.replace(',', '.')));
    const unique = [...new Set(rates)];
    const year = /(?:ann[ée]e|compter du\s+\d{2}\/\d{2}\/|exercice)\s*(20\d{2})/i.exec(text)?.[1];
    const siret = /\b(\d{3}\s?\d{3}\s?\d{3}\s?\d{5})\b/.exec(text)?.[1]?.replace(/\s/g, '') ?? null;
    if (unique.length === 1 && year) {
      const value: AtRateFieldValue = { siret, year: Number(year), rate: unique[0]! / 100 };
      fields.push({ fieldKey: 'taux_at_notifie', value, page: p + 1, zone: null, confidence: 0.6, extractor: AT_EXTRACTOR, year: Number(year) });
    } else if (unique.length > 1) notes.push(`Page ${p + 1} : plusieurs taux trouvés (${unique.join(' ; ')} %) : saisie manuelle requise.`);
  });
  if (!fields.length && !notes.length) notes.push('Aucun taux identifiable automatiquement : saisie manuelle requise.');
  return { fields, notes };
}
