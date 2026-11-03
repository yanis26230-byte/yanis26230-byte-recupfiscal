import { REFERENCE_CASES, runReferenceCase } from '@recupfiscal/engine';
import { z } from 'zod';
import { Forbidden, NotFound } from './account-service';
import type { Database, Queryable } from './db/database';

/**
 * Back-office (analystes et administrateurs). Toutes les opérations passent par `db.asUser` :
 * les politiques RLS réservent chaque table aux rôles internes concernés.
 */

export type InternalRole = 'analyste' | 'administrateur';

export async function internalRole(db: Database, userId: string): Promise<InternalRole | null> {
  const [r] = await db.asUser(userId, (q) => q.query<{ role: InternalRole | null }>(`select app.internal_role()::text as role`));
  return r?.role ?? null;
}

export async function requireInternal(db: Database, userId: string, level: InternalRole = 'analyste'): Promise<InternalRole> {
  const role = await internalRole(db, userId);
  if (!role || (level === 'administrateur' && role !== 'administrateur')) throw new Forbidden('Accès réservé à l’équipe interne.');
  return role;
}

// ---------------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------------

export interface Indicators {
  leads: number; accounts: number; quickAudits: number; advancedAudits: number; calculatedAudits: number; mandatesSigned: number;
  estimatedCentral: number; confirmed: number; recovered: number; commissionsBillable: number; commissionsPaid: number;
  conversion: { auditToLead: number | null; leadToAccount: number | null; accountToMandate: number | null };
  bySector: { sector: string; audits: number }[];
}

export async function indicators(db: Database, userId: string): Promise<Indicators> {
  await requireInternal(db, userId);
  return db.asUser(userId, async (q) => {
    const [c] = await q.query<Record<string, number>>(`
      select
        (select count(*) from public.leads where not honeypot_triggered)::int as leads,
        (select count(*) from public.users where internal_role is null)::int as accounts,
        (select count(*) from public.audits where mode = 'rapide' and not is_demo)::int as quick_audits,
        (select count(*) from public.audits where mode = 'avance' and not is_demo)::int as advanced_audits,
        (select count(*) from public.audits where status = 'calcule' and not is_demo)::int as calculated,
        (select count(*) from public.mandates where status = 'signe')::int as mandates,
        (select coalesce(sum((r.totals #>> '{pastRecovery,central}')::float8), 0) from public.audits a join public.calculation_runs r on r.id = a.last_calculation_run_id where not a.is_demo)::float8 as estimated,
        (select coalesce(sum(validated_amount), 0) from public.opportunities where review_status = 'valide')::float8 as confirmed,
        (select coalesce(sum(amount_reimbursed), 0) from public.recoveries)::float8 as recovered,
        (select coalesce(sum(amount), 0) from public.commissions where status in ('facturable', 'facturee'))::float8 as billable,
        (select coalesce(sum(amount), 0) from public.commissions where status = 'payee')::float8 as paid`);
    const sectors = await q.query<{ sector: string; audits: number }>(`
      select coalesce(qa.answers #>> '{company,sector}', 'inconnu') as sector, count(*)::int as audits
        from public.audits a join public.questionnaire_answers qa on qa.audit_id = a.id and qa.step = 'entreprise'
       where not a.is_demo group by 1 order by 2 desc`);
    const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
    return {
      leads: c!.leads!, accounts: c!.accounts!, quickAudits: c!.quick_audits!, advancedAudits: c!.advanced_audits!, calculatedAudits: c!.calculated!,
      mandatesSigned: c!.mandates!, estimatedCentral: c!.estimated!, confirmed: c!.confirmed!, recovered: c!.recovered!,
      commissionsBillable: c!.billable!, commissionsPaid: c!.paid!,
      conversion: { auditToLead: ratio(c!.leads!, c!.calculated!), leadToAccount: ratio(c!.accounts!, c!.leads!), accountToMandate: ratio(c!.mandates!, c!.accounts!) },
      bySector: sectors,
    };
  });
}

// ---------------------------------------------------------------------------
// Prospects et audits
// ---------------------------------------------------------------------------

export interface LeadRow {
  id: string; email: string; first_name: string | null; phone: string | null; siren: string | null; company_name: string | null; sector: string | null;
  headcount: string | null; created_at: string; mode: string | null; past_low: number | null; past_high: number | null; status: string; last_activity_at: string; audit_id: string | null;
}

