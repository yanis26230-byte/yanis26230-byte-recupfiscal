import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  indicativeCommission, MODULE_REGISTRY, runCalculation,
  type CalculationRunRecord, type Opportunity, type ParameterDataset, type ReferenceData, type RegulatoryParameter,
} from '@recupfiscal/engine';
import { z } from 'zod';
import type { Database, Queryable } from './db/database';
import {
  CONSENT_TEXT_VERSION, QUESTIONNAIRE_VERSION, STEPS, defaultAnswers, stepSchemas, submissionIssues,
  type Answers, type AuditMeta, type CompanyAnswers, type EstablishmentAnswers, type Issue, type StepAnswers,
} from './questionnaire';
import type { StepId } from './sectors';
import { toEngineInput } from './to-engine-input';

/**
 * Service d'audit du mode rapide (côté serveur uniquement).
 * Sécurité : un audit anonyme n'est JAMAIS rattaché à une ligne `companies` (un visiteur pourrait
 * saisir le SIREN d'une entreprise cliente) ; l'entreprise est conservée dans les réponses et ne
 * sera rattachée qu'après authentification et vérification (phase 4). L'accès se fait par un jeton
 * aléatoire de 256 bits, conservé haché en base et en cookie httpOnly côté navigateur.
 */

const META_STEP = '_meta';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class AccessDenied extends Error {
  constructor() { super('Accès refusé à cet audit'); }
}
export class ValidationError extends Error {
  constructor(message: string, readonly issues: Issue[] = []) { super(message); }
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

async function upsertStep(db: Queryable, auditId: string, step: string, answers: unknown, status: 'brouillon' | 'complete' = 'brouillon') {
  await db.query(
    `insert into public.questionnaire_answers (audit_id, questionnaire_version, step, answers, status) values ($1, $2, $3, $4::jsonb, $5)
     on conflict (audit_id, questionnaire_version, step) do update set answers = excluded.answers, status = excluded.status`,
    [auditId, QUESTIONNAIRE_VERSION, step, JSON.stringify(answers), status],
  );
}

export interface CreateAuditInput {
  company: CompanyAnswers;
  establishments: EstablishmentAnswers[];
  today: string;
  /** Utilisateur connecté : l'audit lui est rattaché (et à son entreprise s'il peut y écrire). */
  ownerUserId?: string | null;
}

/** Identifiants d'accès à un audit : jeton anonyme (cookie) et/ou utilisateur connecté. */
export interface AuditAccess { token?: string; userId?: string | null }

export async function createAudit(db: Database, input: CreateAuditInput): Promise<{ auditId: string; token: string }> {
  const company = stepSchemas.entreprise.shape.company.parse(input.company);
  const establishments = z.array(stepSchemas.entreprise.shape.establishments.element).min(1).max(50).parse(input.establishments);
  const { quickModeYears } = await import('./questionnaire');
  const meta: AuditMeta = { years: quickModeYears(input.today), fixedAsOfDate: null, isDemo: false };
  let companyId: string | null = null;
  if (input.ownerUserId) {
    const [m] = await db.asUser(input.ownerUserId, (q) => q.query<{ id: string }>(
      `select c.id::text from public.companies c join public.company_members m on m.company_id = c.id and m.user_id = auth.uid()
        where c.siren = $1 and m.role in ('proprietaire', 'collaborateur')`, [company.siren]));
    companyId = m?.id ?? null;
  }
  return createWithAnswers(db, meta, 'officiel', { entreprise: { company, establishments, headcountByYear: Object.fromEntries(meta.years.map((y) => [String(y), null])) } },
    { ownerUserId: input.ownerUserId ?? null, companyId });
}

/** Audit de démonstration : Boulangerie Démo, jeu de paramètres « test » (valeurs fictives). */
export async function createDemoAudit(db: Database, ownerUserId: string | null = null): Promise<{ auditId: string; token: string }> {
  const { demoAnswers } = await import('./demo');
  const { answers, meta } = demoAnswers();
  return createWithAnswers(db, meta, 'test', answers, { ownerUserId, companyId: null });
}

async function createWithAnswers(db: Database, meta: AuditMeta, dataset: ParameterDataset, answers: Answers, holder: { ownerUserId: string | null; companyId: string | null }) {
  const token = newToken();
  return db.transaction(async (tx) => {
    const [audit] = await tx.query<{ id: string }>(
      `insert into public.audits (mode, status, anonymous_token_hash, parameter_dataset, is_demo, owner_user_id, company_id) values ('rapide', 'en_cours', $1, $2, $3, $4, $5) returning id`,
      [sha256(token), dataset, meta.isDemo, holder.ownerUserId, holder.companyId],
    );
    await upsertStep(tx, audit!.id, META_STEP, meta);
    for (const [step, value] of Object.entries(answers)) await upsertStep(tx, audit!.id, step, value);
    return { auditId: audit!.id, token };
  });
}

export interface AuditRow {
  id: string; status: string; mode: 'rapide' | 'avance'; is_demo: boolean; parameter_dataset: ParameterDataset; lead_id: string | null; last_calculation_run_id: string | null;
  owner_user_id: string | null; company_id: string | null;
  /** Droit effectif : écriture (créateur anonyme, propriétaire, collaborateur) ou lecture seule. */
  access: 'write' | 'read';
  /** Accès par session (compte) : donne droit au détail des résultats. */
  viaAccount: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIT_COLUMNS = `id::text, status::text, mode::text, is_demo, parameter_dataset::text, lead_id::text, last_calculation_run_id::text, owner_user_id::text, company_id::text`;

export async function authorize(db: Queryable | Database, auditId: string, access: AuditAccess): Promise<AuditRow> {
  if (!UUID.test(auditId)) throw new AccessDenied();
  // 1. Compte connecté : la RLS décide de la visibilité et du droit d'écriture.
  if (access.userId && 'asUser' in db) {
    const r = await db.asUser(access.userId, async (q) => {
      const [row] = await q.query<Omit<AuditRow, 'access' | 'viaAccount'>>(`select ${AUDIT_COLUMNS} from public.audits where id = $1`, [auditId]);
      if (!row) return null;
      const [w] = await q.query<{ ok: boolean }>(`select app.can_write_audit($1) as ok`, [auditId]);
      return { ...row, access: w?.ok ? 'write' : 'read', viaAccount: true } as AuditRow;
    });
    if (r) return r;
  }
  // 2. Jeton anonyme du navigateur qui a créé l'audit.
  if (!access.token) throw new AccessDenied();
  const [row] = await db.query<Omit<AuditRow, 'access' | 'viaAccount'> & { anonymous_token_hash: string | null }>(
    `select ${AUDIT_COLUMNS}, anonymous_token_hash from public.audits where id = $1`, [auditId]);
  if (!row?.anonymous_token_hash) throw new AccessDenied();
  const a = Buffer.from(row.anonymous_token_hash, 'hex');
  const b = Buffer.from(sha256(access.token), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AccessDenied();
  const { anonymous_token_hash: _h, ...audit } = row;
  return { ...audit, access: 'write', viaAccount: false };
}

export interface LoadedAudit { audit: AuditRow; meta: AuditMeta; answers: Answers; filled: StepAnswers }

export async function loadAudit(db: Queryable | Database, auditId: string, access: AuditAccess): Promise<LoadedAudit> {
  const audit = await authorize(db, auditId, access);
  const rows = await db.query<{ step: string; answers: unknown }>(
    `select step, answers from public.questionnaire_answers where audit_id = $1 and questionnaire_version = $2`, [auditId, QUESTIONNAIRE_VERSION]);
  const byStep = new Map(rows.map((r) => [r.step, typeof r.answers === 'string' ? JSON.parse(r.answers) : r.answers]));
  const meta = byStep.get(META_STEP) as AuditMeta;
  const answers: Answers = {};
  for (const s of STEPS) if (byStep.has(s.id)) (answers as Record<string, unknown>)[s.id] = byStep.get(s.id);
  const entreprise = answers.entreprise!;
  const filled = { entreprise } as StepAnswers;
  for (const s of STEPS) {
    if (s.id === 'entreprise') continue;
    (filled as Record<string, unknown>)[s.id] = answers[s.id] ?? defaultAnswers(s.id, meta.years, entreprise.establishments);
  }
  return { audit, meta, answers, filled };
}

/** Sauvegarde automatique d'une étape : validation de forme, jamais de champ serveur modifiable. */
export async function saveStep(db: Queryable | Database, auditId: string, access: AuditAccess, step: StepId, value: unknown): Promise<void> {
  const audit = await authorize(db, auditId, access);
  if (audit.access !== 'write') throw new ValidationError('Votre rôle dans cette entreprise ne permet pas de modifier l’audit.');
  if (audit.status === 'calcule') throw new ValidationError('Cet audit a déjà été calculé. Démarrez un nouvel audit pour modifier vos réponses.');
  const schema = stepSchemas[step];
  if (!schema) throw new ValidationError('Étape inconnue');
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError('Réponses invalides : ' + parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; '));
  if (step === 'entreprise') {
    // Le SIREN est fixé à la création de l'audit.
    const { answers } = await loadAudit(db, auditId, access);
    if ((parsed.data as StepAnswers['entreprise']).company.siren !== answers.entreprise?.company.siren) throw new ValidationError('Le SIREN ne peut pas être modifié.');
  }
  await upsertStep(db, auditId, step, parsed.data);
}

// ---------------------------------------------------------------------------
// Calcul
// ---------------------------------------------------------------------------

export async function loadParameters(db: Queryable, dataset: ParameterDataset): Promise<RegulatoryParameter[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select id::text, key, label, value::float8 as value, unit, to_char(valid_from, 'YYYY-MM-DD') as valid_from, to_char(valid_to, 'YYYY-MM-DD') as valid_to,
            territory, module_id, source_url, to_char(verified_at, 'YYYY-MM-DD') as verified_at, version, status::text, dataset::text, author_id::text, validator_id::text, note
       from public.regulatory_parameters where dataset = $1`, [dataset]);
  return rows.map((r) => ({
    id: r.id as string, key: r.key as string, label: r.label as string, value: r.value === null ? null : Number(r.value), unit: r.unit as string,
    validFrom: r.valid_from as string, validTo: (r.valid_to as string | null) ?? null, territory: r.territory as string, moduleId: (r.module_id as string | null) ?? null,
    sourceUrl: (r.source_url as string | null) ?? null, verifiedAt: (r.verified_at as string | null) ?? null, version: Number(r.version),
    status: r.status as RegulatoryParameter['status'], dataset: r.dataset as ParameterDataset, authorId: (r.author_id as string | null) ?? null,
    validatorId: (r.validator_id as string | null) ?? null, note: (r.note as string | null) ?? undefined,
  }));
}

export async function loadReferenceData(db: Queryable, dataset: ParameterDataset): Promise<ReferenceData> {
  const ds = await db.query<Record<string, unknown>>(
    `select id::text, zone_type, to_char(valid_from, 'YYYY-MM-DD') vf, to_char(valid_to, 'YYYY-MM-DD') vt, source_url, source_label, version, status::text, dataset::text
       from public.zoning_datasets where dataset = $1`, [dataset]);
  const ids = ds.map((d) => d.id as string);
  const entries = ids.length ? await db.query<Record<string, unknown>>(
    `select id::text, dataset_id::text, insee_code, commune_name, to_char(valid_from, 'YYYY-MM-DD') vf, to_char(valid_to, 'YYYY-MM-DD') vt
       from public.zoning_entries where dataset_id = any($1::uuid[])`, [ids]) : [];
  const schemes = await db.query<Record<string, unknown>>(
    `select id::text, zone_type, code, name, description, conditions, documents_to_provide, coalesce(source_url, '') source_url,
            to_char(valid_from, 'YYYY-MM-DD') vf, to_char(valid_to, 'YYYY-MM-DD') vt, version, status::text, dataset::text
       from public.zone_schemes where dataset = $1`, [dataset]);
  const arr = (x: unknown) => (typeof x === 'string' ? JSON.parse(x) : x) as string[];
  return {
    zoningDatasets: ds.map((d) => ({ id: d.id as string, zoneType: d.zone_type as string, validFrom: d.vf as string, validTo: (d.vt as string | null) ?? null,
      sourceUrl: d.source_url as string, sourceLabel: d.source_label as string, version: Number(d.version), status: d.status as never, dataset: d.dataset as never })),
    zoningEntries: entries.map((e) => ({ id: e.id as string, datasetId: e.dataset_id as string, inseeCode: e.insee_code as string,
      communeName: (e.commune_name as string | null) ?? null, validFrom: e.vf as string, validTo: (e.vt as string | null) ?? null })),
    zoneSchemes: schemes.map((s) => ({ id: s.id as string, zoneType: s.zone_type as string, code: s.code as string, name: s.name as string, description: s.description as string,
      conditions: arr(s.conditions), documentsToProvide: arr(s.documents_to_provide), sourceUrl: s.source_url as string, validFrom: s.vf as string,
      validTo: (s.vt as string | null) ?? null, version: Number(s.version), status: s.status as never, dataset: s.dataset as never })),
  };
}

export function checkSubmission(answers: Answers, meta: AuditMeta): { complete: StepAnswers | null; issues: Issue[] } {
  const issues = submissionIssues(answers, meta);
  const parsedSteps: Record<string, unknown> = {};
  for (const s of STEPS) {
    const v = answers[s.id] ?? (s.id === 'entreprise' ? undefined : defaultAnswers(s.id, meta.years, answers.entreprise?.establishments ?? []));
    const r = stepSchemas[s.id].safeParse(v);
    if (!r.success) issues.push({ step: s.id, message: `Étape « ${s.title} » incomplète ou invalide.`, blocking: true });
    else parsedSteps[s.id] = r.data;
  }
  return { complete: issues.some((i) => i.blocking) ? null : (parsedSteps as StepAnswers), issues };
}

export async function submitAudit(db: Database, auditId: string, access: AuditAccess, today: string): Promise<{ runId: string }> {
  const { audit, meta, answers } = await loadAudit(db, auditId, access);
  if (audit.status === 'calcule' && audit.last_calculation_run_id) return { runId: audit.last_calculation_run_id };
  if (audit.access !== 'write') throw new ValidationError('Votre rôle dans cette entreprise ne permet pas de lancer le calcul.');
  const { complete, issues } = checkSubmission(answers, meta);
  if (!complete) throw new ValidationError('Certaines réponses sont nécessaires avant le calcul.', issues);
  if (complete.recapitulatif.consentTextVersion !== CONSENT_TEXT_VERSION) throw new ValidationError('Version du consentement obsolète : veuillez le renouveler.');

  const asOfDate = meta.fixedAsOfDate ?? today;
  const input = toEngineInput(complete, meta, asOfDate);
  if (audit.mode === 'avance' && audit.company_id) await enrichAdvancedInput(db, audit.company_id, complete, input);
  const [parameters, referenceData, enabled] = await Promise.all([
    loadParameters(db, audit.parameter_dataset),
    loadReferenceData(db, audit.parameter_dataset),
    db.query<{ id: string }>(`select id from public.modules where enabled`),
  ]);
  const modules = MODULE_REGISTRY.filter((m) => enabled.some((e) => e.id === m.id));
  const run = runCalculation(input, { modules, parameters, dataset: audit.parameter_dataset, referenceData });
  return db.transaction(async (tx) => {
    const runId = await storeRun(tx, auditId, run);
    for (const year of meta.years) {
      for (const [bracket, v] of Object.entries(complete.salaires.years[String(year)]?.brackets ?? {})) {
        await tx.query(
          `insert into public.salary_brackets (audit_id, year, bracket, employee_count, part_time_share, part_time_average_ratio) values ($1, $2, $3, $4, $5, $6)
           on conflict (audit_id, year, bracket) do update set employee_count = excluded.employee_count, part_time_share = excluded.part_time_share, part_time_average_ratio = excluded.part_time_average_ratio`,
          [auditId, year, bracket, v.count, v.partTimeSharePct / 100, v.partTimeRatioPct == null ? null : v.partTimeRatioPct / 100]);
      }
    }
    for (const s of STEPS) await upsertStep(tx, auditId, s.id, (complete as Record<string, unknown>)[s.id], 'complete');
    await tx.query(`update public.audits set status = 'calcule', last_calculation_run_id = $2, submitted_at = now() where id = $1`, [auditId, runId]);
    return { runId };
  });
}

async function storeRun(tx: Queryable, auditId: string, run: CalculationRunRecord): Promise<string> {
  const [row] = await tx.query<{ id: string }>(
    `insert into public.calculation_runs (audit_id, engine_version, module_versions, dataset, parameter_ids, parameter_snapshot, frozen_input, outputs, totals,
       input_hash, output_hash, reference_ids, reference_snapshot)
     values ($1, $2, $3::jsonb, $4, $5::text[], $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12::jsonb, $13::jsonb) returning id`,
    [auditId, run.engineVersion, JSON.stringify(run.moduleVersions), run.dataset, run.parameterIds, JSON.stringify(run.parameterSnapshot), JSON.stringify(run.frozenInput),
      JSON.stringify({ opportunities: run.opportunities, cumulationConflicts: run.cumulationConflicts, missingParameters: run.missingParameters }),
      JSON.stringify(run.totals), run.inputHash, run.outputHash, JSON.stringify(run.referenceIds), JSON.stringify(run.referenceSnapshot)],
  );
  for (const o of run.opportunities) {
    await tx.query(
      `insert into public.opportunities (calculation_run_id, module_id, module_version, kind, year, period_from, period_to, estimated_low, estimated_central, estimated_high,
         status, confidence, risk, detail, counts_in_totals)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)`,
      [row!.id, o.moduleId, o.moduleVersion, o.kind, o.year, o.periodFrom, o.periodTo, o.amounts?.low ?? null, o.amounts?.central ?? null, o.amounts?.high ?? null,
        o.status, o.confidence, o.risk, JSON.stringify(o), o.countsInTotals],
    );
  }
  return row!.id;
}

// ---------------------------------------------------------------------------
// Résultats et prospects
// ---------------------------------------------------------------------------

export interface Results {
  runId: string;
  isDemo: boolean;
  dataset: ParameterDataset;
  asOfDate: string;
  totals: CalculationRunRecord['totals'];
  commission: ReturnType<typeof indicativeCommission>;
  opportunities: Opportunity[];
  counts: Record<'estime' | 'a_confirmer' | 'informations_manquantes' | 'parametre_manquant' | 'autres', number>;
  /** Années pour lesquelles au moins un paramètre officiel manque : calcul suspendu. */
  yearsAwaitingParameters: number[];
  leadCaptured: boolean;
  companyName: string;
  /** Détail par dispositif : réservé aux comptes ayant accès à l'audit, et à la démonstration. */
  detailAllowed: boolean;
  viaAccount: boolean;
  companyId: string | null;
  /** Propriétaire de l'entreprise de l'audit : peut engager la démarche de récupération. */
  canStartRecovery: boolean;
}

export async function getResults(db: Queryable | Database, auditId: string, access: AuditAccess): Promise<Results | null> {
  const { audit, answers } = await loadAudit(db, auditId, access);
  if (!audit.last_calculation_run_id) return null;
  const [run] = await db.query<{ id: string; totals: unknown; outputs: unknown; frozen_input: unknown }>(
    `select id::text, totals, outputs, frozen_input from public.calculation_runs where id = $1 and audit_id = $2`, [audit.last_calculation_run_id, auditId]);
  if (!run) return null;
  const j = <T>(x: unknown) => (typeof x === 'string' ? JSON.parse(x) : x) as T;
  const totals = j<CalculationRunRecord['totals']>(run.totals);
  const outputs = j<{ opportunities: Opportunity[] }>(run.outputs);
  const [settings] = await db.query<{ rate: number }>(`select commission_rate::float8 as rate from public.commercial_settings where id = 1`);
  const ops = outputs.opportunities;
  const count = (s: string) => ops.filter((o) => o.status === s).length;
  return {
    runId: run.id,
    isDemo: audit.is_demo,
    dataset: audit.parameter_dataset,
    asOfDate: j<{ asOfDate: string }>(run.frozen_input).asOfDate,
    totals,
    commission: indicativeCommission(totals.pastRecovery, settings?.rate ?? 0.25),
    opportunities: ops,
    counts: { estime: count('estime'), a_confirmer: count('a_confirmer'), informations_manquantes: count('informations_manquantes'), parametre_manquant: count('parametre_manquant'),
      autres: ops.length - count('estime') - count('a_confirmer') - count('informations_manquantes') - count('parametre_manquant') },
    yearsAwaitingParameters: [...new Set(ops.filter((o) => o.status === 'parametre_manquant').map((o) => o.year))].sort(),
    leadCaptured: audit.lead_id !== null,
    companyName: answers.entreprise?.company.legalName ?? '',
    detailAllowed: audit.viaAccount || audit.is_demo,
    viaAccount: audit.viaAccount,
    companyId: audit.company_id,
    canStartRecovery: false,
  };
}

export const leadSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(254),
  firstName: z.string().trim().min(1, 'Prénom obligatoire').max(80),
  phone: z.string().trim().max(30).regex(/^[+\d\s().-]*$/, 'Numéro de téléphone invalide').transform((v) => v || null),
  consent: z.literal(true, { errorMap: () => ({ message: 'Votre consentement est nécessaire' }) }),
  /** Champ piège invisible : rempli uniquement par des robots. */
  website: z.string().max(200).optional(),
});
export type LeadInput = z.input<typeof leadSchema>;
export const LEAD_CONSENT_TEXT_VERSION = 'prospect-v1';

/**
 * Enregistre le prospect dès la saisie de l'e-mail, qu'il crée ou non son compte ensuite, et
 * prépare la réclamation de l'audit : elle ne sera effective qu'après vérification de l'adresse
 * par le lien magique.
 */
export async function captureLead(db: Database, auditId: string, access: AuditAccess, input: LeadInput): Promise<{ leadId: string; email: string }> {
  const { audit, answers } = await loadAudit(db, auditId, access);
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(' ; '));
  const d = parsed.data;
  return db.transaction(async (tx) => {
    const [lead] = await tx.query<{ id: string }>(
      `insert into public.leads (email, first_name, phone, siren, consent, consent_text_version, source, status, honeypot_triggered)
       values ($1, $2, $3, $4, true, $5, $6, 'nouveau', $7) returning id`,
      [d.email, d.firstName, d.phone, answers.entreprise?.company.siren ?? null, LEAD_CONSENT_TEXT_VERSION, audit.is_demo ? 'demo' : 'audit_rapide', Boolean(d.website)],
    );
    await tx.query(`update public.audits set lead_id = $2 where id = $1`, [auditId, lead!.id]);
    if (!d.website) {
      await tx.query(`insert into public.audit_claims (audit_id, lead_id, email, expires_at) values ($1, $2, $3, now() + interval '30 days')`, [auditId, lead!.id, d.email]);
    }
    return { leadId: lead!.id, email: d.email };
  });
}

// ---------------------------------------------------------------------------
// Mode avancé
// ---------------------------------------------------------------------------

/**
 * Crée un audit avancé pour une entreprise (droit d'écriture requis), en reprenant les réponses
 * du dernier audit rapide de l'entreprise : aucune donnée du mode rapide n'est perdue.
 */
export async function createAdvancedAudit(db: Database, userId: string, companyId: string, today: string): Promise<{ auditId: string; token: string }> {
  const source = await db.asUser(userId, async (q) => {
    const [w] = await q.query<{ ok: boolean }>(`select app.can_write_company($1) as ok`, [companyId]);
    if (!w?.ok) throw new AccessDenied();
    const [a] = await q.query<{ id: string }>(`select id::text from public.audits where company_id = $1 and mode = 'rapide' and not is_demo order by (status = 'calcule') desc, created_at desc limit 1`, [companyId]);
    return a?.id ?? null;
  });
  let answers: Answers;
  let meta: AuditMeta;
  if (source) {
    const loaded = await loadAudit(db, source, { userId });
    answers = loaded.answers;
    meta = { ...loaded.meta, fixedAsOfDate: null, isDemo: false };
  } else {
    const [c] = await db.asUser(userId, (q) => q.query<{ siren: string; legal_name: string; legal_form: string | null; naf_code: string | null; sector: string | null }>(
      `select siren, legal_name, legal_form, naf_code, sector from public.companies where id = $1`, [companyId]));
    const est = await db.asUser(userId, (q) => q.query<{ id: string; siret: string | null; address: string | null; postal_code: string | null; city: string | null; insee_code: string | null }>(
      `select id::text, siret, address, postal_code, city, insee_code from public.establishments where company_id = $1`, [companyId]));
    const { quickModeYears } = await import('./questionnaire');
    meta = { years: quickModeYears(today), fixedAsOfDate: null, isDemo: false };
    answers = { entreprise: {
      company: { siren: c!.siren, legalName: c!.legal_name, legalForm: c!.legal_form, nafCode: c!.naf_code, sector: (c!.sector ?? 'autre') as never, createdOn: null, headcountRange: null, source: 'manuel' },
      establishments: est.map((e) => ({ key: e.id.slice(0, 36), siret: e.siret, address: e.address ?? '', postalCode: e.postal_code ?? '', city: e.city ?? '', inseeCode: e.insee_code, concerned: true })),
      headcountByYear: Object.fromEntries(meta.years.map((y) => [String(y), null])),
    } };
  }
  const token = newToken();
  return db.transaction(async (tx) => {
    const [audit] = await tx.query<{ id: string }>(
      `insert into public.audits (mode, status, anonymous_token_hash, parameter_dataset, owner_user_id, company_id, source_audit_id)
       values ('avance', 'en_cours', $1, 'officiel', $2, $3, $4) returning id`, [sha256(token), userId, companyId, source]);
    await upsertStep(tx, audit!.id, META_STEP, meta);
    for (const [step, value] of Object.entries(answers)) if (step !== 'recapitulatif') await upsertStep(tx, audit!.id, step, value);
    return { auditId: audit!.id, token };
  });
}

/** Ajoute aux entrées du moteur la paie validée, les lignes en attente (signalées) et les taux AT validés. */
async function enrichAdvancedInput(db: Queryable, companyId: string, answers: StepAnswers, input: import('@recupfiscal/engine').EngineInput) {
  const lines = await db.query<{ internal_id: string; establishment_siret: string | null; contract_type: string; year: number; month: number; gross: number; hours_paid: number; overtime_hours: number; reduction_applied: number }>(
    `select e.internal_id, s.siret as establishment_siret, e.contract_type, p.year, p.month, p.gross::float8, p.hours_paid::float8, p.overtime_hours::float8, p.reduction_applied::float8
       from public.payroll_lines p join public.employees_anonymized e on e.id = p.employee_id left join public.establishments s on s.id = e.establishment_id
      where p.company_id = $1 and p.validated`, [companyId]);
  const pending = await db.query<{ value: unknown }>(`select value from public.extracted_fields where company_id = $1 and field_key = 'ligne_paie' and status = 'a_valider'`, [companyId]);
  const employees = new Map<string, { contract: string; siret: string | null }>();
  lines.forEach((l) => employees.set(l.internal_id, { contract: l.contract_type, siret: l.establishment_siret }));
  const keyBySiret = new Map(answers.entreprise.establishments.filter((e) => e.siret).map((e) => [e.siret!, e.key]));
  input.mode = 'avance';
  input.advanced = {
    employees: [...employees.entries()].map(([id, e]) => ({ internalId: id, establishmentId: e.siret ? keyBySiret.get(e.siret) ?? null : null, contractType: e.contract, entryDate: null })),
    payrollLines: [
      ...lines.map((l) => ({ employeeInternalId: l.internal_id, year: l.year, month: l.month, gross: l.gross, hoursPaid: l.hours_paid, overtimeHours: l.overtime_hours, reductionApplied: l.reduction_applied, validated: true })),
      ...pending.map((p) => {
        const v = (typeof p.value === 'string' ? JSON.parse(p.value) : p.value) as { employeeRef: string; year: number; month: number; gross: number; hoursPaid: number; overtimeHours: number; reductionApplied: number };
        return { employeeInternalId: v.employeeRef, year: v.year, month: v.month, gross: v.gross, hoursPaid: v.hoursPaid, overtimeHours: v.overtimeHours, reductionApplied: v.reductionApplied, validated: false };
      }),
    ],
  };
  // Taux AT notifiés validés sur pièce : remplacent les taux déclarés du mode rapide.
  const rates = await db.query<{ siret: string | null; year: number; notified_rate: number | null; notified_rate_validated: boolean; payroll_mass: number | null }>(
    `select s.siret, r.year, r.notified_rate::float8, r.notified_rate_validated, r.payroll_mass::float8 from public.establishment_rates r join public.establishments s on s.id = r.establishment_id where r.company_id = $1`, [companyId]);
  for (const r of rates) {
    const key = r.siret ? keyBySiret.get(r.siret) : undefined;
    if (!key || !r.notified_rate_validated || r.notified_rate === null) continue;
    const ey = input.establishmentYears?.find((y) => y.establishmentId === key && y.year === r.year);
    if (ey) { ey.notifiedRate = r.notified_rate; ey.notifiedRateFromValidatedDocument = true; }
    else (input.establishmentYears ??= []).push({ establishmentId: key, year: r.year, payrollMass: r.payroll_mass, notifiedRate: r.notified_rate, notifiedRateFromValidatedDocument: true, appliedRate: null });
  }
}
