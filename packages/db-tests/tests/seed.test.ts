import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './harness.js';

describe('seed.sql', () => {
  it('se charge et ne publie aucune valeur officielle', async () => {
    const db = await createDb();
    await db.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/seed.sql'), 'utf8'));
    const r = (await db.query<{ status: string; n: number }>(`select status::text, count(*)::int as n from regulatory_parameters group by 1 order by 1`)).rows;
    expect(r.map((x) => x.status)).toEqual(['a_renseigner', 'brouillon']);
    const published = (await db.query(`select 1 from regulatory_parameters where status = 'publie'`)).rows;
    expect(published).toHaveLength(0);
    const modules = (await db.query<{ id: string }>(`select id from modules order by id`)).rows.map((r) => r.id);
    expect(modules).toEqual(['M1_REDUCTION_GENERALE', 'M2_AIDES_EMBAUCHE', 'M3_TAUX_AT', 'M4_ZONAGES', 'M5_EPARGNE_SALARIALE']);
    const cases = (await db.query<{ n: number }>(`select count(distinct module_id)::int as n from reference_test_cases where dataset = 'test'`)).rows[0]!.n;
    expect(cases).toBe(5);
  }, 60_000);
});