export async function listLeads(db: Database, userId: string): Promise<LeadRow[]> {
  await requireInternal(db, userId);
  return db.asUser(userId, (q) => q.query<LeadRow>(`
    select l.id::text, l.email, l.first_name, l.phone, l.siren, qa.answers #>> '{company,legalName}' as company_name, qa.answers #>> '{company,sector}' as sector,
           (select value from jsonb_each_text(qa.answers -> 'headcountByYear') order by key desc limit 1) as headcount,
           l.created_at::text, a.mode::text, (r.totals #>> '{pastRecovery,low}')::float8 as past_low, (r.totals #>> '{pastRecovery,high}')::float8 as past_high,
           l.status::text, l.last_activity_at::text, a.id::text as audit_id
      from public.leads l
      left join lateral (select * from public.audits where lead_id = l.id order by created_at desc limit 1) a on true
      left join public.questionnaire_answers qa on qa.audit_id = a.id and qa.step = 'entreprise'
      left join public.calculation_runs r on r.id = a.last_calculation_run_id
     where not l.honeypot_triggered order by l.created_at desc limit 500`));
}

export async function auditForReview(db: Database, userId: string, auditId: string) {
  await requireInternal(db, userId);
  if (!z.string().uuid().safeParse(auditId).success) throw new NotFound();
  return db.asUser(userId, async (q) => {
    const [audit] = await q.query<{ id: string; mode: string; status: string; is_demo: boolean; company_id: string | null; company_name: string | null; created_at: string; run_id: string | null; totals: unknown }>(`
      select a.id::text, a.mode::text, a.status::text, a.is_demo, a.company_id::text, coalesce(c.legal_name, qa.answers #>> '{company,legalName}') as company_name,
             a.created_at::text, a.last_calculation_run_id::text as run_id, r.totals
        from public.audits a left join public.companies c on c.id = a.company_id
        left join public.questionnaire_answers qa on qa.audit_id = a.id and qa.step = 'entreprise'
        left join public.calculation_runs r on r.id = a.last_calculation_run_id where a.id = $1`, [auditId]);
    if (!audit) throw new NotFound('Audit introuvable');
    const opportunities = audit.run_id ? await q.query<{ id: string; module_id: string; kind: string; year: number; status: string; estimated_low: number | null; estimated_high: number | null;
      confidence: string; risk: string; review_status: string; validated_amount: number | null; review_comment: string | null; name: string }>(`
      select id::text, module_id, kind::text, year, status::text, estimated_low::float8, estimated_high::float8, confidence::text, risk::text, review_status::text,
             validated_amount::float8, review_comment, detail ->> 'name' as name
        from public.opportunities where calculation_run_id = $1 order by module_id, year`, [audit.run_id]) : [];
    const documents = audit.company_id ? await q.query<{ id: string; original_filename: string; document_type: string | null; status: string; pending: number }>(`
      select d.id::text, d.original_filename, d.document_type, d.status::text, count(f.*) filter (where f.status = 'a_valider')::int as pending
        from public.documents d left join public.extracted_fields f on f.document_id = d.id where d.company_id = $1 group by d.id order by d.created_at desc`, [audit.company_id]) : [];
    return { audit, opportunities, documents };
  });
}

export const reviewSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('valide'), validatedAmount: z.number().min(0).max(100_000_000), comment: z.string().trim().max(2000).optional() }),
  z.object({ decision: z.literal('rejete'), comment: z.string().trim().min(3, 'Motif du rejet obligatoire').max(2000) }),
]);

/** Montant validé par un analyste : distinct de l'estimation (immuable) et du montant remboursé. */
export async function reviewOpportunity(db: Database, userId: string, opportunityId: string, input: z.input<typeof reviewSchema>) {
  await requireInternal(db, userId);
  const d = reviewSchema.parse(input);
  const r = await db.asUser(userId, (q) => q.query(
    `update public.opportunities set review_status = $2, validated_amount = $3, review_comment = $4 where id = $1 returning id`,
    [opportunityId, d.decision, d.decision === 'valide' ? d.validatedAmount : null, d.comment ?? null]));
  if (!r.length) throw new NotFound('Opportunité introuvable');
}

