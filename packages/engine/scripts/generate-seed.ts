/**
 * Génère supabase/seed.sql à partir du registre des modules et de l'amorce des paramètres
 * officiels (source unique : packages/engine/src). Usage : pnpm --filter @recupfiscal/engine seed:generate
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULE_REGISTRY, OFFICIAL_PARAMETERS_SEED, REFERENCE_CASES } from '../src/index.js';

const lit = (v: unknown) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const lines: string[] = [
  '-- Fichier généré par packages/engine/scripts/generate-seed.ts — ne pas modifier à la main.',
  '-- Paramètres OFFICIELS : aucune valeur inventée (statut a_renseigner, ou brouillon pour les valeurs du cahier des charges).',
  '',
];
for (const m of MODULE_REGISTRY) {
  lines.push(`insert into public.modules (id, name, kind, current_version, enabled) values (${lit(m.id)}, ${lit(m.name)}, ${lit(m.kind)}, ${lit(m.version)}, true) on conflict (id) do update set current_version = excluded.current_version;`);
}
lines.push('');
for (const p of OFFICIAL_PARAMETERS_SEED) {
  lines.push(`insert into public.regulatory_parameters (key, label, value, unit, valid_from, valid_to, territory, module_id, source_url, version, status, dataset, note) values (${[
    p.key, p.label, p.value, p.unit, p.validFrom, p.validTo, p.territory, p.moduleId, p.sourceUrl, p.version, p.status, p.dataset, p.note ?? null,
  ].map(lit).join(', ')}) on conflict do nothing;`);
}
lines.push('');
lines.push('-- Cas de référence (jeu de paramètres de TEST, valeurs fictives) relancés par le back-office.');
for (const rc of REFERENCE_CASES) {
  lines.push(`insert into public.reference_test_cases (code, module_id, name, calculation, input, expected_output, dataset) values (${[
    rc.id, rc.moduleId, rc.name, rc.calculation].map(lit).join(', ')}, ${lit(JSON.stringify(rc.input))}::jsonb, ${lit(JSON.stringify(rc.expected))}::jsonb, 'test') on conflict (code) do update set input = excluded.input, expected_output = excluded.expected_output, calculation = excluded.calculation;`);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/seed.sql');
writeFileSync(out, lines.join('\n') + '\n');
console.log(`seed.sql : ${MODULE_REGISTRY.length} module(s), ${OFFICIAL_PARAMETERS_SEED.length} paramètre(s), ${REFERENCE_CASES.length} cas de référence`);
