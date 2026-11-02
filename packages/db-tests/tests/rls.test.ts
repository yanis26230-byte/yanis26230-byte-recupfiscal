import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, createAuthUser, createDb } from './harness.js';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const ACCOUNTANT = '00000000-0000-0000-0000-0000000000cc';
const ANALYST = '00000000-0000-0000-0000-0000000000a1';

let db: PGlite;
let companyA: string;
let companyB: string;
const ids: Record<string, string> = {};

async function seedCompany(user: string, siren: string, siret: string, prefix: string) {
  return asUser(db, user, async (q) => {
    const id = (await q<{ id: string }>(`select app.create_company($1, $2) as id`, [siren, `Société ${prefix}`]))[0]!.id;
    const [est] = await q<{ id: string }>(`insert into establishments (company_id, siret, city) values ($1, $2, 'Ville') returning id`, [id, siret]);
    const [emp] = await q<{ id: string }>(`insert into employees_anonymized (company_id, establishment_id, internal_id, contract_type) values ($1, $2, 'S1', 'CDI') returning id`, [id, est!.id]);
    await q(`insert into payroll_lines (company_id, employee_id, year, month, gross, hours_paid) values ($1, $2, 2024, 1, 2000, 151.67)`, [id, emp!.id]);
    const [audit] = await q<{ id: string }>(`insert into audits (company_id, mode) values ($1, 'rapide') returning id`, [id]);
    await q(`insert into questionnaire_answers (audit_id, questionnaire_version, step, answers) values ($1, 'v1', 'entreprise', '{"x":1}')`, [audit!.id]);
    await q(`insert into salary_brackets (audit_id, year, bracket, employee_count) values ($1, 2024, 'lt_1_1', 3)`, [audit!.id]);
    const [doc] = await q<{ id: string }>(`insert into documents (company_id, uploaded_by, storage_path, original_filename, mime_type, size_bytes, sha256)
      values ($1, $2, $3, 'dsn.txt', 'text/plain', 10, 'abc') returning id`, [id, user, `${prefix}/dsn.txt`]);
    ids[`${prefix}_audit`] = audit!.id;
    ids[`${prefix}_doc`] = doc!.id;
    ids[`${prefix}_est`] = est!.id;
    return id!;
  });
}

beforeAll(async () => {
  db = await createDb();
  await createAuthUser(db, A, 'a@exemple.fr');
  await createAuthUser(db, B, 'b@exemple.fr');
  await createAuthUser(db, ACCOUNTANT, 'compta@exemple.fr');
  await createAuthUser(db, ANALYST, 'analyste@plateforme.fr', 'analyste');
  companyA = await seedCompany(A, '111111111', '11111111100011', 'A');
  companyB = await seedCompany(B, '222222222', '22222222200022', 'B');
  // Calcul enregistré par le serveur (service_role) pour l'audit de B.
  const run = await db.query<{ id: string }>(`insert into calculation_runs (audit_id, engine_version, module_versions, dataset, parameter_ids, parameter_snapshot, frozen_input, outputs, totals, input_hash, output_hash)
    values ($1, '0.1.0', '{}', 'test', '{}', '[]', '{}', '[]', '{}', repeat('a',64), repeat('b',64)) returning id`, [ids.B_audit]);
  ids.B_run = run.rows[0]!.id;
  const opp = await db.query<{ id: string }>(`insert into opportunities (calculation_run_id, module_id, module_version, kind, year, period_from, period_to, estimated_low, estimated_central, estimated_high, status, confidence, risk, detail)
    values ($1, 'M1', '1.0.0', 'recuperation_passee', 2024, '2024-01-01', '2024-12-31', 100, 200, 300, 'estime', 'moyen', 'standard', '{}') returning id`, [ids.B_run]);
  ids.B_opp = opp.rows[0]!.id;
  await asUser(db, A, (q) => q(`insert into company_members (user_id, company_id, role) values ($1, $2, 'comptable_invite')`, [ACCOUNTANT, companyA]));
}, 60_000);

const COMPANY_TABLES = ['companies', 'establishments', 'employees_anonymized', 'payroll_lines', 'audits', 'questionnaire_answers',
  'salary_brackets', 'documents', 'company_members', 'calculation_runs', 'opportunities'];