// ---------------------------------------------------------------------------
// Paramètres réglementaires
// ---------------------------------------------------------------------------

export interface ParamRow {
  id: string; key: string; label: string; value: number | null; unit: string; valid_from: string; valid_to: string | null; territory: string; module_id: string | null;
  source_url: string | null; verified_at: string | null; version: number; status: string; dataset: string; author_email: string | null; validator_email: string | null; note: string | null;
}

export async function listParameters(db: Database, userId: string, filter: { status?: string; key?: string } = {}): Promise<ParamRow[]> {
  await requireInternal(db, userId, 'administrateur');
  return db.asUser(userId, (q) => q.query<ParamRow>(`
    select p.id::text, p.key, p.label, p.value::float8, p.unit, p.valid_from::text, p.valid_to::text, p.territory, p.module_id, p.source_url, p.verified_at::text,
           p.version, p.status::text, p.dataset::text, ua.email as author_email, uv.email as validator_email, p.note
      from public.regulatory_parameters p left join public.users ua on ua.id = p.author_id left join public.users uv on uv.id = p.validator_id
     where p.dataset = 'officiel' and ($1::text is null or p.status::text = $1) and ($2::text is null or p.key = $2)
     order by p.key, p.valid_from, p.version`, [filter.status ?? null, filter.key ?? null]));
}

/** Paramètres manquants signalés par les derniers calculs réels : « règles à compléter ». */
export async function missingParameters(db: Database, userId: string) {
  await requireInternal(db, userId, 'administrateur');
  return db.asUser(userId, (q) => q.query<{ key: string; period_from: string; period_to: string; reason: string; runs: number }>(`
    select m ->> 'key' as key, m ->> 'periodFrom' as period_from, m ->> 'periodTo' as period_to, m ->> 'reason' as reason, count(*)::int as runs
      from (select outputs from public.calculation_runs where dataset = 'officiel' order by created_at desc limit 500) r,
           jsonb_array_elements(r.outputs -> 'missingParameters') m
     group by 1, 2, 3, 4 order by runs desc, key`));
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const paramDraftSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{3,80}$/), label: z.string().trim().min(3).max(200), value: z.number().finite(), unit: z.string().trim().min(1).max(40),
  validFrom: isoDate, validTo: isoDate.nullable(), territory: z.string().trim().min(2).max(10).default('FR'), moduleId: z.string().nullable(),
  sourceUrl: z.string().url().refine((u) => u.startsWith('https://'), 'Source en https obligatoire'), verifiedAt: isoDate, note: z.string().max(1000).nullable().optional(),
});

/** Nouvelle version au statut brouillon (jamais d'écrasement d'une version existante). */
export async function createParameterDraft(db: Database, userId: string, input: z.input<typeof paramDraftSchema>) {
  await requireInternal(db, userId, 'administrateur');
  const d = paramDraftSchema.parse(input);
  if (d.validTo && d.validTo < d.validFrom) throw new Forbidden('La date de fin précède la date de début.');
  return db.asUser(userId, async (q) => {
    const [v] = await q.query<{ next: number }>(`select coalesce(max(version), 0) + 1 as next from public.regulatory_parameters where key = $1 and dataset = 'officiel' and territory = $2 and valid_from = $3`, [d.key, d.territory, d.validFrom]);
    const [row] = await q.query<{ id: string }>(
      `insert into public.regulatory_parameters (key, label, value, unit, valid_from, valid_to, territory, module_id, source_url, verified_at, version, status, dataset, author_id, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'brouillon', 'officiel', auth.uid(), $12) returning id::text`,
      [d.key, d.label, d.value, d.unit, d.validFrom, d.validTo, d.territory, d.moduleId, d.sourceUrl, d.verifiedAt, v!.next, d.note ?? null]);
    return row!.id;
  });
}

/** Compléter une ligne « à renseigner » : c'est une nouvelle version brouillon (la ligne d'origine reste). */
export async function fillParameter(db: Database, userId: string, parameterId: string, input: { value: number; sourceUrl: string; verifiedAt: string; note?: string | null }) {
  const [p] = (await listParameters(db, userId)).filter((x) => x.id === parameterId);
  if (!p) throw new NotFound('Paramètre introuvable');
  return createParameterDraft(db, userId, { key: p.key, label: p.label, value: input.value, unit: p.unit || '-', validFrom: p.valid_from, validTo: p.valid_to,
    territory: p.territory, moduleId: p.module_id, sourceUrl: input.sourceUrl, verifiedAt: input.verifiedAt, note: input.note ?? null });
}

