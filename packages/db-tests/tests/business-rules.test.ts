import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, createAuthUser, createDb } from './harness.js';

const ADMIN1 = '00000000-0000-0000-0000-0000000000d1';
const ADMIN2 = '00000000-0000-0000-0000-0000000000d2';
const ANALYST = '00000000-0000-0000-0000-0000000000a1';
const OWNER = '00000000-0000-0000-0000-00000000000a';

let db: PGlite;
let companyId: string;
let caseId: string;
let proofDoc: string;

beforeAll(async () => {
  db = await createDb();
  await createAuthUser(db, ADMIN1, 'admin1@plateforme.fr', 'administrateur');
  await createAuthUser(db, ADMIN2, 'admin2@plateforme.fr', 'administrateur');
  await createAuthUser(db, ANALYST, 'analyste@plateforme.fr', 'analyste');
  await createAuthUser(db, OWNER, 'owner@exemple.fr');
  await db.query(`insert into modules (id, name, kind, current_version, enabled) values ('M1_REDUCTION_GENERALE', 'Réduction générale', 'retroactif', '1.0.0', true)`);
  companyId = await asUser(db, OWNER, async (q) => (await q<{ id: string }>(`select app.create_company('123456789', 'Client') as id`))[0]!.id);
  caseId = await asUser(db, OWNER, async (q) => (await q<{ id: string }>(`insert into cases (company_id) values ($1) returning id`, [companyId]))[0]!.id);
  proofDoc = (await db.query<{ id: string }>(`insert into documents (company_id, storage_path, original_filename, mime_type, size_bytes, sha256, document_type)
    values ($1, 'c/preuve.pdf', 'preuve.pdf', 'application/pdf', 100, 'x', 'justificatif_remboursement') returning id`, [companyId])).rows[0]!.id;
}, 60_000);

async function draftParam(author: string, value = 12.4, validFrom = '2024-01-01', version = 1) {
  return asUser(db, author, async (q) => (await q<{ id: string }>(
    `insert into regulatory_parameters (key, label, value, unit, valid_from, valid_to, status, author_id, source_url, verified_at, version)
     values ('smic_horaire', 'SMIC horaire', $1, 'EUR/h', $2, '2024-12-31', 'brouillon', $3, 'https://www.urssaf.fr', '2026-11-01', $4) returning id`,
    [value, validFrom, author, version]))[0]!.id);
}

describe('Paramètres réglementaires', () => {
  it('l’auteur ne peut pas valider son propre paramètre (quatre yeux)', async () => {
    const id = await draftParam(ADMIN1);
    await expect(asUser(db, ADMIN1, (q) => q(`update regulatory_parameters set status = 'valide' where id = $1`, [id]))).rejects.toThrow(/quatre yeux/);
  });

  it('un second administrateur valide puis publie', async () => {
    const id = await draftParam(ADMIN1, 12.4, '2024-01-01', 2);
    await asUser(db, ADMIN2, (q) => q(`update regulatory_parameters set status = 'valide' where id = $1`, [id]));
    await asUser(db, ADMIN2, (q) => q(`update regulatory_parameters set status = 'publie' where id = $1`, [id]));
    const r = await db.query<{ status: string; validator_id: string; published_at: string }>(`select status, validator_id, published_at from regulatory_parameters where id = $1`, [id]);
    expect(r.rows[0]).toMatchObject({ status: 'publie', validator_id: ADMIN2 });
    expect(r.rows[0]!.published_at).not.toBeNull();
  });

  it('un paramètre validé ne peut plus être modifié (nouvelle version obligatoire)', async () => {
    const id = (await db.query<{ id: string }>(`select id from regulatory_parameters where status = 'publie' limit 1`)).rows[0]!.id;
    await expect(asUser(db, ADMIN2, (q) => q(`update regulatory_parameters set value = 99 where id = $1`, [id]))).rejects.toThrow(/nouvelle version/);
  });

  it('publier une nouvelle version archive l’ancienne', async () => {
    const id3 = await draftParam(ADMIN1, 12.5, '2024-01-01', 3);
    await asUser(db, ADMIN2, (q) => q(`update regulatory_parameters set status = 'valide' where id = $1`, [id3]));
    await asUser(db, ADMIN2, (q) => q(`update regulatory_parameters set status = 'publie' where id = $1`, [id3]));
    const rows = (await db.query<{ version: number; status: string }>(`select version, status from regulatory_parameters where key = 'smic_horaire' and status in ('publie','archive') order by version`)).rows;
    expect(rows).toEqual([{ version: 2, status: 'archive' }, { version: 3, status: 'publie' }]);
  });

  it('transition directe brouillon → publié interdite', async () => {
    const id = await draftParam(ADMIN1, 12.6, '2024-01-01', 4);
    await expect(asUser(db, ADMIN2, (q) => q(`update regulatory_parameters set status = 'publie' where id = $1`, [id]))).rejects.toThrow(/Transition/);
  });

  it('suppression interdite ; un analyste ne peut pas créer de paramètre', async () => {
    const id = await draftParam(ADMIN1, 12.7, '2024-01-01', 5);
    // Pas de politique DELETE : 0 ligne visible pour suppression…
    expect(await asUser(db, ADMIN1, (q) => q(`delete from regulatory_parameters where id = $1 returning id`, [id]))).toHaveLength(0);
    // …et même le service_role (contourne la RLS) est bloqué par le trigger.
    await expect(asUser(db, null, (q) => q(`delete from regulatory_parameters where id = $1`, [id]), 'service_role')).rejects.toThrow(/Suppression interdite/);
    await expect(draftParam(ANALYST, 1, '2025-01-01')).rejects.toThrow(/row-level security/);
  });

  it('chaque modification est journalisée', async () => {
    const n = (await db.query<{ n: number }>(`select count(*)::int as n from audit_logs where table_name = 'regulatory_parameters'`)).rows[0]!.n;
    expect(n).toBeGreaterThan(5);
  });
});

