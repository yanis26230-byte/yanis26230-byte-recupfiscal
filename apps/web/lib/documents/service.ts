import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Forbidden, NotFound } from '../account-service';
import { noScanner, type Scanner } from '../antivirus';
import type { Database, Queryable } from '../db/database';
import type { FileStore } from '../storage';
import { decodeText, detectFileKind, MAX_UPLOAD_BYTES, MIME, type FileKind } from './detect';
import { parseDsn } from './dsn';
import { rowsToPayrollFields, splitCsv } from './payroll-template';
import { classifyText, extractAtRates } from './pdf-text';
import type { AtRateFieldValue, ExtractionResult, PayrollFieldValue } from './types';

/**
 * Import documentaire (cahier des charges §5.6) :
 * réception → contrôle (format par signature, taille, antivirus si disponible) → stockage privé →
 * file asynchrone → classification → extraction structurée → rattachement année/établissement →
 * contrôles → validation humaine. Une donnée extraite n'est utilisée qu'après validation.
 */

/** Couche IA indépendante du fournisseur : aucune n'est activée (aucun document n'est transmis). */
export interface AiExtractor { readonly name: string; extract(kind: FileKind, bytes: Uint8Array): Promise<ExtractionResult | null> }
export const NO_AI: AiExtractor = { name: 'aucun', extract: async () => null };

export class UploadRejected extends Error {}

export interface DocumentRow {
  id: string; original_filename: string; mime_type: string; size_bytes: number; document_type: string | null; status: string;
  created_at: string; processing_notes: string[]; pending: number; validated: number; rejected: number;
}

export interface UploadOptions { scanner?: Scanner; antivirusRequired?: boolean }

export async function uploadDocument(db: Database, store: FileStore, userId: string, companyId: string, file: { name: string; bytes: Uint8Array }, opts: UploadOptions = {}): Promise<{ documentId: string; duplicate: boolean }> {
  if (file.bytes.length === 0) throw new UploadRejected('Fichier vide.');
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw new UploadRejected('Fichier trop volumineux (15 Mo maximum).');
  const kind = detectFileKind(file.bytes, file.name);
  if (!kind) throw new UploadRejected('Format non pris en charge. Formats acceptés : PDF, CSV, XLSX, fichier DSN.');
  // Analyse antivirale avant tout stockage : un fichier infecté n'est jamais conservé.
  const scan = await (opts.scanner ?? noScanner).scan(file.bytes);
  if (scan.status === 'infecte') throw new UploadRejected('Ce fichier a été bloqué par l’antivirus. Il n’a pas été enregistré.');
  if (scan.status === 'non_disponible' && opts.antivirusRequired) throw new UploadRejected('L’analyse antivirale est momentanément indisponible : réessayez dans quelques minutes.');
  const sha = createHash('sha256').update(file.bytes).digest('hex');
  const safeName = file.name.normalize('NFC').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'document';

  return db.asUser(userId, async (q) => {
    // RLS : dépôt autorisé à tout membre (y compris comptable invité).
    const [existing] = await q.query<{ id: string }>(`select id::text from public.documents where company_id = $1 and sha256 = $2`, [companyId, sha]);
    if (existing) return { documentId: existing.id, duplicate: true };
    const [{ id }] = (await q.query<{ id: string }>(`select gen_random_uuid()::text as id`)) as [{ id: string }];
    const path = `${companyId}/${id}.${kind === 'dsn' ? 'txt' : kind}`;
    await q.query(
      `insert into public.documents (id, company_id, uploaded_by, storage_path, original_filename, mime_type, size_bytes, sha256, status, antivirus_status)
       values ($1, $2, auth.uid(), $3, $4, $5, $6, $7, 'recu', $8)`,
      [id, companyId, path, safeName, MIME[kind], file.bytes.length, sha, scan.status]).catch((e: Error) => {
      if (/row-level security/.test(e.message)) throw new Forbidden('Vous n’êtes pas membre de cette entreprise.');
      throw e;
    });
    await store.put('documents', path, file.bytes, MIME[kind]);
    return { documentId: id, duplicate: false };
  }).then(async (r) => {
    if (!r.duplicate) await db.query(`insert into public.jobs (kind, payload) values ('extraire_document', $1::jsonb)`, [JSON.stringify({ documentId: r.documentId })]);
    return r;
  });
}