export async function validateParameter(db: Database, userId: string, parameterId: string) {
  await requireInternal(db, userId, 'administrateur');
  await db.asUser(userId, (q) => q.query(`update public.regulatory_parameters set status = 'valide' where id = $1`, [parameterId]))
    .catch((e: Error) => { throw new Forbidden(e.message.replace(/^error: /, '')); });
}

export async function returnParameterToDraft(db: Database, userId: string, parameterId: string) {
  await requireInternal(db, userId, 'administrateur');
  await db.asUser(userId, (q) => q.query(`update public.regulatory_parameters set status = 'brouillon', validator_id = null where id = $1 and status = 'valide'`, [parameterId]));
}

export interface ReferenceRunResult { code: string; passed: boolean; failures: string[] }

/** Relance les cas de référence d'un module (ou de tous) et enregistre le résultat. */
export async function runReferenceTests(db: Database, userId: string, moduleId: string | null): Promise<ReferenceRunResult[]> {
  await requireInternal(db, userId, 'administrateur');
  const cases = REFERENCE_CASES.filter((c) => !moduleId || c.moduleId === moduleId);
  const results = cases.map((c) => { const r = runReferenceCase(c); return { code: c.id, passed: r.passed, failures: r.failures }; });
  await db.asUser(userId, async (q) => {
    for (const r of results) {
      await q.query(`update public.reference_test_cases set last_run_at = now(), last_run_passed = $2, last_run_details = $3::jsonb where code = $1`, [r.code, r.passed, JSON.stringify(r.failures)]);
    }
  });
  return results;
}

/**
 * Publication : relance d'abord les cas de référence du module ; en cas d'échec, la publication
 * est refusée. La version publiée archive automatiquement les versions qu'elle remplace (trigger).
 */
export async function publishParameter(db: Database, userId: string, parameterId: string): Promise<{ references: ReferenceRunResult[] }> {
  await requireInternal(db, userId, 'administrateur');
  const [p] = await db.asUser(userId, (q) => q.query<{ module_id: string | null; status: string }>(`select module_id, status::text from public.regulatory_parameters where id = $1`, [parameterId]));
  if (!p) throw new NotFound('Paramètre introuvable');
  if (p.status !== 'valide') throw new Forbidden('Seul un paramètre validé par un second administrateur peut être publié.');
  const references = await runReferenceTests(db, userId, p.module_id);
  if (references.some((r) => !r.passed)) throw new Forbidden(`Publication refusée : ${references.filter((r) => !r.passed).length} cas de référence en échec.`);
  await db.asUser(userId, (q) => q.query(`update public.regulatory_parameters set status = 'publie' where id = $1`, [parameterId]));
  return { references };
}

export async function listReferenceCases(db: Database, userId: string) {
  await requireInternal(db, userId, 'administrateur');
  return db.asUser(userId, (q) => q.query<{ code: string; module_id: string; name: string; calculation: string; last_run_at: string | null; last_run_passed: boolean | null; last_run_details: string[] | null }>(
    `select code, module_id, name, calculation, last_run_at::text, last_run_passed, last_run_details from public.reference_test_cases order by code`));
}

// ---------------------------------------------------------------------------
// Modules, zonages, commercial, utilisateurs internes
// ---------------------------------------------------------------------------

export async function listModules(db: Database, userId: string) {
  await requireInternal(db, userId);
  return db.asUser(userId, (q) => q.query<{ id: string; name: string; kind: string; current_version: string; enabled: boolean }>(`select id, name, kind, current_version, enabled from public.modules order by id`));
}

export async function setModuleEnabled(db: Database, userId: string, moduleId: string, enabled: boolean) {
  await requireInternal(db, userId, 'administrateur');
  const r = await db.asUser(userId, (q) => q.query(`update public.modules set enabled = $2, updated_at = now() where id = $1 returning id`, [moduleId, enabled]));
  if (!r.length) throw new NotFound('Module introuvable');
}

