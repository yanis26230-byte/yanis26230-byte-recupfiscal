import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, createAuthUser, createDb } from './harness.js';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const ADMIN = '00000000-0000-0000-0000-0000000000d1';
let db: PGlite;
let companyA: string;
let auditA: string;

beforeAll(async () => {
  db = await createDb();
  for (const [id, mail] of [[A, 'a@x.fr'], [B, 'b@x.fr'], [C, 'c@x.fr']] as const) await createAuthUser(db, id, mail);
  await createAuthUser(db, ADMIN, 'admin@p.fr', 'administrateur');
  companyA = await asUser(db, A, async (q) => (await q<{ id: string }>(`select app.create_company('552100554', 'A SARL') as id`))[0]!.id);
  auditA = (await db.query<{ id: string }>(`insert into audits (owner_user_id) values ($1) returning id`, [A])).rows[0]!.id;
  await db.query(`insert into questionnaire_answers (audit_id, questionnaire_version, step, answers) values ($1, 'rapide-v1', 'entreprise', '{"secret":1}')`, [auditA]);
}, 60_000);

describe('Audits personnels', () => {
  it('le propriétaire voit et modifie son audit ; un autre utilisateur ne voit rien', async () => {
    expect(await asUser(db, A, (q) => q(`select id from audits where id = $1`, [auditA]))).toHaveLength(1);
    expect(await asUser(db, A, (q) => q(`select step from questionnaire_answers where audit_id = $1`, [auditA]))).toHaveLength(1);
    expect(await asUser(db, B, (q) => q(`select id from audits where id = $1`, [auditA]))).toHaveLength(0);
    expect(await asUser(db, B, (q) => q(`select step from questionnaire_answers where audit_id = $1`, [auditA]))).toHaveLength(0);
    expect(await asUser(db, B, (q) => q(`update questionnaire_answers set answers = '{}' where audit_id = $1 returning id`, [auditA]))).toHaveLength(0);
  });
  it('impossible de créer un audit au nom d’un autre utilisateur ou dans une entreprise dont on n’est pas membre', async () => {
    await expect(asUser(db, B, (q) => q(`insert into audits (owner_user_id) values ($1)`, [A]))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, B, (q) => q(`insert into audits (owner_user_id, company_id) values ($1, $2)`, [B, companyA]))).rejects.toThrow(/row-level security/);
    await asUser(db, B, (q) => q(`insert into audits (owner_user_id) values ($1)`, [B]));
  });
  it('rattacher son audit à une entreprise exige un droit d’écriture sur cette entreprise', async () => {
    const r = await asUser(db, B, async (q) => {
      const [x] = await q<{ id: string }>(`insert into audits (owner_user_id) values ($1) returning id`, [B]);
      return q(`update audits set company_id = $2 where id = $1 returning id`, [x!.id, companyA]).catch((e: Error) => e.message);
    });
    expect(String(r)).toMatch(/row-level security/);
  });
  it('les réclamations d’audit ne sont pas lisibles par un tiers', async () => {
    await db.query(`insert into audit_claims (audit_id, email, expires_at) values ($1, 'a@x.fr', now() + interval '1 day')`, [auditA]);
    expect(await asUser(db, B, (q) => q(`select * from audit_claims`))).toHaveLength(0);
  });
});

describe('Membres et propriétaires', () => {
  it('une entreprise conserve toujours au moins un propriétaire', async () => {
    await expect(asUser(db, A, (q) => q(`delete from company_members where user_id = $1 and company_id = $2`, [A, companyA]))).rejects.toThrow(/au moins un propriétaire/);
    await expect(asUser(db, A, (q) => q(`update company_members set role = 'collaborateur' where user_id = $1`, [A]))).rejects.toThrow(/au moins un propriétaire/);
  });
  it('avec deux propriétaires, l’un peut partir', async () => {
    await asUser(db, A, (q) => q(`insert into company_members (user_id, company_id, role) values ($1, $2, 'proprietaire')`, [C, companyA]));
    await asUser(db, C, (q) => q(`delete from company_members where user_id = $1 and company_id = $2`, [C, companyA]));
  });
  it('un collaborateur ne peut ni inviter ni modifier les rôles', async () => {
    await asUser(db, A, (q) => q(`insert into company_members (user_id, company_id, role) values ($1, $2, 'collaborateur')`, [B, companyA]));
    await expect(asUser(db, B, (q) => q(`insert into invitations (company_id, email, role, token_hash, invited_by, expires_at) values ($1, 'z@x.fr', 'collaborateur', 'h1', $2, now() + interval '7 days')`, [companyA, B]))).rejects.toThrow(/row-level security/);
    expect(await asUser(db, B, (q) => q(`update company_members set role = 'proprietaire' where user_id = $1 returning user_id`, [B]))).toHaveLength(0);
  });
  it('une seule invitation en attente par e-mail ; jamais d’invitation comme propriétaire', async () => {
    const ins = (email: string, role = 'collaborateur', h = email) => asUser(db, A, (q) => q(`insert into invitations (company_id, email, role, token_hash, invited_by, expires_at) values ($1, $2, $3, $4, $5, now() + interval '7 days')`, [companyA, email, role, h, A]));
    await ins('n@x.fr');
    await expect(ins('N@x.fr', 'collaborateur', 'h2')).rejects.toThrow(/duplicate key/);
    await expect(ins('o@x.fr', 'proprietaire')).rejects.toThrow(/check constraint/);
  });
});

describe('Stockage privé des documents', () => {
  const put = (user: string, name: string) => asUser(db, user, (q) => q(`insert into storage.objects (bucket_id, name, owner) values ('documents', $1, $2)`, [name, user]));
  it('le seau est privé', async () => {
    const [b] = (await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'documents'`)).rows;
    expect(b!.public).toBe(false);
  });
  it('un membre dépose et lit dans le dossier de son entreprise', async () => {
    await put(A, `${companyA}/dsn-2024.txt`);
    expect(await asUser(db, A, (q) => q(`select name from storage.objects`))).toHaveLength(1);
  });
  it('un non-membre ne lit pas et ne dépose pas', async () => {
    expect(await asUser(db, C, (q) => q(`select name from storage.objects`))).toHaveLength(0);
    await expect(put(C, `${companyA}/intrus.pdf`)).rejects.toThrow(/row-level security/);
  });
  it('chemin hors dossier d’entreprise refusé ; pas de suppression par un client', async () => {
    await expect(put(A, `autre/fichier.pdf`)).rejects.toThrow(/row-level security/);
    expect(await asUser(db, A, (q) => q(`delete from storage.objects returning id`))).toHaveLength(0);
  });
  it('anon n’a aucun accès', async () => {
    expect(await asUser(db, null, (q) => q(`select * from storage.objects`), 'anon')).toHaveLength(0);
  });
});