async function extract(kind: FileKind, bytes: Uint8Array, salt: string, ai: AiExtractor): Promise<ExtractionResult> {
  if (kind === 'dsn') {
    const r = parseDsn(decodeText(bytes), salt);
    return { documentType: r.recognised ? 'dsn' : 'inconnu', classificationConfidence: r.recognised ? 1 : 0, fields: r.fields, notes: r.notes, manualEntryRequired: !r.recognised };
  }
  if (kind === 'csv' || kind === 'xlsx') {
    let rows: unknown[][];
    if (kind === 'csv') rows = splitCsv(decodeText(bytes));
    else {
      const { default: readXlsx } = await import('read-excel-file/node');
      rows = (await readXlsx(Buffer.from(bytes))) as unknown[][];
    }
    const r = rowsToPayrollFields(rows);
    return { documentType: r.recognised ? 'journal_paie' : 'inconnu', classificationConfidence: r.recognised ? 1 : 0, fields: r.fields, notes: r.notes, manualEntryRequired: !r.recognised };
  }
  // PDF : couche texte uniquement (pas d'OCR disponible) ; l'IA n'est utilisée que si un fournisseur conforme est configuré.
  const { extractText, getDocumentProxy } = await import('unpdf');
  let pages: string[] = [];
  try {
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    pages = (await extractText(doc, { mergePages: false })).text as unknown as string[];
  } catch {
    return { documentType: 'inconnu', classificationConfidence: 0, fields: [], notes: ['PDF illisible.'], manualEntryRequired: true };
  }
  const all = pages.join('\n');
  if (all.replace(/\s/g, '').length < 30) {
    const viaAi = await ai.extract(kind, bytes);
    if (viaAi) return viaAi;
    return { documentType: 'inconnu', classificationConfidence: 0, fields: [], notes: ['Document scanné sans texte : la reconnaissance de caractères (OCR) n’est pas activée. Saisie manuelle requise.'], manualEntryRequired: true };
  }
  const c = classifyText(all);
  if (c.type === 'notification_at') {
    const r = extractAtRates(pages);
    return { documentType: 'notification_at', classificationConfidence: c.confidence, fields: r.fields, notes: r.notes, manualEntryRequired: r.fields.length === 0 };
  }
  return { documentType: c.type, classificationConfidence: c.confidence, fields: [], notes: ['Pas d’extraction automatique pour ce type de document : saisissez les valeurs utiles à partir du document.'], manualEntryRequired: true };
}

/** Traite un document : classification + extraction ; les champs sont créés « à valider ». */
export async function processDocument(db: Database, store: FileStore, documentId: string, ai: AiExtractor = NO_AI): Promise<void> {
  const [doc] = await db.query<{ id: string; company_id: string; storage_path: string; original_filename: string; status: string }>(
    `select id::text, company_id::text, storage_path, original_filename, status::text from public.documents where id = $1`, [documentId]);
  if (!doc) throw new Error('Document introuvable');
  if (!['recu', 'controle'].includes(doc.status)) return;
  const bytes = await store.get('documents', doc.storage_path);
  if (!bytes) throw new Error('Fichier introuvable dans le stockage');
  const kind = detectFileKind(bytes, doc.original_filename);
  if (!kind) {
    await db.query(`update public.documents set status = 'rejete', processing_notes = $2::jsonb, processed_at = now() where id = $1`, [documentId, JSON.stringify(['Format non reconnu.'])]);
    return;
  }
  const r = await extract(kind, bytes, doc.company_id, ai);
  await db.transaction(async (tx) => {
    const establishments = await tx.query<{ id: string; siret: string | null }>(`select id::text, siret from public.establishments where company_id = $1`, [doc.company_id]);
    for (const f of r.fields) {
      const siret = (f.value as PayrollFieldValue | AtRateFieldValue).siret;
      const est = siret ? establishments.find((e) => e.siret === siret) : establishments.length === 1 ? establishments[0] : undefined;
      await tx.query(
        `insert into public.extracted_fields (company_id, document_id, field_key, value, page, zone, confidence, extractor, status, year, establishment_id)
         values ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, 'a_valider', $9, $10)`,
        [doc.company_id, documentId, f.fieldKey, JSON.stringify(f.value), f.page, f.zone ? JSON.stringify(f.zone) : null, f.confidence, f.extractor, f.year, est?.id ?? null]);
    }
    await tx.query(
      `update public.documents set status = $2, document_type = $3, classification_confidence = $4, processing_notes = $5::jsonb, processed_at = now(),
         year = (select min(year) from public.extracted_fields where document_id = $1) where id = $1`,
      [documentId, r.manualEntryRequired ? 'extraction_manuelle' : 'extrait', r.documentType, r.classificationConfidence, JSON.stringify(r.notes)]);
  });
}