export async function listZoning(db: Database, userId: string) {
  await requireInternal(db, userId, 'administrateur');
  return db.asUser(userId, async (q) => ({
    datasets: await q.query<{ id: string; zone_type: string; valid_from: string; valid_to: string | null; source_url: string; source_label: string; version: number; status: string; communes: number; author_id: string | null }>(`
      select d.id::text, d.zone_type, d.valid_from::text, d.valid_to::text, d.source_url, d.source_label, d.version, d.status::text, d.author_id::text,
             (select count(*) from public.zoning_entries e where e.dataset_id = d.id)::int as communes
        from public.zoning_datasets d where d.dataset = 'officiel' order by d.zone_type, d.valid_from, d.version`),
    schemes: await q.query<{ id: string; zone_type: string; code: string; name: string; status: string; valid_from: string; source_url: string | null }>(`
      select id::text, zone_type, code, name, status::text, valid_from::text, source_url from public.zone_schemes where dataset = 'officiel' order by zone_type, code`),
  }));
}

export const zoningDatasetSchema = z.object({
  zoneType: z.string().regex(/^[a-z0-9_]{2,30}$/), validFrom: isoDate, validTo: isoDate.nullable(),
  sourceUrl: z.string().url().refine((u) => u.startsWith('https://')), sourceLabel: z.string().trim().min(3).max(300),
});

/** Import d'une table de zonage : jeu sourcé + communes (CSV « code_insee;commune;debut;fin »). */
export async function importZoningDataset(db: Database, userId: string, input: z.input<typeof zoningDatasetSchema>, csv: string): Promise<{ datasetId: string; imported: number; rejected: string[] }> {
  await requireInternal(db, userId, 'administrateur');
  const d = zoningDatasetSchema.parse(input);
  const rejected: string[] = [];
  const rows = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[;,]/).map((c) => c.trim()));
  if (rows[0] && !/^[0-9][0-9AB][0-9]{3}$/.test(rows[0][0] ?? '')) rows.shift(); // en-tête
  const entries = rows.flatMap((r, i) => {
    const [insee, name, from, to] = r;
    if (!insee || !/^[0-9][0-9AB][0-9]{3}$/.test(insee)) { rejected.push(`Ligne ${i + 1} : code INSEE invalide`); return []; }
    const vf = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : d.validFrom;
    const vt = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : d.validTo;
    return [{ insee, name: name || null, vf, vt }];
  });
  if (!entries.length) throw new Forbidden('Aucune commune valide dans le fichier.');
  return db.asUser(userId, async (q) => {
    const [v] = await q.query<{ next: number }>(`select coalesce(max(version), 0) + 1 as next from public.zoning_datasets where zone_type = $1 and dataset = 'officiel' and valid_from = $2`, [d.zoneType, d.validFrom]);
    const [ds] = await q.query<{ id: string }>(
      `insert into public.zoning_datasets (zone_type, valid_from, valid_to, source_url, source_label, version, status, dataset) values ($1, $2, $3, $4, $5, $6, 'brouillon', 'officiel') returning id::text`,
      [d.zoneType, d.validFrom, d.validTo, d.sourceUrl, d.sourceLabel, v!.next]);
    for (const e of entries) {
      await q.query(`insert into public.zoning_entries (dataset_id, insee_code, commune_name, valid_from, valid_to, imported_by) values ($1, $2, $3, $4, $5, auth.uid()) on conflict do nothing`,
        [ds!.id, e.insee, e.name, e.vf, e.vt]);
    }
    return { datasetId: ds!.id, imported: entries.length, rejected };
  });
}

export async function setReferenceStatus(db: Database, userId: string, table: 'zoning_datasets' | 'zone_schemes', id: string, status: 'valide' | 'publie' | 'brouillon' | 'archive') {
  await requireInternal(db, userId, 'administrateur');
  await db.asUser(userId, (q) => q.query(`update public.${table} set status = $2 where id = $1`, [id, status]))
    .catch((e: Error) => { throw new Forbidden(e.message.replace(/^error: /, '')); });
}

