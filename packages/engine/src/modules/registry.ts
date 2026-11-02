import type { CalculationModule } from '../types.js';
import { m1ReductionGenerale } from './m1-reduction-generale/index.js';
import { m2AidesEmbauche } from './m2-aides-embauche/index.js';
import { m3TauxAt } from './m3-taux-at/index.js';
import { m4Zonages } from './m4-zonages/index.js';
import { m5EpargneSalariale } from './m5-epargne-salariale/index.js';

/**
 * Registre des modules. Ajouter un module = ajouter une entrée ici, sans toucher aux autres.
 * L'activation/désactivation par l'administrateur est appliquée en amont (table modules).
 */
export const MODULE_REGISTRY: readonly CalculationModule[] = [m1ReductionGenerale, m2AidesEmbauche, m3TauxAt, m4Zonages, m5EpargneSalariale];

export function enabledModules(enabledIds: readonly string[]): CalculationModule[] {
  return MODULE_REGISTRY.filter((m) => enabledIds.includes(m.id));
}
