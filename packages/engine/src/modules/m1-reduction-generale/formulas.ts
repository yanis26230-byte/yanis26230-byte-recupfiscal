/**
 * Formules de la réduction générale des cotisations patronales.
 * Fonctions pures, sans aucune valeur réglementaire en dur : tous les coefficients,
 * seuils et puissances sont passés en argument depuis les paramètres publiés.
 *
 * Notation : m = rémunération annuelle brute / SMIC annuel de référence (multiple du SMIC).
 */

import { roundTo } from '../../money.js';

export type Regime = 'rg_ancienne' | 'rgdu';

/** Régime applicable selon l'année (cahier des charges §6.4 M1). */
export function regimeForYear(year: number): Regime | null {
  if (year >= 2023 && year <= 2025) return 'rg_ancienne';
  if (year >= 2026) return 'rgdu';
  return null;
}

export interface RgParams {
  /** Coefficient maximal T (dépend de la taille de l'entreprise). */
  tmax: number;
  /** Seuil de sortie exprimé en multiple du SMIC (ex. 1,6). */
  exitThreshold: number;
  decimals: number;
}

/** Ancienne réduction générale : C = T / (S − 1) × (S × SMIC / RAB − 1), borné à [0, T]. */
export function rgCoefficient(m: number, p: RgParams): number {
  if (!(m > 0)) return 0;
  if (m >= p.exitThreshold) return 0;
  const raw = (p.tmax / (p.exitThreshold - 1)) * (p.exitThreshold / m - 1);
  return roundTo(Math.min(p.tmax, Math.max(0, raw)), p.decimals);
}

export interface RgduParams {
  tmin: number;
  tdelta: number;
  power: number;
  /** Seuil de sortie en multiple du SMIC (ex. 3). */
  exitThreshold: number;
  decimals: number;
}

/**
 * RGDU : C = Tmin + Tdelta × [ (S × SMIC / RAB − 1) / (S − 1) ]^P, nul au-delà de S SMIC.
 * Avec S = 3, (S − 1) = 2 : on retrouve la formule de référence
 * Tmin + Tdelta × [0,5 × (3 × SMIC / RAB − 1)]^P.
 * La base est bornée à [0, 1] (le coefficient ne dépasse jamais Tmin + Tdelta).
 */
export function rgduCoefficient(m: number, p: RgduParams): number {
  if (!(m > 0)) return 0;
  if (m >= p.exitThreshold) return 0;
  const base = Math.min(1, Math.max(0, (p.exitThreshold / m - 1) / (p.exitThreshold - 1)));
  return roundTo(p.tmin + p.tdelta * base ** p.power, p.decimals);
}

export type CoefficientFn = (m: number) => number;
