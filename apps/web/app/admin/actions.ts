'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import * as admin from '@/lib/admin-service';
import { Forbidden, NotFound } from '@/lib/account-service';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { parseFrNumber } from '@/lib/questionnaire';

export type AdminResult = { ok: true; message?: string } | { ok: false; message: string };

async function run(path: string | null, fn: (db: Awaited<ReturnType<typeof getDb>>, userId: string) => Promise<unknown>, success?: string): Promise<AdminResult> {
  const user = await getCurrentUser();
  if (!user) redirect('/connexion?suivant=/admin');
  try {
    const r = await fn(await getDb(), user.id);
    if (path) revalidatePath(path);
    return { ok: true, message: typeof r === 'string' && !success ? r : success };
  } catch (e) {
    if (e instanceof Forbidden || e instanceof NotFound) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join(' ; ') };
    console.error(e);
    return { ok: false, message: (e as Error).message ?? 'Erreur' };
  }
}

const num = (v: FormDataEntryValue | null) => parseFrNumber(String(v ?? ''));
const str = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };

export async function reviewOpportunityAction(auditId: string, opportunityId: string, fd: FormData) {
  const decision = String(fd.get('decision'));
  return run(`/admin/audits/${auditId}`, (db, u) => admin.reviewOpportunity(db, u, opportunityId,
    decision === 'valide' ? { decision: 'valide', validatedAmount: num(fd.get('amount')) ?? -1, comment: str(fd.get('comment')) ?? undefined } : { decision: 'rejete', comment: String(fd.get('comment') ?? '') }), 'Revue enregistrée.');
}

export async function fillParameterAction(parameterId: string, fd: FormData) {
  return run('/admin/parametres', (db, u) => admin.fillParameter(db, u, parameterId, {
    value: num(fd.get('value')) ?? Number.NaN, sourceUrl: String(fd.get('sourceUrl') ?? ''), verifiedAt: String(fd.get('verifiedAt') ?? ''), note: str(fd.get('note')),
  }), 'Brouillon créé : à faire valider par un second administrateur.');
}

export async function createParameterAction(fd: FormData) {
  return run('/admin/parametres', (db, u) => admin.createParameterDraft(db, u, {
    key: String(fd.get('key') ?? ''), label: String(fd.get('label') ?? ''), value: num(fd.get('value')) ?? Number.NaN, unit: String(fd.get('unit') ?? ''),
    validFrom: String(fd.get('validFrom') ?? ''), validTo: str(fd.get('validTo')), territory: String(fd.get('territory') || 'FR'), moduleId: str(fd.get('moduleId')),
    sourceUrl: String(fd.get('sourceUrl') ?? ''), verifiedAt: String(fd.get('verifiedAt') ?? ''), note: str(fd.get('note')),
  }), 'Brouillon créé.');
}

export async function parameterStatusAction(parameterId: string, action: 'valider' | 'publier' | 'brouillon') {
  // Pas de rafraîchissement immédiat : le résultat (ex. cas de référence relancés) reste affiché.
  return run(null, async (db, u) => {
    if (action === 'valider') { await admin.validateParameter(db, u, parameterId); return 'Paramètre validé.'; }
    if (action === 'brouillon') { await admin.returnParameterToDraft(db, u, parameterId); return 'Renvoyé en brouillon.'; }
    const r = await admin.publishParameter(db, u, parameterId);
    return `Publié. ${r.references.length} cas de référence relancés, tous réussis.`;
  });
}

export async function runReferenceTestsAction() {
  return run('/admin/moteur', async (db, u) => {
    const r = await admin.runReferenceTests(db, u, null);
    return `${r.filter((x) => x.passed).length}/${r.length} cas de référence réussis.`;
  });
}

export async function setModuleAction(moduleId: string, enabled: boolean) {
  return run('/admin/moteur', (db, u) => admin.setModuleEnabled(db, u, moduleId, enabled), enabled ? 'Module activé.' : 'Module désactivé.');
}

export async function importZoningAction(fd: FormData) {
  return run('/admin/zonages', async (db, u) => {
    const r = await admin.importZoningDataset(db, u, { zoneType: String(fd.get('zoneType') ?? ''), validFrom: String(fd.get('validFrom') ?? ''), validTo: str(fd.get('validTo')),
      sourceUrl: String(fd.get('sourceUrl') ?? ''), sourceLabel: String(fd.get('sourceLabel') ?? '') }, String(fd.get('csv') ?? ''));
    return `${r.imported} commune(s) importée(s)${r.rejected.length ? `, ${r.rejected.length} rejetée(s) : ${r.rejected.slice(0, 3).join(' ; ')}` : ''}. Jeu en brouillon.`;
  });
}

export async function referenceStatusAction(table: 'zoning_datasets' | 'zone_schemes', id: string, status: 'valide' | 'publie' | 'brouillon' | 'archive') {
  return run('/admin/zonages', (db, u) => admin.setReferenceStatus(db, u, table, id, status), 'Statut mis à jour.');
}