export const zoneSchemeSchema = z.object({
  zoneType: z.string().regex(/^[a-z0-9_]{2,30}$/), code: z.string().regex(/^[A-Z0-9_]{2,40}$/), name: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(2000), conditions: z.array(z.string().trim().min(3).max(500)).max(20),
  documentsToProvide: z.array(z.string().trim().min(3).max(300)).max(20), sourceUrl: z.string().url().refine((u) => u.startsWith('https://')),
  validFrom: isoDate, validTo: isoDate.nullable(),
});

export async function createZoneScheme(db: Database, userId: string, input: z.input<typeof zoneSchemeSchema>) {
  await requireInternal(db, userId, 'administrateur');
  const d = zoneSchemeSchema.parse(input);
  await db.asUser(userId, (q) => q.query(
    `insert into public.zone_schemes (zone_type, code, name, description, conditions, documents_to_provide, source_url, valid_from, valid_to, status, dataset)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, 'brouillon', 'officiel')`,
    [d.zoneType, d.code, d.name, d.description, JSON.stringify(d.conditions), JSON.stringify(d.documentsToProvide), d.sourceUrl, d.validFrom, d.validTo]));
}

export async function commercialSettings(db: Database, userId: string) {
  await requireInternal(db, userId);
  return db.asUser(userId, async (q) => ({
    settings: (await q.query<{ commission_rate: number; commission_on_future_savings: boolean; future_savings_commission_rate: number | null }>(
      `select commission_rate::float8, commission_on_future_savings, future_savings_commission_rate::float8 from public.commercial_settings where id = 1`))[0]!,
    texts: await q.query<{ id: string; key: string; version: number; title: string; body: string; active: boolean; created_at: string }>(
      `select id::text, key, version, title, body, active, created_at::text from public.commercial_texts order by key, version desc`),
  }));
}

export const settingsSchema = z.object({
  commissionRate: z.number().min(0).max(1),
  commissionOnFutureSavings: z.boolean(),
  futureSavingsCommissionRate: z.number().min(0).max(1).nullable(),
});

export async function updateCommercialSettings(db: Database, userId: string, input: z.input<typeof settingsSchema>) {
  await requireInternal(db, userId, 'administrateur');
  const d = settingsSchema.parse(input);
  if (d.commissionOnFutureSavings && d.futureSavingsCommissionRate === null) throw new Forbidden('Indiquez le taux de commission sur les économies futures.');
  await db.asUser(userId, (q) => q.query(
    `update public.commercial_settings set commission_rate = $1, commission_on_future_savings = $2, future_savings_commission_rate = $3, updated_by = auth.uid(), updated_at = now() where id = 1`,
    [d.commissionRate, d.commissionOnFutureSavings, d.futureSavingsCommissionRate]));
}

export const textSchema = z.object({
  key: z.enum(['conditions_mandat', 'email_statut_dossier', 'email_invitation', 'email_lien_connexion']),
  title: z.string().trim().min(3).max(200), body: z.string().trim().min(10).max(50000),
});

/** Nouvelle version d'un texte, activée immédiatement (la précédente reste consultable). */
export async function publishText(db: Database, userId: string, input: z.input<typeof textSchema>) {
  await requireInternal(db, userId, 'administrateur');
  const d = textSchema.parse(input);
  await db.asUser(userId, async (q) => {
    const [v] = await q.query<{ next: number }>(`select coalesce(max(version), 0) + 1 as next from public.commercial_texts where key = $1`, [d.key]);
    await q.query(`update public.commercial_texts set active = false where key = $1 and active`, [d.key]);
    await q.query(`insert into public.commercial_texts (key, version, title, body, active, created_by) values ($1, $2, $3, $4, true, auth.uid())`, [d.key, v!.next, d.title, d.body]);
  });
}

export async function listInternalUsers(db: Database, userId: string) {
  await requireInternal(db, userId, 'administrateur');
  return db.asUser(userId, (q) => q.query<{ id: string; email: string; internal_role: string }>(`select id::text, email, internal_role::text from public.users where internal_role is not null order by email`));
}

