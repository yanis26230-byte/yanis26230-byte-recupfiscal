import 'server-only';
import { cookies, headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { getMailer, linkEmail } from '@/lib/mail';
import { consumeMagicLink, createMagicLink, inspectMagicLink, LINK_TTL_MINUTES, revokeSession, safeNextPath, sessionUser, type AuthUser, type LinkState } from './local-core';

export type { AuthUser } from './local-core';
export type AuthProviderName = 'local' | 'supabase';

const SESSION_COOKIE = 'rf_session';

/**
 * Fournisseur d'authentification.
 * - « supabase » : Supabase Auth (lien magique), cible de production du cahier des charges.
 * - « local » : lien magique maison pour le développement et les tests ; INTERDIT en production.
 */
export function authProvider(): AuthProviderName {
  const p = (process.env.AUTH_PROVIDER ?? (process.env.NODE_ENV === 'production' ? 'supabase' : 'local')) as AuthProviderName;
  if (p === 'local' && process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_AUTH !== 'true') {
    throw new Error('AUTH_PROVIDER=local est interdit en production : configurez Supabase Auth.');
  }
  return p;
}

/**
 * Origine des liens envoyés par e-mail. En production, APP_URL est obligatoire (jamais déduite
 * de l'en-tête Host, qui pourrait être falsifié pour détourner les liens).
 */
export async function appOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') throw new Error('APP_URL est requis en production');
  const h = await headers();
  return `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`;
}

async function supabaseServerClient() {
  const { createServerClient } = await import('@supabase/ssr');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requis');
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* composant serveur en lecture seule */ }
      },
    },
  });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (authProvider() === 'supabase') {
    const supabase = await supabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.email ? { id: data.user.id, email: data.user.email } : null;
  }
  return sessionUser(await getDb(), (await cookies()).get(SESSION_COOKIE)?.value);
}

export type SendLinkResult = { ok: true } | { ok: false; message: string };

/** Envoie un lien de connexion. Réponse identique que l'adresse corresponde ou non à un compte. */
export async function sendMagicLink(email: string, nextPath: string): Promise<SendLinkResult> {
  const next = safeNextPath(nextPath);
  const origin = await appOrigin();
  if (authProvider() === 'supabase') {
    const supabase = await supabaseServerClient();
    // Modèle d'e-mail Supabase à configurer : lien vers /auth/confirmer?token_hash={{ .TokenHash }}&type=email&suivant=...
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/confirmer?suivant=${encodeURIComponent(next)}` } });
    return error ? { ok: false, message: 'Envoi du lien impossible pour le moment. Réessayez dans quelques minutes.' } : { ok: true };
  }
  const db = await getDb();
  const r = await createMagicLink(db, email, next);
  if ('rateLimited' in r) return { ok: false, message: 'Trop de demandes pour cette adresse. Réessayez dans une heure.' };
  await getMailer(db).send(linkEmail({
    to: email,
    subject: 'Votre lien de connexion',
    intro: 'Voici votre lien de connexion à votre espace. Il est valable ' + LINK_TTL_MINUTES + ' minutes et ne peut servir qu’une fois.',
    cta: 'Me connecter',
    url: `${origin}/auth/confirmer?jeton=${encodeURIComponent(r.token)}`,
    outro: 'Si vous n’avez pas demandé ce lien, ignorez ce message.',
  }));
  return { ok: true };
}

export async function inspectLocalLink(jeton: string): Promise<LinkState> {
  return inspectMagicLink(await getDb(), jeton);
}

/** Termine la connexion (POST) : consomme le lien et ouvre la session. */
export async function completeSignIn(params: { jeton?: string; tokenHash?: string; type?: string; suivant?: string }): Promise<{ user: AuthUser; nextPath: string } | null> {
  if (authProvider() === 'supabase') {
    if (!params.tokenHash) return null;
    const supabase = await supabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ type: (params.type as 'email') ?? 'email', token_hash: params.tokenHash });
    if (error || !data.user?.email) return null;
    return { user: { id: data.user.id, email: data.user.email }, nextPath: safeNextPath(params.suivant) };
  }
  if (!params.jeton) return null;
  const r = await consumeMagicLink(await getDb(), params.jeton);
  if (!r) return null;
  (await cookies()).set(SESSION_COOKIE, r.sessionToken, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30,
  });
  return { user: r.user, nextPath: r.nextPath };
}

export async function signOut(): Promise<void> {
  if (authProvider() === 'supabase') {
    await (await supabaseServerClient()).auth.signOut();
    return;
  }
  const store = await cookies();
  await revokeSession(await getDb(), store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
}