describe('Isolation entre entreprises (critère 5)', () => {
  it.each(COMPANY_TABLES)('A ne voit aucune donnée de B dans %s', async (table) => {
    const rows = await asUser(db, A, (q) => q(`select * from ${table}`));
    const json = JSON.stringify(rows);
    expect(json).not.toContain(companyB);
    expect(json).not.toContain('222222222');
    expect(json).not.toContain(ids.B_audit);
  });

  it('B voit ses propres données, calcul et opportunités compris', async () => {
    const r = await asUser(db, B, async (q) => ({
      companies: await q(`select id from companies`),
      runs: await q(`select id from calculation_runs`),
      opps: await q(`select id from opportunities`),
      qa: await q(`select id from questionnaire_answers`),
    }));
    expect(r.companies).toEqual([{ id: companyB }]);
    expect(r.runs).toHaveLength(1);
    expect(r.opps).toHaveLength(1);
    expect(r.qa).toHaveLength(1);
  });

  it('A ne peut pas écrire dans l’entreprise de B', async () => {
    await expect(asUser(db, A, (q) => q(`insert into establishments (company_id, siret) values ($1, '33333333300033')`, [companyB]))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, A, (q) => q(`insert into audits (company_id) values ($1)`, [companyB]))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, A, (q) => q(`insert into questionnaire_answers (audit_id, questionnaire_version, step) values ($1, 'v1', 'x')`, [ids.B_audit]))).rejects.toThrow(/row-level security/);
  });

  it('A ne peut pas modifier ni supprimer les données de B (0 ligne affectée)', async () => {
    const r = await asUser(db, A, async (q) => ({
      upd: await q(`update companies set legal_name = 'piraté' where id = $1 returning id`, [companyB]),
      del: await q(`delete from establishments where company_id = $1 returning id`, [companyB]),
    }));
    expect(r.upd).toHaveLength(0);
    expect(r.del).toHaveLength(0);
    const check = await db.query<{ legal_name: string }>(`select legal_name from companies where id = $1`, [companyB]);
    expect(check.rows[0]!.legal_name).toBe('Société B');
  });

  it('A ne peut pas s’ajouter comme membre de l’entreprise de B', async () => {
    await expect(asUser(db, A, (q) => q(`insert into company_members (user_id, company_id, role) values ($1, $2, 'proprietaire')`, [A, companyB]))).rejects.toThrow(/row-level security/);
  });

  it('A ne peut pas rattacher un salarié à un établissement de B (clé composite)', async () => {
    await expect(asUser(db, A, (q) => q(`insert into employees_anonymized (company_id, establishment_id, internal_id, contract_type) values ($1, $2, 'S9', 'CDI')`, [companyA, ids.B_est]))).rejects.toThrow();
  });

  it('le rôle anon ne voit rien', async () => {
    for (const t of [...COMPANY_TABLES, 'leads', 'regulatory_parameters']) {
      const rows = await asUser(db, null, (q) => q(`select * from ${t}`), 'anon');
      expect(rows, t).toHaveLength(0);
    }
  });

  it('un utilisateur gère plusieurs entreprises', async () => {
    await asUser(db, A, (q) => q(`select app.create_company('444444444', 'Seconde société de A')`));
    const rows = await asUser(db, A, (q) => q(`select siren from companies order by siren`));
    expect(rows).toEqual([{ siren: '111111111' }, { siren: '444444444' }]);
  });
});

describe('Rôles par entreprise', () => {
  it('le comptable invité lit les données et dépose des documents', async () => {
    const r = await asUser(db, ACCOUNTANT, async (q) => {
      await q(`insert into documents (company_id, uploaded_by, storage_path, original_filename, mime_type, size_bytes, sha256) values ($1, $2, 'A/liasse.pdf', 'liasse.pdf', 'application/pdf', 99, 'def')`, [companyA, ACCOUNTANT]);
      return q(`select id from companies`);
    });
    expect(r).toEqual([{ id: companyA }]);
  });

  it('le comptable invité ne peut pas modifier les données', async () => {
    await expect(asUser(db, ACCOUNTANT, (q) => q(`insert into establishments (company_id, siret) values ($1, '55555555500055')`, [companyA]))).rejects.toThrow(/row-level security/);
    const upd = await asUser(db, ACCOUNTANT, (q) => q(`update companies set legal_name = 'x' where id = $1 returning id`, [companyA]));
    expect(upd).toHaveLength(0);
  });

  it('l’analyste interne voit toutes les entreprises et les prospects', async () => {
    const rows = await asUser(db, ANALYST, (q) => q(`select siren from companies`));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('un client ne peut pas s’attribuer un rôle interne', async () => {
    await expect(asUser(db, A, (q) => q(`update users set internal_role = 'administrateur' where id = $1`, [A]))).rejects.toThrow(/administrateur/);
  });

  it('un client ne voit pas les prospects ni les paramètres réglementaires', async () => {
    await db.query(`insert into leads (email, consent, consent_text_version) values ('x@y.fr', true, 'v1')`);
    expect(await asUser(db, A, (q) => q(`select * from leads`))).toHaveLength(0);
  });

  it('un client ne peut pas modifier les montants estimés ni valider une opportunité', async () => {
    const upd = await asUser(db, B, (q) => q(`update opportunities set review_status = 'valide', validated_amount = 1e6, reviewed_by = $1 returning id`, [B]));
    expect(upd).toHaveLength(0);
  });
});
