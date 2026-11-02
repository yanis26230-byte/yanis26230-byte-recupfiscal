import { createHash } from 'node:crypto';
import type { Opportunity, ReferenceData, RegulatoryParameter } from '@recupfiscal/engine';
import { AccessDenied, loadAudit, type AuditAccess } from '../audit-service';
import type { Database } from '../db/database';
import type { FileStore } from '../storage';
import { renderReportPdf } from './pdf';
import { buildReportData, REPORT_TEMPLATE_VERSION } from './report-data';

export interface ReportRow { id: string; audit_id: string; calculation_run_id: string; created_at: string; size_bytes: number; sha256: string }

const j = <T>(x: unknown) => (typeof x === 'string' ? JSON.parse(x) : x) as T;

/**
 * Génère (ou retrouve) le rapport PDF du dernier calcul d'un audit. Réservé aux personnes ayant
 * droit au détail des résultats (compte ayant accès, ou démonstration).
 */
export async function generateReport(db: Database, store: FileStore, auditId: string, access: AuditAccess, now: Date = new Date()): Promise<ReportRow> {
  const { audit, meta, filled } = await loadAudit(db, auditId, access);
  if (!(audit.viaAccount || audit.is_demo)) throw new AccessDenied();
  if (!audit.last_calculation_run_id) throw new AccessDenied();
  const runId = audit.last_calculation_run_id;
  const [existing] = await db.query<ReportRow>(
    `select id::text, audit_id::text, calculation_run_id::text, created_at::text, size_bytes::int, sha256 from public.reports where calculation_run_id = $1 and template_version = $2`,
    [runId, REPORT_TEMPLATE_VERSION]);
  if (existing) return existing;

  const [run] = await db.query<Record<string, unknown>>(
    `select id::text, dataset::text, engine_version, module_versions, parameter_snapshot, reference_snapshot, frozen_input, outputs, totals, input_hash, output_hash
       from public.calculation_runs where id = $1 and audit_id = $2`, [runId, auditId]);
  if (!run) throw new AccessDenied();
  const [settings] = await db.query<{ rate: number }>(`select commission_rate::float8 as rate from public.commercial_settings where id = 1`);
  const outputs = j<{ opportunities: Opportunity[]; missingParameters: never[] }>(run.outputs);
  const data = buildReportData({
    answers: filled, meta, isDemo: audit.is_demo, generatedAt: now.toISOString().slice(0, 10), commissionRate: settings?.rate ?? 0.25,
    run: {
      id: run.id as string, dataset: run.dataset as string, engineVersion: run.engine_version as string, moduleVersions: j(run.module_versions),
      asOfDate: j<{ asOfDate: string }>(run.frozen_input).asOfDate, inputHash: run.input_hash as string, outputHash: run.output_hash as string,
      totals: j(run.totals), opportunities: outputs.opportunities, parameters: j<RegulatoryParameter[]>(run.parameter_snapshot),
      reference: j<ReferenceData>(run.reference_snapshot), missingParameters: outputs.missingParameters ?? [],
    },
  });
  const pdf = await renderReportPdf(data);
  const sha = createHash('sha256').update(pdf).digest('hex');
  const path = `${auditId}/${runId}-${REPORT_TEMPLATE_VERSION}.pdf`;
  await store.put('reports', path, pdf, 'application/pdf').catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'EEXIST') throw e; // génération concurrente : le fichier identique existe déjà
  });
  const [row] = await db.query<ReportRow>(
    `insert into public.reports (audit_id, calculation_run_id, template_version, storage_path, sha256, size_bytes, created_by)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict (calculation_run_id, template_version) do update set template_version = excluded.template_version
     returning id::text, audit_id::text, calculation_run_id::text, created_at::text, size_bytes::int, sha256`,
    [auditId, runId, REPORT_TEMPLATE_VERSION, path, sha, pdf.length, audit.viaAccount ? access.userId : null]).catch(async () =>
    db.query<ReportRow>(`select id::text, audit_id::text, calculation_run_id::text, created_at::text, size_bytes::int, sha256 from public.reports where calculation_run_id = $1 and template_version = $2`, [runId, REPORT_TEMPLATE_VERSION]));
  return row!;
}

export async function listReports(db: Database, auditId: string, access: AuditAccess): Promise<ReportRow[]> {
  const { audit } = await loadAudit(db, auditId, access);
  if (!(audit.viaAccount || audit.is_demo)) return [];
  return db.query<ReportRow>(`select id::text, audit_id::text, calculation_run_id::text, created_at::text, size_bytes::int, sha256 from public.reports where audit_id = $1 order by created_at desc`, [auditId]);
}

/** Lecture du fichier : mêmes droits que la génération ; intégrité vérifiée par l'empreinte. */
export async function readReport(db: Database, store: FileStore, reportId: string, access: (auditId: string) => Promise<AuditAccess>): Promise<{ bytes: Buffer; filename: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) throw new AccessDenied();
  const [r] = await db.query<{ audit_id: string; storage_path: string; sha256: string; created_at: string }>(
    `select audit_id::text, storage_path, sha256, created_at::text from public.reports where id = $1`, [reportId]);
  if (!r) throw new AccessDenied();
  const { audit, answers } = await loadAudit(db, r.audit_id, await access(r.audit_id));
  if (!(audit.viaAccount || audit.is_demo)) throw new AccessDenied();
  const bytes = await store.get('reports', r.storage_path);
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== r.sha256) throw new Error('Rapport introuvable ou altéré');
  const name = (answers.entreprise?.company.legalName ?? 'estimation').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return { bytes, filename: `rapport-${name}-${r.created_at.slice(0, 10)}.pdf` };
}
