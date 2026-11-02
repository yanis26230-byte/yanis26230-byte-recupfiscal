/** Arrondi au centime (demi vers le haut), appliqué uniquement aux montants présentés. */
export function roundCents(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function roundTo(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((x + Number.EPSILON) * f) / f;
}

export function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Format d'affichage « 12 345 € » (espaces simples, sans décimales), stable entre environnements. */
export function formatEuro(x: number): string {
  const n = Math.round(x);
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '-' : ''}${s} €`;
}