/** Exécute les tâches en attente (appelé après un dépôt et par le processus de fond `pnpm worker`). */
export async function processPendingJobs(db: Database, store: FileStore, limit = 10, ai: AiExtractor = NO_AI): Promise<number> {
  let done = 0;
  for (let i = 0; i < limit; i++) {
    const [job] = await db.query<{ id: string; payload: unknown; attempts: number; max_attempts: number }>(
      `update public.jobs set status = 'en_cours', locked_at = now(), attempts = attempts + 1, updated_at = now()
        where id = (select id from public.jobs where status = 'en_attente' and run_after <= now() order by created_at limit 1 for update skip locked)
        returning id::text, payload, attempts, max_attempts`);
    if (!job) break;
    const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { documentId: string };
    try {
      await processDocument(db, store, payload.documentId, ai);
      await db.query(`update public.jobs set status = 'termine', updated_at = now() where id = $1`, [job.id]);
      done++;
    } catch (e) {
      const final = job.attempts >= job.max_attempts;
      await db.query(`update public.jobs set status = $2, last_error = $3, run_after = now() + interval '1 minute', updated_at = now() where id = $1`,
        [job.id, final ? 'echec' : 'en_attente', String((e as Error).message).slice(0, 500)]);
      if (final) await db.query(`update public.documents set processing_notes = processing_notes || $2::jsonb where id = $1`, [payload.documentId, JSON.stringify(['Traitement impossible : un analyste va vérifier le document.'])]);
    }
  }
  return done;
}

// ---------------------------------------------------------------------------
// Consultation et validation (sous RLS)
// ---------------------------------------------------------------------------

export async function listDocuments(db: Database, userId: string, companyId: string): Promise<DocumentRow[]> {
  return db.asUser(userId, (q) => q.query<DocumentRow>(
    `select d.id::text, d.original_filename, d.mime_type, d.size_bytes::int, d.document_type, d.status::text, d.created_at::text, d.processing_notes,
            count(f.*) filter (where f.status = 'a_valider')::int as pending, count(f.*) filter (where f.status in ('valide', 'corrige'))::int as validated,
            count(f.*) filter (where f.status = 'rejete')::int as rejected
       from public.documents d left join public.extracted_fields f on f.document_id = d.id
      where d.company_id = $1 group by d.id order by d.created_at desc`, [companyId]));
}

export interface FieldRow {
  id: string; field_key: string; value: PayrollFieldValue | AtRateFieldValue; corrected_value: PayrollFieldValue | AtRateFieldValue | null;
  page: number | null; zone: Record<string, unknown> | null; confidence: number; extractor: string; status: string; validated_at: string | null;
}

export async function getDocumentWithFields(db: Database, userId: string, documentId: string) {
  return db.asUser(userId, async (q) => {
    const [doc] = await q.query<{ id: string; company_id: string; original_filename: string; document_type: string | null; status: string; processing_notes: string[]; can_write: boolean }>(
      `select id::text, company_id::text, original_filename, document_type, status::text, processing_notes, app.can_write_company(company_id) as can_write from public.documents where id = $1`, [documentId]);
    if (!doc) throw new NotFound('Document introuvable');
    const fields = await q.query<FieldRow>(
      `select id::text, field_key, value, corrected_value, page, zone, confidence::float8, extractor, status::text, validated_at::text
         from public.extracted_fields where document_id = $1 order by (value->>'year')::int nulls last, (value->>'month')::int nulls last, value->>'employeeRef', created_at`, [documentId]);
    return { doc, fields };
  });
}

