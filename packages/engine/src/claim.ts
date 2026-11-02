import { addYears, cmp, monthEnd, pad2 } from './dates.js';
import type { ParameterResolver } from './parameters.js';
import type { MissingParameter } from './types.js';

export const CLAIM_DELAY_KEY = 'delai_reclamation_cotisations_annees';

/**
 * Hypothèse prudente : les cotisations d'un mois M sont réputées payées le 5 du mois M+1
 * (date d'exigibilité DSN la plus précoce). Retenir la date la plus précoce fait expirer
 * le délai le plus tôt, donc ne surestime jamais la période réclamable.
 */
export function assumedPaymentDate(year: number, month: number): string {
  const y = month === 12 ? year + 1 : year;
  const m = month === 12 ? 1 : month + 1;
  return `${y}-${pad2(m)}-05`;
}

export interface MonthClaimability {
  month: number;
  elapsed: boolean;
  claimable: boolean;
  paymentDate: string;
  deadline: string;
}

export type ClaimabilityResult =
  | { ok: true; delayYears: number; months: MonthClaimability[]; claimableMonths: number[] }
  | { ok: false; missing: MissingParameter };

/**
 * Détermine, mois par mois, si un trop-versé de cotisations est encore réclamable à la date
 * de référence. Le délai (en années) est un paramètre réglementaire publié, lu à la date
 * de référence. Sans paramètre publié : échec, jamais de délai par défaut.
 */
export function claimableMonths(
  resolver: ParameterResolver,
  year: number,
  asOfDate: string,
): ClaimabilityResult {
  const r = resolver.resolve(CLAIM_DELAY_KEY, asOfDate, asOfDate);
  if (!r.ok) return r;
  const delayYears = r.value;
  const months: MonthClaimability[] = [];
  for (let m = 1; m <= 12; m++) {
    const elapsed = cmp(monthEnd(year, m), asOfDate) < 0;
    const paymentDate = assumedPaymentDate(year, m);
    const deadline = addYears(paymentDate, delayYears);
    months.push({ month: m, elapsed, paymentDate, deadline, claimable: elapsed && cmp(asOfDate, deadline) < 0 });
  }
  return { ok: true, delayYears, months, claimableMonths: months.filter((m) => m.claimable).map((m) => m.month) };
}
