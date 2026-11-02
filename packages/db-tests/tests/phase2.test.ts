import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, createAuthUser, createDb } from './harness.js';

const ADMIN1 = '00000000-0000-0000-0000-0000000000d1';
const ADMIN2 = '00000000-0000-0000-0000-0000000000d2';
const ANALYST = '00000000-0000-0000-0000-0000000000a1';
const CLIENT = '00000000-0000-0000-0000-00000000000a';
let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  await createAuthUser(db, ADMIN1, 'a1@plateforme.fr', 'administrateur');
  await createAuthUser(db, ADMIN2, 'a2@plateforme.fr', 'administrateur');
  await createAuthUser(db, ANALYST, 'an@plateforme.fr', 'analyste');
  await createAuthUser(db, CLIENT, 'client@exemple.fr');
}, 60_000);

const newDataset = (admin: string, version = 1) => asUser(db, admin, async (q) => (await q<{ id: string }>(
  `insert into zoning_datasets (zone_type, valid_from, valid_to, source_url, source_label, version) values ('zrr', '2023-01-01', '2024-06-30', 'https://www.legifrance.gouv.fr', 'Arrêté de classement (à préciser)', $1) returning id`, [version]))[0]!.id);

describe('Zonages versionnés', () => {
  let ds: string;
  it('un administrateur crée un jeu sourcé et y importe des communes', async () => {
    ds = await newDataset(ADMIN1);
    await asUser(db, ADMIN1, (q) => q(`insert into zoning_entries (dataset_id, insee_code, valid_from) values ($1, '26362', '2023-01-01'), ($1, '2A004', '2023-01-01')`, [ds]));
    const r = (await db.query<{ author_id: string }>(`select author_id from zoning_datasets where id = $1`, [ds])).rows[0]!;
    expect(r.author_id).toBe(ADMIN1);
  });
  it('code commune invalide refusé', async () => {
    await expect(asUser(db, ADMIN1, (q) => q(`insert into zoning_entries (dataset_id, insee_code, valid_from) values ($1, 'ABCDE', '2023-01-01')`, [ds]))).rejects.toThrow(/check constraint/);
  });
  it('quatre yeux : l’auteur ne valide pas son propre jeu', async () => {
    await expect(asUser(db, ADMIN1, (q) => q(`update zoning_datasets set status = 'valide' where id = $1`, [ds]))).rejects.toThrow(/quatre yeux/);
  });
  it('validé puis publié par un second administrateur ; communes figées ensuite', async () => {
    await asUser(db, ADMIN2, (q) => q(`update zoning_datasets set status = 'valide' where id = $1`, [ds]));
    await expect(asUser(db, ADMIN1, (q) => q(`insert into zoning_entries (dataset_id, insee_code, valid_from) values ($1, '01001', '2023-01-01')`, [ds]))).rejects.toThrow(/non modifiables/);
    await expect(asUser(db, ADMIN1, (q) => q(`update zoning_datasets set source_url = 'https://autre' where id = $1`, [ds]))).rejects.toThrow(/nouvelle version/);
    await asUser(db, ADMIN2, (q) => q(`update zoning_datasets set status = 'publie' where id = $1`, [ds]));
  });
  it('la publication d’une nouvelle version archive l’ancienne', async () => {
    const v2 = await newDataset(ADMIN1, 2);
    await asUser(db, ADMIN2, (q) => q(`update zoning_datasets set status = 'valide' where id = $1`, [v2]));
    await asUser(db, ADMIN2, (q) => q(`update zoning_datasets set status = 'publie' where id = $1`, [v2]));
    const rows = (await db.query<{ version: number; status: string }>(`select version, status::text from zoning_datasets order by version`)).rows;
    expect(rows).toEqual([{ version: 1, status: 'archive' }, { version: 2, status: 'publie' }]);
  });
  it('une commune ne peut pas exister sans jeu de données sourcé', async () => {
    await expect(db.query(`insert into zoning_entries (insee_code, valid_from) values ('26362', '2023-01-01')`)).rejects.toThrow(/null/);
  });
  it('un client ne voit pas les zonages ; un analyste ne peut pas en créer', async () => {
    expect(await asUser(db, CLIENT, (q) => q(`select * from zoning_datasets`))).toHaveLength(0);
    await expect(newDataset(ANALYST)).rejects.toThrow(/row-level security/);
  });
});

describe('Dispositifs zonaux', () => {
  it('validation impossible sans source', async () => {
    const id = await asUser(db, ADMIN1, async (q) => (await q<{ id: string }>(
      `insert into zone_schemes (zone_type, code, name, description, valid_from, status) values ('zrr', 'EXO', 'Exonération (à renseigner)', '-', '2023-01-01', 'brouillon') returning id`))[0]!.id);
    await expect(asUser(db, ADMIN2, (q) => q(`update zone_schemes set status = 'valide' where id = $1`, [id]))).rejects.toThrow(/check constraint/);
    await asUser(db, ADMIN1, (q) => q(`update zone_schemes set source_url = 'https://www.urssaf.fr' where id = $1`, [id]));
    await asUser(db, ADMIN2, (q) => q(`update zone_schemes set status = 'valide' where id = $1`, [id]));
  });
});