const payrollValueSchema = z.object({
  employeeRef: z.string().regex(/^[A-Za-z0-9_.\-]{1,32}$/), year: z.number().int().min(2015).max(2100), month: z.number().int().min(1).max(12),
  gross: z.number().min(0).max(1_000_000), hoursPaid: z.number().min(0).max(400), overtimeHours: z.number().min(0).max(400),
  reductionApplied: z.number().min(0).max(1_000_000), siret: z.string().regex(/^\d{14}$/).nullable(), contractType: z.string().max(40).nullable(),
});
const atValueSchema = z.object({ siret: z.string().regex(/^\d{14}$/).nullable(), year: z.number().int().min(2015).max(2100), rate: z.number().min(0).max(0.3) });

export type FieldDecision = { fieldId: string; action: 'valider' } | { fieldId: string; action: 'rejeter' } | { fieldId: string; action: 'corriger'; value: unknown };

/**
 * Validation humaine. Les valeurs validées (ou corrigées) sont appliquées aux données utilisées
 * par le moteur : lignes de paie validées, taux AT notifié validé (avec le document source).
 */
export async function decideFields(db: Database, userId: string, decisions: FieldDecision[]): Promise<{ applied: number }> {
  let applied = 0;
  await db.asUser(userId, async (q) => {
    for (const d of decisions) {
      const [f] = await q.query<{ id: string; company_id: string; document_id: string; field_key: string; value: unknown; status: string; establishment_id: string | null; can_write: boolean }>(
        `select id::text, company_id::text, document_id::text, field_key, value, status::text, establishment_id::text, app.can_write_company(company_id) as can_write from public.extracted_fields where id = $1`, [d.fieldId]);
      if (!f) throw new NotFound('Champ introuvable');
      if (!f.can_write) throw new Forbidden('Votre rôle ne permet pas de valider les données extraites.');
      const raw = typeof f.value === 'string' ? JSON.parse(f.value) : f.value;
      if (d.action === 'rejeter') {
        await q.query(`update public.extracted_fields set status = 'rejete' where id = $1`, [f.id]);
        await q.query(`delete from public.payroll_lines where source_extracted_field_id = $1`, [f.id]);
        continue;
      }
      const schema = f.field_key === 'ligne_paie' ? payrollValueSchema : atValueSchema;
      const value = schema.parse(d.action === 'corriger' ? d.value : raw);
      if (d.action === 'corriger') await q.query(`update public.extracted_fields set status = 'corrige', corrected_value = $2::jsonb where id = $1`, [f.id, JSON.stringify(value)]);
      else await q.query(`update public.extracted_fields set status = 'valide' where id = $1`, [f.id]);
      if (f.field_key === 'ligne_paie') await applyPayroll(q, f.company_id, f.establishment_id, f.id, value as PayrollFieldValue);
      else await applyAtRate(q, f.company_id, f.establishment_id, f.document_id, value as AtRateFieldValue);
      await q.query(`update public.extracted_fields set applied_at = now() where id = $1`, [f.id]);
      applied++;
    }
  });
  return { applied };
}

async function upsertEmployee(q: Queryable, companyId: string, establishmentId: string | null, ref: string, contract: string | null): Promise<string> {
  const [e] = await q.query<{ id: string }>(
    `insert into public.employees_anonymized (company_id, establishment_id, internal_id, contract_type) values ($1, $2, $3, $4)
     on conflict (company_id, internal_id) do update set contract_type = coalesce(excluded.contract_type, public.employees_anonymized.contract_type) returning id::text`,
    [companyId, establishmentId, ref, contract ?? 'non_precise']);
  return e!.id;
}

async function applyPayroll(q: Queryable, companyId: string, establishmentId: string | null, fieldId: string, v: PayrollFieldValue) {
  const employeeId = await upsertEmployee(q, companyId, establishmentId, v.employeeRef, v.contractType);
  await q.query(
    `insert into public.payroll_lines (company_id, employee_id, year, month, gross, hours_paid, overtime_hours, reduction_applied, validated, source, source_extracted_field_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, true, 'extraction', $9)
     on conflict (employee_id, year, month) do update set gross = excluded.gross, hours_paid = excluded.hours_paid, overtime_hours = excluded.overtime_hours,
       reduction_applied = excluded.reduction_applied, validated = true, source = 'extraction', source_extracted_field_id = excluded.source_extracted_field_id`,
    [companyId, employeeId, v.year, v.month, v.gross, v.hoursPaid, v.overtimeHours, v.reductionApplied, fieldId]);
}

