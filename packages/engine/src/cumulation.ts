import type { Opportunity } from './types.js';

/**
 * Règle de cumul explicite : autorise deux modules à produire des opportunités sur la même
 * assiette (préfixe d'assiette, ex. « cotisations_patronales_ssm »). Sans règle, le moteur
 * refuse d'additionner ces opportunités.
 */
export interface CumulationRule {
  id: string;
  assiettePrefix: string;
  moduleIds: [string, string];
  description: string;
  sourceUrl: string;
}

export interface CumulationConflict {
  assiette: string;
  /** Assiettes exactes des deux opportunités en conflit. */
  assiettes: string[];
  moduleIds: string[];
  message: string;
}

function ruleAllows(rules: readonly CumulationRule[], assiette: string, a: string, b: string): boolean {
  return rules.some(
    (r) =>
      assiette.startsWith(r.assiettePrefix) &&
      ((r.moduleIds[0] === a && r.moduleIds[1] === b) || (r.moduleIds[0] === b && r.moduleIds[1] === a)),
  );
}

/** Deux assiettes se chevauchent si elles sont égales ou si l'une contient l'autre. */
export function assiettesOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`);
}

/**
 * Détecte les opportunités chiffrées de modules différents sur des assiettes qui se
 * chevauchent, sans règle de cumul. Les opportunités en conflit sont exclues des totaux.
 */
export function detectCumulationConflicts(
  opportunities: readonly Opportunity[],
  rules: readonly CumulationRule[],
): CumulationConflict[] {
  const items = opportunities
    .filter((o) => o.status === 'estime' && o.countsInTotals)
    .flatMap((o) => o.assiettes.map((a) => ({ moduleId: o.moduleId, assiette: a })));
  const conflicts: CumulationConflict[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const x = items[i]!;
      const y = items[j]!;
      if (x.moduleId === y.moduleId || !assiettesOverlap(x.assiette, y.assiette)) continue;
      // L'assiette la plus large est retenue pour la règle (préfixe commun).
      const assiette = x.assiette.length <= y.assiette.length ? x.assiette : y.assiette;
      const [m1, m2] = [x.moduleId, y.moduleId].sort() as [string, string];
      if (ruleAllows(rules, assiette, m1, m2)) continue;
      const key = `${m1}|${m2}|${x.assiette}|${y.assiette}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({
        assiette,
        assiettes: [x.assiette, y.assiette],
        moduleIds: [m1, m2],
        message: `Les modules ${m1} et ${m2} portent sur la même assiette « ${assiette} » sans règle de cumul : montants non additionnés, à arbitrer par un analyste.`,
      });
    }
  }
  return conflicts;
}