/** Attribution ou retrait d'un rôle interne (administrateur uniquement, garde en base). */
export async function setInternalRole(db: Database, userId: string, email: string, role: InternalRole | null) {
  await requireInternal(db, userId, 'administrateur');
  if (role === null) {
    const admins = await db.asUser(userId, (q) => q.query(`select 1 from public.users where internal_role = 'administrateur' and lower(email) <> lower($1)`, [email]));
    if (!admins.length) throw new Forbidden('Il doit rester au moins un administrateur.');
  }
  const r = await db.asUser(userId, (q) => q.query(`update public.users set internal_role = $2 where lower(email) = lower($1) returning id`, [email.trim(), role]));
  if (!r.length) throw new NotFound('Aucun compte avec cette adresse : la personne doit d’abord se connecter une fois.');
}

export async function auditLog(db: Database, userId: string, limit = 100) {
  await requireInternal(db, userId, 'administrateur');
  return db.asUser(userId, (q: Queryable) => q.query<{ id: number; created_at: string; actor_email: string | null; action: string; table_name: string; row_id: string | null }>(`
    select l.id, l.created_at::text, u.email as actor_email, l.action, l.table_name, l.row_id from public.audit_logs l left join public.users u on u.id = l.actor_id
     order by l.id desc limit $1`, [limit]));
}

// ---------------------------------------------------------------------------
// Import / export CSV des paramètres (saisie en lot par un expert)
// ---------------------------------------------------------------------------

export const PARAM_CSV_COLUMNS = ['cle', 'libelle', 'valeur', 'unite', 'debut', 'fin', 'territoire', 'module', 'source', 'verifie_le', 'note'] as const;

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Modèle CSV des paramètres à renseigner (séparateur « ; », compatible tableur français).
 * Colonnes valeur, source et verifie_le à compléter ; une ligne = une période.
 */
export async function exportParametersToFill(db: Database, userId: string): Promise<string> {
  const rows = await listParameters(db, userId, { status: 'a_renseigner' });
  const lines = rows.map((p) => [p.key, p.label, '', p.unit, p.valid_from, p.valid_to ?? '', p.territory, p.module_id ?? '', '', '', ''].map(csvCell).join(';'));
  return '\uFEFF' + [PARAM_CSV_COLUMNS.join(';'), ...lines].join('\r\n') + '\r\n';
}

/**
 * Import : chaque ligne valide devient une NOUVELLE VERSION BROUILLON (rien n'est publié) ; la
 * validation par un second administrateur reste obligatoire, ligne par ligne.
 */
export async function importParameterDrafts(db: Database, userId: string, csv: string): Promise<{ created: number; rejected: string[] }> {
  await requireInternal(db, userId, 'administrateur');
  const { splitCsv } = await import('./documents/payroll-template');
  const rows = splitCsv(csv.replace(/^\uFEFF/, ''));
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const missing = ['cle', 'valeur', 'unite', 'debut', 'source', 'verifie_le'].filter((c) => !header.includes(c));
  if (missing.length) throw new Forbidden(`Colonnes manquantes : ${missing.join(', ')}. Utilisez le modèle exporté.`);
  const col = (r: string[], c: string) => (r[header.indexOf(c)] ?? '').trim();
  const frDate = (v: string) => (/^\d{2}\/\d{2}\/\d{4}$/.test(v) ? `${v.slice(6)}-${v.slice(3, 5)}-${v.slice(0, 2)}` : v);
  let created = 0;
  const rejected: string[] = [];
  for (const [i, r] of rows.entries()) {
    if (r.every((c) => c.trim() === '')) continue;
    const line = i + 2;
    const rawValue = col(r, 'valeur').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
    if (rawValue === '') { rejected.push(`Ligne ${line} (${col(r, 'cle')}) : valeur vide, ignorée`); continue; }
    try {
      await createParameterDraft(db, userId, {
        key: col(r, 'cle'), label: col(r, 'libelle') || col(r, 'cle'), value: Number(rawValue), unit: col(r, 'unite') || '-',
        validFrom: frDate(col(r, 'debut')), validTo: col(r, 'fin') ? frDate(col(r, 'fin')) : null, territory: col(r, 'territoire') || 'FR',
        moduleId: col(r, 'module') || null, sourceUrl: col(r, 'source'), verifiedAt: frDate(col(r, 'verifie_le')), note: col(r, 'note') || null,
      });
      created++;
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues.map((x) => `${x.path.join('.')} : ${x.message}`).join(', ') : (e as Error).message;
      rejected.push(`Ligne ${line} (${col(r, 'cle')}) : ${msg}`);
    }
  }
  return { created, rejected };
}
