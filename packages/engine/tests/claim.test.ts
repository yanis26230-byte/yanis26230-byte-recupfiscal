import { describe, expect, it } from 'vitest';
import { assumedPaymentDate, claimableMonths, ParameterResolver, CLAIM_DELAY_KEY, addYears } from '../src/index.js';
import { param } from './helpers.js';

const resolver = () => new ParameterResolver([param({ id: 'd', key: CLAIM_DELAY_KEY, value: 3, validFrom: '2020-01-01' })], { dataset: 'test' });

describe('Délai de réclamation', () => {
  it('date de paiement réputée : le 5 du mois suivant', () => {
    expect(assumedPaymentDate(2023, 10)).toBe('2023-11-05');
    expect(assumedPaymentDate(2023, 12)).toBe('2024-01-05');
  });
  it('au 2 novembre 2026, seuls octobre à décembre 2023 restent réclamables', () => {
    const r = claimableMonths(resolver(), 2023, '2026-11-02');
    expect(r.ok && r.claimableMonths).toEqual([10, 11, 12]);
  });
  it('le jour de l’échéance, le mois n’est plus réclamable', () => {
    const r = claimableMonths(resolver(), 2023, '2026-11-05');
    expect(r.ok && r.claimableMonths).toEqual([11, 12]);
  });
  it('année en cours : seuls les mois écoulés comptent', () => {
    const r = claimableMonths(resolver(), 2026, '2026-11-02');
    expect(r.ok && r.claimableMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it('sans délai publié : échec, jamais de délai par défaut', () => {
    const r = claimableMonths(new ParameterResolver([], { dataset: 'test' }), 2024, '2026-11-02');
    expect(r.ok).toBe(false);
  });
  it('addYears gère le 29 février', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
  });
});
