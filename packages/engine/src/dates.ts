/** Utilitaires de dates ISO (AAAA-MM-JJ), sans fuseau horaire, déterministes. */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(d: string): void {
  if (!ISO.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) {
    throw new Error(`Date ISO invalide : ${d}`);
  }
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function yearStart(year: number): string {
  return `${year}-01-01`;
}

export function yearEnd(year: number): string {
  return `${year}-12-31`;
}

export function monthStart(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

export function monthEnd(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(last)}`;
}

/** Comparaison lexicographique valable pour des dates ISO. */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDays(d: string, days: number): string {
  const t = Date.parse(`${d}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function addYears(d: string, years: number): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y + years, m - 1, day));
  // 29 février -> 28 février si l'année cible n'est pas bissextile
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

export function addMonths(d: string, months: number): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/** Nombre de mois entiers écoulés entre deux dates (d2 ≥ d1), arrondi à l'inférieur. */
export function completedMonthsBetween(d1: string, d2: string): number {
  if (cmp(d2, d1) <= 0) return 0;
  let n = 0;
  while (cmp(addMonths(d1, n + 1), d2) <= 0) n++;
  return n;
}

export function yearOf(d: string): number {
  return Number(d.slice(0, 4));
}
