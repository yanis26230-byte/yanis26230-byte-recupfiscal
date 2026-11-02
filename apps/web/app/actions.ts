'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  acceptInvitation, changeMemberRole, claimPendingAudits, Forbidden, inviteMember, NotFound, removeMember, revokeInvitation,
} from '@/lib/account-service';
import { AccessDenied, captureLead, createAudit, createDemoAudit, saveStep, submitAudit, ValidationError, type AuditAccess, type LeadInput } from '@/lib/audit-service';
import { appOrigin, completeSignIn, getCurrentUser, sendMagicLink, signOut } from '@/lib/auth';
import { safeNextPath } from '@/lib/auth/local-core';
import { searchCompanies, type SearchResult } from '@/lib/company-search';
import { getDb } from '@/lib/db';
import { getMailer } from '@/lib/mail';
import { companySchema, establishmentSchema, type Issue } from '@/lib/questionnaire';
import type { StepId } from '@/lib/sectors';
import { demoEnabled, getAuditToken, setAuditToken, todayInParis } from '@/lib/server/session';
import { isValidSiren } from '@/lib/siren';
import { allow, TOO_MANY } from '@/lib/server/limits';
import { log } from '@/lib/log';

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string; issues?: Issue[] };

function failure(e: unknown): { ok: false; message: string; issues?: Issue[] } {
  if (e instanceof AccessDenied) return { ok: false, message: 'Accès refusé : cet audit n’est pas associé à ce navigateur ni à votre compte.' };
  if (e instanceof ValidationError) return { ok: false, message: e.message, issues: e.issues };
  if (e instanceof Forbidden || e instanceof NotFound) return { ok: false, message: e.message };
  if (e instanceof z.ZodError) return { ok: false, message: e.issues.map((i) => i.message).join(' ; ') };
  log.error('action serveur', e);
  return { ok: false, message: 'Une erreur est survenue. Réessayez dans un instant.' };
}

async function access(auditId: string): Promise<AuditAccess> {
  const user = await getCurrentUser();
  return { token: await getAuditToken(auditId), userId: user?.id ?? null };
}

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/connexion');
  return user;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function searchCompanyAction(query: string): Promise<SearchResult> {
  if (!(await allow('recherche'))) return { ok: false, reason: 'unavailable', message: TOO_MANY };
  return searchCompanies(String(query ?? ''), { baseUrl: process.env.COMPANY_SEARCH_BASE_URL });
}

const startSchema = z.object({ company: companySchema, establishments: z.array(establishmentSchema).min(1).max(50) });

export async function startAuditAction(input: unknown): Promise<ActionResult> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Informations incomplètes : ' + parsed.error.issues.map((i) => i.message).join(' ; ') };
  if (!isValidSiren(parsed.data.company.siren)) return { ok: false, message: 'Ce numéro SIREN n’est pas valide.' };
  if (!parsed.data.establishments.some((e) => e.concerned)) return { ok: false, message: 'Sélectionnez au moins un établissement.' };
  if (!(await allow('creationAudit'))) return { ok: false, message: TOO_MANY };
  let auditId: string;
  try {
    const user = await getCurrentUser();
    const r = await createAudit(await getDb(), { ...parsed.data, today: todayInParis(), ownerUserId: user?.id ?? null });
    await setAuditToken(r.auditId, r.token);
    auditId = r.auditId;
  } catch (e) {
    return failure(e);
  }
  redirect(`/audit/${auditId}`);
}

export async function startDemoAction(): Promise<void> {
  if (!demoEnabled() || !(await allow('creationAudit'))) redirect('/audit');
  const user = await getCurrentUser();
  const r = await createDemoAudit(await getDb(), user?.id ?? null);
  await setAuditToken(r.auditId, r.token);
  redirect(`/audit/${r.auditId}`);
}

export async function saveStepAction(auditId: string, step: StepId, answers: unknown): Promise<ActionResult> {
  try {
    await saveStep(await getDb(), auditId, await access(auditId), step, answers);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function submitAuditAction(auditId: string): Promise<ActionResult> {
  try {
    await submitAudit(await getDb(), auditId, await access(auditId), todayInParis());
  } catch (e) {
    return failure(e);
  }
  redirect(`/audit/${auditId}/resultats`);
}

export type LeadActionResult = { ok: true; linkSent: boolean; message?: string } | { ok: false; message: string };

/** Enregistre le prospect puis envoie un lien magique qui créera le compte et rattachera l'audit. */
export async function captureLeadAction(auditId: string, input: LeadInput): Promise<LeadActionResult> {
  if (!(await allow('prospect'))) return { ok: false, message: TOO_MANY };
  try {
    const { email } = await captureLead(await getDb(), auditId, await access(auditId), input);
    if (input.website) return { ok: true, linkSent: true }; // robot : aucune action, réponse identique
    const r = await sendMagicLink(email, '/espace?bienvenue=1');
    return r.ok ? { ok: true, linkSent: true } : { ok: true, linkSent: false, message: r.message };
  } catch (e) {
    return failure(e);
  }
}

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

const emailSchema = z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(254);

export async function requestLoginLinkAction(email: string, nextPath: string): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, message: 'Adresse e-mail invalide' };
  if (!(await allow('lienConnexion'))) return { ok: false, message: TOO_MANY };
  try {
    const r = await sendMagicLink(parsed.data, safeNextPath(nextPath));
    return r.ok ? { ok: true } : r;
  } catch (e) {
    return failure(e);
  }
}

