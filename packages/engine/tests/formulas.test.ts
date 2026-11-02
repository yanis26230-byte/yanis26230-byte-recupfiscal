import { describe, expect, it } from 'vitest';
import { regimeForYear, rgCoefficient, rgduCoefficient } from '../src/index.js';

const RG = { tmax: 0.32, exitThreshold: 1.6, decimals: 4 };
const RGDU = { tmin: 0.02, tdelta: 0.38, power: 1.75, exitThreshold: 3, decimals: 4 };

describe('Ancienne réduction générale – coefficient', () => {
  it('vaut T au niveau du SMIC et en dessous (plafonné)', () => {
    expect(rgCoefficient(1, RG)).toBe(0.32);
    expect(rgCoefficient(0.5, RG)).toBe(0.32);
  });
  it('cas de référence à 1,3 SMIC : 0,32/0,6 × (1,6/1,3 − 1) = 0,1231', () => {
    expect(rgCoefficient(1.3, RG)).toBe(0.1231);
  });
  it('cas de référence à 1,2 et 1,15 SMIC', () => {
    expect(rgCoefficient(1.2, RG)).toBe(0.1778);
    expect(rgCoefficient(1.15, RG)).toBe(0.2087);
  });
  it('s’annule au seuil de sortie et au-delà', () => {
    expect(rgCoefficient(1.6, RG)).toBe(0);
    expect(rgCoefficient(2.5, RG)).toBe(0);
    expect(rgCoefficient(1.59, RG)).toBe(0.0034);
  });
  it('est décroissant', () => {
    let prev = Infinity;
    for (let m = 1; m < 1.6; m += 0.01) { const c = rgCoefficient(m, RG); expect(c).toBeLessThanOrEqual(prev); prev = c; }
  });
  it('rémunération nulle ou invalide : 0', () => {
    expect(rgCoefficient(0, RG)).toBe(0);
    expect(rgCoefficient(Number.NaN, RG)).toBe(0);
  });
});

describe('RGDU – coefficient', () => {
  it('vaut Tmin + Tdelta au SMIC', () => {
    expect(rgduCoefficient(1, RGDU)).toBe(0.4);
    // Valeurs du cahier des charges (brouillon) : 0,0200 + 0,3781
    expect(rgduCoefficient(1, { ...RGDU, tdelta: 0.3781 })).toBe(0.3981);
  });
  it('cas de référence : 1,5 SMIC → 0,02 + 0,38 × 0,5^1,75 = 0,1330', () => {
    expect(rgduCoefficient(1.5, RGDU)).toBe(0.133);
  });
  it('cas de référence : 1,8 / 2 / 2,6 SMIC', () => {
    expect(rgduCoefficient(1.8, RGDU)).toBe(0.0756);
    expect(rgduCoefficient(2, RGDU)).toBe(0.0536);
    expect(rgduCoefficient(2.6, RGDU)).toBe(0.0243);
  });
  it('sortie à 3 SMIC, Tmin juste en dessous', () => {
    expect(rgduCoefficient(3, RGDU)).toBe(0);
    expect(rgduCoefficient(3.5, RGDU)).toBe(0);
    expect(rgduCoefficient(2.9999, RGDU)).toBe(0.02);
  });
  it('ne dépasse jamais Tmin + Tdelta', () => {
    expect(rgduCoefficient(0.4, RGDU)).toBe(0.4);
  });
});

describe('Régime par année', () => {
  it('ancienne RG 2023-2025, RGDU à partir de 2026, rien avant 2023', () => {
    expect(regimeForYear(2022)).toBeNull();
    expect(regimeForYear(2023)).toBe('rg_ancienne');
    expect(regimeForYear(2025)).toBe('rg_ancienne');
    expect(regimeForYear(2026)).toBe('rgdu');
  });
});
