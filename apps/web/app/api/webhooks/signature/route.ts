import { Forbidden } from '@/lib/account-service';
import { handleSignatureWebhook } from '@/lib/case-service';
import { getDb } from '@/lib/db';
import { getMailer } from '@/lib/mail';
import { getSignatureProvider } from '@/lib/signature';
import { getFileStore } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Webhook du prestataire de signature : authentifié par HMAC, idempotent. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 100_000) return new Response('Trop volumineux', { status: 413 });
  try {
    const db = await getDb();
    const r = await handleSignatureWebhook(db, getFileStore(), getSignatureProvider(), getMailer(db), raw, req.headers.get('x-yousign-signature-256'));
    return Response.json({ ok: true, result: r });
  } catch (e) {
    if (e instanceof Forbidden) return new Response('Non autorisé', { status: 401 });
    console.error('webhook signature', e);
    return new Response('Erreur', { status: 500 });
  }
}