describe('Remboursements et commissions', () => {
  it('un analyste ne peut pas enregistrer de remboursement', async () => {
    await expect(asUser(db, ANALYST, (q) => q(`insert into recoveries (company_id, case_id, amount_reimbursed, received_on, proof_document_id, recorded_by) values ($1, $2, 1000, '2027-01-10', $3, $4)`, [companyId, caseId, proofDoc, ANALYST]))).rejects.toThrow();
  });

  it('un remboursement sans justificatif est refusé', async () => {
    await expect(asUser(db, ADMIN1, (q) => q(`insert into recoveries (company_id, case_id, amount_reimbursed, received_on, recorded_by) values ($1, $2, 1000, '2027-01-10', $3)`, [companyId, caseId, ADMIN1]))).rejects.toThrow(/null/);
  });

  it('l’administrateur enregistre un remboursement réel : commission de 25 % calculée automatiquement', async () => {
    await asUser(db, ADMIN1, (q) => q(`insert into recoveries (company_id, case_id, amount_reimbursed, received_on, proof_document_id, recorded_by) values ($1, $2, 3249.86, '2027-01-10', $3, $4)`, [companyId, caseId, proofDoc, ADMIN1]));
    const c = (await db.query<{ rate: string; amount: string }>(`select rate, amount from commissions`)).rows;
    expect(c).toEqual([{ rate: '0.2500', amount: '812.47' }]);
    const visible = await asUser(db, OWNER, (q) => q(`select amount from commissions`));
    expect(visible).toHaveLength(1);
  });

  it('une commission ne peut pas être créée sans remboursement, ni modifiée', async () => {
    await expect(asUser(db, ADMIN1, (q) => q(`insert into commissions (company_id, recovery_id, rate, amount) select $1, id, 0.25, 1 from recoveries limit 1`, [companyId]))).rejects.toThrow();
    await expect(asUser(db, ADMIN1, (q) => q(`update commissions set amount = 1`))).rejects.toThrow(/immuable/);
  });
});

describe('Dossiers, mandats, calculs', () => {
  it('chaque changement de statut de dossier crée un événement horodaté', async () => {
    await asUser(db, ANALYST, (q) => q(`update cases set status = 'en_analyse' where id = $1`, [caseId]));
    const ev = await asUser(db, OWNER, (q) => q<{ from_status: string | null; to_status: string }>(`select from_status, to_status from case_events order by created_at, to_status`));
    expect(ev).toEqual(expect.arrayContaining([{ from_status: null, to_status: 'nouveau' }, { from_status: 'nouveau', to_status: 'en_analyse' }]));
  });

  it('le client ne change pas lui-même le statut du dossier', async () => {
    const r = await asUser(db, OWNER, (q) => q(`update cases set status = 'rembourse' where id = $1 returning id`, [caseId]));
    expect(r).toHaveLength(0);
  });

  it('un mandat ne peut pas être « signé » sans trace du prestataire de signature', async () => {
    await expect(asUser(db, OWNER, (q) => q(`insert into mandates (company_id, case_id, commission_rate, terms_version, provider, status) values ($1, $2, 0.25, 'v1', 'yousign', 'signe')`, [companyId, caseId]))).rejects.toThrow(/check constraint/);
  });

  it('un calcul enregistré est immuable et une opportunité « estime » porte un montant', async () => {
    const audit = (await db.query<{ id: string }>(`insert into audits (company_id) values ($1) returning id`, [companyId])).rows[0]!.id;
    const run = (await db.query<{ id: string }>(`insert into calculation_runs (audit_id, engine_version, module_versions, dataset, parameter_ids, parameter_snapshot, frozen_input, outputs, totals, input_hash, output_hash)
      values ($1, '0.1.0', '{}', 'test', '{}', '[]', '{}', '[]', '{}', repeat('a',64), repeat('b',64)) returning id`, [audit])).rows[0]!.id;
    await expect(db.query(`update calculation_runs set totals = '{"x":1}' where id = $1`, [run])).rejects.toThrow(/ajout seul/);
    await expect(db.query(`insert into opportunities (calculation_run_id, module_id, module_version, kind, year, period_from, period_to, status, confidence, risk, detail)
      values ($1, 'M1', '1', 'recuperation_passee', 2024, '2024-01-01', '2024-12-31', 'estime', 'moyen', 'standard', '{}')`, [run])).rejects.toThrow(/check constraint/);
    const opp = (await db.query<{ id: string }>(`insert into opportunities (calculation_run_id, module_id, module_version, kind, year, period_from, period_to, estimated_low, estimated_central, estimated_high, status, confidence, risk, detail)
      values ($1, 'M1', '1', 'recuperation_passee', 2024, '2024-01-01', '2024-12-31', 1, 2, 3, 'estime', 'moyen', 'standard', '{}') returning id`, [run])).rows[0]!.id;
    await expect(asUser(db, ANALYST, (q) => q(`update opportunities set estimated_central = 2.5 where id = $1`, [opp]))).rejects.toThrow(/immuables/);
    // L'analyste valide : montant validé distinct de l'estimation.
    await asUser(db, ANALYST, (q) => q(`update opportunities set review_status = 'valide', validated_amount = 2, reviewed_by = $2, reviewed_at = now() where id = $1`, [opp, ANALYST]));
  });

  it('le journal d’audit est en ajout seul', async () => {
    await expect(db.query(`delete from audit_logs`)).rejects.toThrow(/ajout seul/);
  });
});