/** Bouton « Se connecter » de la page de confirmation (le lien n'est consommé qu'ici, en POST). */
export async function confirmSignInAction(formData: FormData): Promise<void> {
  const result = await completeSignIn({
    jeton: String(formData.get('jeton') ?? '') || undefined,
    tokenHash: String(formData.get('token_hash') ?? '') || undefined,
    type: String(formData.get('type') ?? '') || undefined,
    suivant: String(formData.get('suivant') ?? '') || undefined,
  });
  if (!result) redirect('/connexion?erreur=lien');
  const { bootstrapAdmin } = await import('@/lib/account-service');
  await bootstrapAdmin(await getDb(), result.user, process.env.BOOTSTRAP_ADMIN_EMAILS);
  const claims = await claimPendingAudits(await getDb(), result.user);
  const nonMember = claims.filter((c) => c.outcome === 'entreprise_existante_non_membre').length;
  const next = new URL(result.nextPath, 'http://x');
  if (claims.length) next.searchParams.set('rattaches', String(claims.length));
  if (nonMember) next.searchParams.set('acces', 'demande');
  redirect(`${next.pathname}${next.search}`);
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect('/');
}

// ---------------------------------------------------------------------------
// Entreprise : membres et invitations
// ---------------------------------------------------------------------------

export async function inviteMemberAction(companyId: string, input: { email: string; role: string }): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const db = await getDb();
    await inviteMember(db, getMailer(db), user, companyId, input as never, await appOrigin());
    revalidatePath(`/espace/entreprises/${companyId}`);
    return { ok: true, message: `Invitation envoyée à ${input.email}.` };
  } catch (e) {
    return failure(e);
  }
}

export async function revokeInvitationAction(companyId: string, invitationId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await revokeInvitation(await getDb(), user.id, invitationId);
    revalidatePath(`/espace/entreprises/${companyId}`);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

const roleSchema = z.enum(['proprietaire', 'collaborateur', 'comptable_invite']);

export async function changeRoleAction(companyId: string, memberId: string, role: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await changeMemberRole(await getDb(), user.id, companyId, memberId, roleSchema.parse(role));
    revalidatePath(`/espace/entreprises/${companyId}`);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function removeMemberAction(companyId: string, memberId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await removeMember(await getDb(), user.id, companyId, memberId);
  } catch (e) {
    return failure(e);
  }
  if (memberId === user.id) redirect('/espace');
  revalidatePath(`/espace/entreprises/${companyId}`);
  return { ok: true };
}

export async function acceptInvitationAction(token: string): Promise<ActionResult> {
  const user = await requireUser();
  let companyId: string;
  try {
    ({ companyId } = await acceptInvitation(await getDb(), user, token));
  } catch (e) {
    return failure(e);
  }
  redirect(`/espace/entreprises/${companyId}`);
}

// ---------------------------------------------------------------------------
// Rapport PDF
// ---------------------------------------------------------------------------

export async function generateReportAction(auditId: string): Promise<{ ok: true; reportId: string } | { ok: false; message: string }> {
  try {
    const { generateReport } = await import('@/lib/report/report-service');
    const { getFileStore } = await import('@/lib/storage');
    const r = await generateReport(await getDb(), getFileStore(), auditId, await access(auditId));
    revalidatePath(`/audit/${auditId}/resultats`);
    return { ok: true, reportId: r.id };
  } catch (e) {
    if (e instanceof AccessDenied) return { ok: false, message: 'Le rapport est réservé aux comptes ayant accès à cette estimation.' };
    return failure(e);
  }
}

// ---------------------------------------------------------------------------
// Documents, validation, paie, mode avancé
// ---------------------------------------------------------------------------

export async function uploadDocumentAction(companyId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const file = formData.get('fichier');
  if (!(file instanceof File)) return { ok: false, message: 'Aucun fichier.' };
  if (!(await allow('depot', user.id))) return { ok: false, message: TOO_MANY };
  try {
    const { uploadDocument, processPendingJobs, UploadRejected } = await import('@/lib/documents/service');
    const { getFileStore } = await import('@/lib/storage');
    const { after } = await import('next/server');
    const db = await getDb();
    const store = getFileStore();
    try {
      const r = await uploadDocument(db, store, user.id, companyId, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      // Traitement asynchrone après la réponse (le processus `pnpm worker` prend le relais en production).
      after(() => processPendingJobs(db, store).catch((e) => console.error('extraction', e)));
      revalidatePath(`/espace/entreprises/${companyId}/documents`);
      return { ok: true, message: r.duplicate ? 'Ce document avait déjà été déposé.' : 'Document reçu : analyse en cours.' };
    } catch (e) {
      if (e instanceof UploadRejected) return { ok: false, message: e.message };
      throw e;
    }
  } catch (e) {
    return failure(e);
  }
}

export async function decideFieldsAction(path: string, decisions: import('@/lib/documents/service').FieldDecision[]): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const { decideFields } = await import('@/lib/documents/service');
    const r = await decideFields(await getDb(), user.id, decisions);
    revalidatePath(safeNextPath(path));
    return { ok: true, message: `${r.applied} valeur(s) validée(s).` };
  } catch (e) {
    return failure(e);
  }
}