describe('Opportunités phase 2', () => {
  let run: string;
  beforeAll(async () => {
    const company = await asUser(db, CLIENT, async (q) => (await q<{ id: string }>(`select app.create_company('123456789', 'Client') as id`))[0]!.id);
    const audit = (await db.query<{ id: string }>(`insert into audits (company_id) values ($1) returning id`, [company])).rows[0]!.id;
    run = (await db.query<{ id: string }>(`insert into calculation_runs (audit_id, engine_version, module_versions, dataset, parameter_ids, parameter_snapshot, frozen_input, outputs, totals, input_hash, output_hash, reference_ids)
      values ($1, '0.2.0', '{}', 'test', '{}', '[]', '{}', '[]', '{}', repeat('a',64), repeat('b',64), '{"zoningDatasets":["x"],"zoningEntries":[],"zoneSchemes":[]}') returning id`, [audit])).rows[0]!.id;
  });
  it('statut « a_confirmer » sans montant accepté, avec montant refusé', async () => {
    const ins = (amount: string) => db.query(`insert into opportunities (calculation_run_id, module_id, module_version, kind, year, period_from, period_to, estimated_low, estimated_central, estimated_high, status, confidence, risk, detail)
      values ($1, 'M4_ZONAGES', '1.0.0', 'recuperation_passee', 2023, '2023-01-01', '2024-12-31', ${amount}, ${amount}, ${amount}, 'a_confirmer', 'faible', 'standard', '{}')`, [run]);
    await ins('null');
    await expect(ins('100')).rejects.toThrow(/check constraint/);
  });
  it('le caractère « hors totaux » d’une simulation est immuable', async () => {
    const id = (await db.query<{ id: string }>(`insert into opportunities (calculation_run_id, module_id, module_version, kind, year, period_from, period_to, estimated_low, estimated_central, estimated_high, status, confidence, risk, detail, counts_in_totals)
      values ($1, 'M5_EPARGNE_SALARIALE', '1.0.0', 'economie_future', 2026, '2026-01-01', '2026-12-31', 10, 10, 10, 'estime', 'faible', 'standard', '{}', false) returning id`, [run])).rows[0]!.id;
    await expect(asUser(db, ANALYST, (q) => q(`update opportunities set counts_in_totals = true where id = $1`, [id]))).rejects.toThrow(/immuables/);
  });
  it('un taux AT « validé » exige une notification rattachée', async () => {
    const est = (await db.query<{ id: string; company_id: string }>(`insert into establishments (company_id, siret) select id, '12345678900011' from companies limit 1 returning id, company_id`)).rows[0]!;
    await expect(db.query(`insert into establishment_rates (company_id, establishment_id, year, notified_rate, applied_rate, notified_rate_validated) values ($1, $2, 2024, 0.021, 0.027, true)`, [est.company_id, est.id])).rejects.toThrow(/check constraint/);
  });
});

describe('Jeu de test (démonstration)', () => {
  it('le service peut publier des valeurs fictives du jeu test sans validateur', async () => {
    await db.query(`insert into regulatory_parameters (key, label, value, unit, valid_from, status, dataset, source_url, verified_at) values ('x_test', 'TEST', 1, '-', '2026-01-01', 'publie', 'test', 'https://exemple.invalid', '2026-01-01')`);
  });
  it('mais jamais dans le jeu officiel', async () => {
    await expect(db.query(`insert into regulatory_parameters (key, label, value, unit, valid_from, status, dataset, source_url, verified_at) values ('x_off', 'X', 1, '-', '2026-01-01', 'publie', 'officiel', 'https://exemple.invalid', '2026-01-01')`)).rejects.toThrow(/check constraint/);
  });
  it('et un administrateur reste soumis aux gardes, même pour le jeu test', async () => {
    await expect(asUser(db, ADMIN1, (q) => q(`insert into regulatory_parameters (key, label, value, unit, valid_from, status, dataset, author_id, source_url, verified_at) values ('x_adm', 'X', 1, '-', '2026-01-01', 'publie', 'test', $1, 'https://exemple.invalid', '2026-01-01')`, [ADMIN1]))).rejects.toThrow(/a_renseigner ou brouillon/);
  });
  it('un audit réel ne peut pas utiliser le jeu test', async () => {
    await expect(db.query(`insert into audits (anonymous_token_hash, parameter_dataset) values ('h', 'test')`)).rejects.toThrow(/check constraint/);
    await db.query(`insert into audits (anonymous_token_hash, parameter_dataset, is_demo) values ('h2', 'test', true)`);
  });
});