async function applyAtRate(q: Queryable, companyId: string, establishmentId: string | null, documentId: string, v: AtRateFieldValue) {
  let estId = establishmentId;
  if (v.siret) estId = (await q.query<{ id: string }>(`select id::text from public.establishments where company_id = $1 and siret = $2`, [companyId, v.siret]))[0]?.id ?? estId;
  if (!estId) throw new Forbidden('Établissement non identifié pour ce taux : corrigez le SIRET.');
  await q.query(
    `insert into public.establishment_rates (company_id, establishment_id, year, notified_rate, notified_rate_validated, source, source_document_id)
     values ($1, $2, $3, $4, true, 'notification validée', $5)
     on conflict (establishment_id, year) do update set notified_rate = excluded.notified_rate, notified_rate_validated = true, source = excluded.source, source_document_id = excluded.source_document_id`,
    [companyId, estId, v.year, v.rate, documentId]);
}

// ---------------------------------------------------------------------------
// Saisie manuelle (mode avancé sans import)
// ---------------------------------------------------------------------------

export const manualPayrollSchema = z.object({
  employeeRef: z.string().trim().regex(/^[A-Za-z0-9_.\-]{1,32}$/, 'Identifiant interne : lettres, chiffres, tirets (32 max), sans nom'),
  contractType: z.string().trim().max(40).nullable(),
  establishmentId: z.string().uuid().nullable(),
  year: z.number().int().min(2015).max(2100),
  months: z.array(z.object({
    month: z.number().int().min(1).max(12), gross: z.number().min(0).max(1_000_000), hoursPaid: z.number().min(0).max(400),
    overtimeHours: z.number().min(0).max(400), reductionApplied: z.number().min(0).max(1_000_000),
  })).max(12),
});

/** Les données saisies par l'utilisateur sont ses propres déclarations : elles sont utilisables directement. */
export async function saveManualPayroll(db: Database, userId: string, companyId: string, input: z.input<typeof manualPayrollSchema>) {
  const d = manualPayrollSchema.parse(input);
  await db.asUser(userId, async (q) => {
    const [ok] = await q.query<{ w: boolean }>(`select app.can_write_company($1) as w`, [companyId]);
    if (!ok?.w) throw new Forbidden('Votre rôle ne permet pas de saisir la paie.');
    const employeeId = await upsertEmployee(q, companyId, d.establishmentId, d.employeeRef, d.contractType);
    for (const m of d.months) {
      await q.query(
        `insert into public.payroll_lines (company_id, employee_id, year, month, gross, hours_paid, overtime_hours, reduction_applied, validated, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, true, 'saisie_manuelle')
         on conflict (employee_id, year, month) do update set gross = excluded.gross, hours_paid = excluded.hours_paid, overtime_hours = excluded.overtime_hours,
           reduction_applied = excluded.reduction_applied, validated = true, source = 'saisie_manuelle', source_extracted_field_id = null`,
        [companyId, employeeId, d.year, m.month, m.gross, m.hoursPaid, m.overtimeHours, m.reductionApplied]);
    }
  });
}

export async function payrollSummary(db: Database, userId: string, companyId: string) {
  return db.asUser(userId, (q) => q.query<{ year: number; employees: number; lines: number; manual: number; extracted: number }>(
    `select year, count(distinct employee_id)::int employees, count(*)::int lines, count(*) filter (where source = 'saisie_manuelle')::int manual,
            count(*) filter (where source = 'extraction')::int extracted
       from public.payroll_lines where company_id = $1 and validated group by year order by year`, [companyId]));
}

export async function listEmployeesWithPayroll(db: Database, userId: string, companyId: string, year: number) {
  return db.asUser(userId, (q) => q.query<{ internal_id: string; contract_type: string; months: { month: number; gross: number; hours_paid: number; overtime_hours: number; reduction_applied: number }[] }>(
    `select e.internal_id, e.contract_type,
            coalesce(json_agg(json_build_object('month', p.month, 'gross', p.gross::float8, 'hours_paid', p.hours_paid::float8, 'overtime_hours', p.overtime_hours::float8, 'reduction_applied', p.reduction_applied::float8) order by p.month)
                     filter (where p.id is not null), '[]') as months
       from public.employees_anonymized e left join public.payroll_lines p on p.employee_id = e.id and p.year = $2 and p.validated
      where e.company_id = $1 group by e.id order by e.internal_id`, [companyId, year]));
}