export async function createZoneSchemeAction(fd: FormData) {
  const lines = (k: string) => String(fd.get(k) ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return run('/admin/zonages', (db, u) => admin.createZoneScheme(db, u, { zoneType: String(fd.get('zoneType') ?? ''), code: String(fd.get('code') ?? ''), name: String(fd.get('name') ?? ''),
    description: String(fd.get('description') ?? ''), conditions: lines('conditions'), documentsToProvide: lines('documents'), sourceUrl: String(fd.get('sourceUrl') ?? ''),
    validFrom: String(fd.get('validFrom') ?? ''), validTo: str(fd.get('validTo')) }), 'Dispositif créé en brouillon.');
}

export async function updateSettingsAction(fd: FormData) {
  const pct = (k: string) => { const n = num(fd.get(k)); return n === null ? null : n / 100; };
  return run('/admin/commercial', (db, u) => admin.updateCommercialSettings(db, u, { commissionRate: pct('commissionRate') ?? -1, commissionOnFutureSavings: fd.get('future') === 'on',
    futureSavingsCommissionRate: pct('futureRate') }), 'Conditions commerciales mises à jour.');
}

export async function publishTextAction(fd: FormData) {
  return run('/admin/commercial', (db, u) => admin.publishText(db, u, { key: String(fd.get('key')) as never, title: String(fd.get('title') ?? ''), body: String(fd.get('body') ?? '') }), 'Nouvelle version publiée.');
}

export async function setInternalRoleAction(fd: FormData) {
  const role = String(fd.get('role'));
  return run('/admin/utilisateurs', (db, u) => admin.setInternalRole(db, u, String(fd.get('email') ?? ''), role === 'aucun' ? null : (role as admin.InternalRole)), 'Rôle mis à jour.');
}

// ---------------------------------------------------------------------------
// Dossiers
// ---------------------------------------------------------------------------

async function caseDeps() {
  const cs = await import('@/lib/case-service');
  const { getMailer } = await import('@/lib/mail');
  return { cs, getMailer };
}

export async function caseStatusAction(caseId: string, fd: FormData) {
  const { cs, getMailer } = await caseDeps();
  return run(`/admin/dossiers/${caseId}`, (db, u) => cs.changeCaseStatus(db, getMailer(db), u, caseId, String(fd.get('status')), str(fd.get('message'))), 'Statut mis à jour, client notifié.');
}

export async function caseNoteAction(caseId: string, fd: FormData) {
  const { cs, getMailer } = await caseDeps();
  const kind = String(fd.get('kind')) === 'demande_piece' ? 'demande_piece' : 'commentaire_interne';
  return run(`/admin/dossiers/${caseId}`, (db, u) => cs.addCaseNote(db, getMailer(db), u, caseId, kind, String(fd.get('message') ?? '')), kind === 'demande_piece' ? 'Demande envoyée au client.' : 'Commentaire interne ajouté.');
}

export async function verifyCompanyAction(caseId: string, companyId: string, status: 'verifiee' | 'rejetee') {
  const { cs } = await caseDeps();
  return run(`/admin/dossiers/${caseId}`, (db, u) => cs.setCompanyVerification(db, u, companyId, status), status === 'verifiee' ? 'Entreprise vérifiée.' : 'Vérification rejetée.');
}

export async function recordRecoveryAction(caseId: string, fd: FormData) {
  const { cs, getMailer } = await caseDeps();
  return run(`/admin/dossiers/${caseId}`, (db, u) => cs.recordRecovery(db, getMailer(db), u, caseId, {
    amount: num(fd.get('amount')) ?? 0, receivedOn: String(fd.get('receivedOn') ?? ''), proofDocumentId: String(fd.get('proof') ?? ''), opportunityId: str(fd.get('opportunity')),
  }), 'Remboursement enregistré ; commission calculée.');
}

export async function commissionStatusAction(caseId: string, commissionId: string, status: 'facturee' | 'payee' | 'annulee') {
  const { cs } = await caseDeps();
  return run(`/admin/dossiers/${caseId}`, (db, u) => cs.setCommissionStatus(db, u, commissionId, status), 'Commission mise à jour.');
}

export async function importParametersAction(fd: FormData) {
  const file = fd.get('fichier');
  if (!(file instanceof File) || file.size === 0) return { ok: false as const, message: 'Choisissez un fichier CSV.' };
  if (file.size > 2 * 1024 * 1024) return { ok: false as const, message: 'Fichier trop volumineux (2 Mo maximum).' };
  const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
  return run('/admin/parametres', async (db, u) => {
    const r = await admin.importParameterDrafts(db, u, text);
    return `${r.created} brouillon(s) créé(s), à faire valider par un second administrateur.${r.rejected.length ? ` ${r.rejected.length} ligne(s) refusée(s) : ${r.rejected.slice(0, 5).join(' ; ')}${r.rejected.length > 5 ? '…' : ''}` : ''}`;
  });
}
