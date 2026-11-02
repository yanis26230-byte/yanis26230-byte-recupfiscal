import type { ExtractedFieldDraft, PayrollFieldValue } from './types';

/**
 * Modèle de journal de paie (CSV ou XLSX) fourni par la plateforme. Une ligne par salarié et par
 * mois. Les en-têtes sont reconnus sans tenir compte des accents ni de la casse.
 */
export const TEMPLATE_COLUMNS = ['identifiant', 'annee', 'mois', 'brut', 'heures', 'heures_sup', 'reduction_generale', 'siret', 'contrat'] as const;
export const TEMPLATE_EXTRACTOR = 'regles:modele-paie-v1';
const REQUIRED = ['identifiant', 'annee', 'mois', 'brut', 'heures'] as const;

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[\s-]+/g, '_');

export function parseFrDecimal(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[\s  €]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function splitCsv(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const sep = (lines[0]?.split(';').length ?? 0) > (lines[0]?.split(',').length ?? 0) ? ';' : ',';
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
      else if (ch === sep && !quoted) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  });
}

export function rowsToPayrollFields(rows: unknown[][]): { fields: ExtractedFieldDraft[]; notes: string[]; recognised: boolean } {
  const header = (rows[0] ?? []).map(norm);
  const idx = Object.fromEntries(TEMPLATE_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof TEMPLATE_COLUMNS)[number], number>;
  const missing = REQUIRED.filter((c) => idx[c] < 0);
  if (missing.length) return { fields: [], notes: [`Colonnes obligatoires absentes : ${missing.join(', ')}. Utilisez le modèle fourni.`], recognised: false };
  const fields: ExtractedFieldDraft[] = [];
  const notes: string[] = [];
  const cell = (r: unknown[], c: (typeof TEMPLATE_COLUMNS)[number]) => (idx[c] >= 0 ? r[idx[c]] : undefined);
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    if (r.every((x) => String(x ?? '').trim() === '')) return;
    const id = String(cell(r, 'identifiant') ?? '').trim();
    const year = parseFrDecimal(cell(r, 'annee'));
    const month = parseFrDecimal(cell(r, 'mois'));
    const gross = parseFrDecimal(cell(r, 'brut'));
    const hours = parseFrDecimal(cell(r, 'heures'));
    const problems: string[] = [];
    if (!/^[A-Za-z0-9_.\-]{1,32}$/.test(id)) problems.push('identifiant invalide (32 caractères, sans espace)');
    if (year === null || !Number.isInteger(year) || year < 2015 || year > 2100) problems.push('année invalide');
    if (month === null || !Number.isInteger(month) || month < 1 || month > 12) problems.push('mois invalide');
    if (gross === null || gross < 0) problems.push('brut invalide');
    if (hours === null || hours < 0 || hours > 400) problems.push('heures invalides');
    if (problems.length) { notes.push(`Ligne ${line} ignorée : ${problems.join(', ')}.`); return; }
    const siret = String(cell(r, 'siret') ?? '').replace(/\s/g, '');
    const value: PayrollFieldValue = {
      employeeRef: id, year: year!, month: month!, gross: gross!, hoursPaid: hours!,
      overtimeHours: parseFrDecimal(cell(r, 'heures_sup')) ?? 0,
      reductionApplied: Math.abs(parseFrDecimal(cell(r, 'reduction_generale')) ?? 0),
      siret: /^\d{14}$/.test(siret) ? siret : null,
      contractType: String(cell(r, 'contrat') ?? '').trim() || null,
    };
    fields.push({ fieldKey: 'ligne_paie', value, page: null, zone: { ligne: line }, confidence: 1, extractor: TEMPLATE_EXTRACTOR, year: value.year });
  });
  // Doublons salarié/mois : le dernier l'emporte, signalé.
  const seen = new Map<string, number>();
  fields.forEach((f, i) => { const v = f.value as PayrollFieldValue; const k = `${v.employeeRef}|${v.year}|${v.month}`; if (seen.has(k)) notes.push(`Doublon ${v.employeeRef} ${v.month}/${v.year} : seule la dernière ligne est conservée.`); seen.set(k, i); });
  return { fields: fields.filter((_, i) => [...seen.values()].includes(i)), notes, recognised: true };
}

export function templateCsv(): string {
  return `${TEMPLATE_COLUMNS.join(';')}\nS001;2025;1;2100,50;151,67;0;612,40;;CDI\nS001;2025;2;2100,50;151,67;4;612,40;;CDI\n`;
}
