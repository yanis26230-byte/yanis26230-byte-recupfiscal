/** Contrôle d'un numéro SIREN : 9 chiffres et clé de Luhn (exception connue : La Poste). */
export function normalizeSiren(input: string): string {
  return input.replace(/[\s.\-]/g, '');
}

export function isValidSiren(input: string): boolean {
  const s = normalizeSiren(input);
  if (!/^\d{9}$/.test(s)) return false;
  if (s === '356000000') return true; // La Poste : SIREN hors clé de Luhn
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(s[8 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export function looksLikeSiren(input: string): boolean {
  return /^\d{9}$/.test(normalizeSiren(input));
}

export function isValidSiret(input: string): boolean {
  return /^\d{14}$/.test(input.replace(/\s/g, ''));
}
