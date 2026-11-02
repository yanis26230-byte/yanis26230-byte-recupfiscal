import { createHash } from 'node:crypto';
import type { ExtractedFieldDraft, PayrollFieldValue } from './types';

/**
 * Lecture d'un fichier DSN (norme NEODeS : lignes « rubrique,'valeur' »).
 * Rubriques lues (correspondances À VALIDER par un expert paie, cf. DECISIONS.md) :
 * - S20.G00.05.005 : mois principal déclaré (JJMMAAAA)
 * - S21.G00.06.001 / S21.G00.11.001 : SIREN / NIC de l'établissement
 * - S21.G00.30.019 : matricule du salarié (pseudonymisé ; le NIR S21.G00.30.001 n'est jamais lu)
 * - S21.G00.51.011 / .012 / .013 : type de rémunération, nombre d'heures, montant (type 001 = brut)
 * - S21.G00.81.001 / .004 : code et montant de cotisation individuelle (code 018 = réduction générale)
 * Chaque valeur est extraite avec une confiance < 1 et doit être validée avant usage.
 */
export const DSN_EXTRACTOR = 'regles:dsn-v1';
export const DSN_CONFIDENCE = 0.8;
export const DSN_GROSS_TYPES = ['001'];
export const DSN_GENERAL_REDUCTION_CODES = ['018'];

interface Individual { matricule: string | null; gross: number; hours: number; reduction: number; contractType: string | null }

export function pseudonymize(salt: string, matricule: string): string {
  return 'M' + createHash('sha256').update(`${salt}|${matricule}`).digest('hex').slice(0, 10).toUpperCase();
}

const amount = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export function parseDsn(text: string, salt: string): { fields: ExtractedFieldDraft[]; notes: string[]; recognised: boolean } {
  const notes: string[] = [];
  let year: number | null = null;
  let month: number | null = null;
  let siren = '';
  let nic = '';
  const people: Individual[] = [];
  let current: Individual | null = null;
  let pendingType: string | null = null;
  let pendingHours = 0;
  let pendingCode: string | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const m = /^(S\d{2}\.G\d{2}\.\d{2}\.\d{3}),'(.*)'\s*$/.exec(raw.trim());
    if (!m) continue;
    const [, rub, val] = m as unknown as [string, string, string];
    switch (rub) {
      case 'S20.G00.05.005': if (/^\d{8}$/.test(val)) { month = Number(val.slice(2, 4)); year = Number(val.slice(4, 8)); } break;
      case 'S21.G00.06.001': siren = val; break;
      case 'S21.G00.11.001': nic = val; break;
      case 'S21.G00.30.001': current = { matricule: null, gross: 0, hours: 0, reduction: 0, contractType: null }; people.push(current); break; // NIR ignoré
      case 'S21.G00.30.019': if (current) current.matricule = val; break;
      case 'S21.G00.40.007': if (current) current.contractType = val; break;
      case 'S21.G00.51.011': pendingType = val; break;
      case 'S21.G00.51.012': pendingHours = amount(val); break;
      case 'S21.G00.51.013':
        if (current && pendingType && DSN_GROSS_TYPES.includes(pendingType)) { current.gross += amount(val); current.hours += pendingHours; }
        pendingType = null; pendingHours = 0; break;
      case 'S21.G00.81.001': pendingCode = val; break;
      case 'S21.G00.81.004':
        if (current && pendingCode && DSN_GENERAL_REDUCTION_CODES.includes(pendingCode)) current.reduction += Math.abs(amount(val));
        pendingCode = null; break;
    }
  }
  if (year === null || month === null) return { fields: [], notes: ['Mois déclaré (S20.G00.05.005) introuvable : fichier DSN non reconnu.'], recognised: false };
  const siret = /^\d{9}$/.test(siren) && /^\d{5}$/.test(nic) ? siren + nic : null;
  const fields: ExtractedFieldDraft[] = [];
  people.forEach((p, i) => {
    if (!p.matricule) { notes.push(`Salarié n°${i + 1} sans matricule : ignoré.`); return; }
    const value: PayrollFieldValue = {
      employeeRef: pseudonymize(salt, p.matricule), year: year!, month: month!, gross: Math.round(p.gross * 100) / 100, hoursPaid: p.hours,
      overtimeHours: 0, reductionApplied: Math.round(p.reduction * 100) / 100, siret, contractType: p.contractType,
    };
    fields.push({ fieldKey: 'ligne_paie', value, page: null, zone: { salarie: i + 1 }, confidence: DSN_CONFIDENCE, extractor: DSN_EXTRACTOR, year: year! });
  });
  notes.push(`DSN ${String(month).padStart(2, '0')}/${year} : ${fields.length} salarié(s) lus. Heures supplémentaires non lues automatiquement.`);
  return { fields, notes, recognised: true };
}