export async function saveManualPayrollAction(companyId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const { saveManualPayroll } = await import('@/lib/documents/service');
    await saveManualPayroll(await getDb(), user.id, companyId, input as never);
    revalidatePath(`/espace/entreprises/${companyId}/paie`);
    return { ok: true, message: 'Paie enregistrée.' };
  } catch (e) {
    return failure(e);
  }
}

export async function startAdvancedAuditAction(companyId: string): Promise<ActionResult> {
  const user = await requireUser();
  let auditId: string;
  try {
    const { createAdvancedAudit } = await import('@/lib/audit-service');
    const r = await createAdvancedAudit(await getDb(), user.id, companyId, todayInParis());
    await setAuditToken(r.auditId, r.token);
    auditId = r.auditId;
  } catch (e) {
    if (e instanceof AccessDenied) return { ok: false, message: 'Votre rôle ne permet pas de lancer une analyse.' };
    return failure(e);
  }
  redirect(`/audit/${auditId}?etape=7`);
}

// ---------------------------------------------------------------------------
// Dossiers et mandats
// ---------------------------------------------------------------------------

export async function startRecoveryAction(input: Record<string, unknown>): Promise<ActionResult> {
  const user = await requireUser();
  let target: string;
  try {
    const { startRecovery } = await import('@/lib/case-service');
    const { getSignatureProvider } = await import('@/lib/signature');
    const { getFileStore } = await import('@/lib/storage');
    const db = await getDb();
    const r = await startRecovery(db, getFileStore(), getSignatureProvider(), getMailer(db), user, input as never);
    target = `/espace/dossiers/${r.caseId}?signature=${r.signature}`;
  } catch (e) {
    return failure(e);
  }
  redirect(target);
}

export async function uploadCaseDocumentAction(companyId: string, caseId: string, formData: FormData): Promise<ActionResult> {
  const r = await uploadDocumentAction(companyId, formData);
  if (!r.ok) return r;
  const user = await requireUser();
  try {
    const db = await getDb();
    const file = formData.get('fichier') as File;
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex');
    const [doc] = await db.asUser(user.id, (q) => q.query<{ id: string }>(`select id::text from public.documents where company_id = $1 and sha256 = $2`, [companyId, sha]));
    if (doc) {
      const { attachDocumentToCase } = await import('@/lib/case-service');
      await attachDocumentToCase(db, user.id, caseId, doc.id);
    }
    revalidatePath(`/espace/dossiers/${caseId}`);
    return { ok: true, message: 'Justificatif déposé.' };
  } catch (e) {
    return failure(e);
  }
}

export async function markNotificationsReadAction(): Promise<void> {
  const user = await requireUser();
  const { markNotificationsRead } = await import('@/lib/case-service');
  await markNotificationsRead(await getDb(), user.id);
  revalidatePath('/espace');
}

// ---------------------------------------------------------------------------
// RGPD
// ---------------------------------------------------------------------------

export async function deleteMyAccountAction(confirmation: string): Promise<ActionResult> {
  const user = await requireUser();
  if (confirmation.trim().toLowerCase() !== user.email.toLowerCase()) return { ok: false, message: 'Saisissez votre adresse e-mail pour confirmer.' };
  try {
    const { deleteMyAccount } = await import('@/lib/privacy-service');
    const { getFileStore } = await import('@/lib/storage');
    await deleteMyAccount(await getDb(), getFileStore(), user);
    await signOut().catch(() => undefined);
  } catch (e) {
    return failure(e);
  }
  redirect('/?compte=supprime');
}
