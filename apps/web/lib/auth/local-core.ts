import { createHash, randomBytes } from 'node:crypto';
import type { Database, Queryable } from '../db/database';

/**
 * Authentification locale par lien magique (développement et tests).
 * - Jeton aléatoire de 256 bits, stocké haché, valable 15 minutes, à usage unique.
 * - Consommé par une action POST (bouton « Se connecter ») : un robot de messagerie qui ouvre
 *   le lien ne le consomme pas.
 * - Sessions : jeton aléatoire haché, 30 jours, révocables.
 * - Limite : 5 liens par adresse et par heure ; réponse identique que l'adresse existe ou non.
 */
export const LINK_TTL_MINUTES = 15;
export const SESSION_TTL_DAYS = 30;
export const MAX_LINKS_PER_HOUR = 5;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('base64url');

export interface AuthUser { id: string; email: string }

export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\r\n]/.test(next)) return '/espace';
  return next.slice(0, 500);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createMagicLink(db: Queryable, email: string, nextPath: string): Promise<{ token: string } | { rateLimited: true }> {
  const e = normalizeEmail(email);
  const [recent] = await db.query<{ n: number }>(`select count(*)::int as n from local_auth.magic_links where lower(email) = $1 and created_at > now() - interval '1 hour'`, [e]);
  if ((recent?.n ?? 0) >= MAX_LINKS_PER_HOUR) return { rateLimited: true };
  const t = token();
  await db.query(`insert into local_auth.magic_links (email, token_hash, next_path, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4))`,
    [e, sha256(t), safeNextPath(nextPath), LINK_TTL_MINUTES]);
  return { token: t };
}

export type LinkState = { valid: true; email: string; nextPath: string } | { valid: false; reason: 'inconnu' | 'expire' | 'utilise' };

export async function inspectMagicLink(db: Queryable, t: string): Promise<LinkState> {
  const [l] = await db.query<{ email: string; next_path: string; expired: boolean; used: boolean }>(
    `select email, next_path, expires_at < now() as expired, used_at is not null as used from local_auth.magic_links where token_hash = $1`, [sha256(t)]);
  if (!l) return { valid: false, reason: 'inconnu' };
  if (l.used) return { valid: false, reason: 'utilise' };
  if (l.expired) return { valid: false, reason: 'expire' };
  return { valid: true, email: l.email, nextPath: l.next_path };
}

/** Consomme le lien (une seule fois), crée l'utilisateur si besoin et ouvre une session. */
export async function consumeMagicLink(db: Database, t: string): Promise<{ user: AuthUser; sessionToken: string; nextPath: string } | null> {
  const sessionToken = token();
  return db.transaction(async (tx) => {
    const [l] = await tx.query<{ email: string; next_path: string }>(
      `update local_auth.magic_links set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning email, next_path`, [sha256(t)]);
    if (!l) return null;
    let [u] = await tx.query<{ id: string; email: string }>(`select id::text, email from auth.users where lower(email) = $1`, [l.email]);
    if (!u) [u] = await tx.query<{ id: string; email: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id::text, email`, [l.email]);
    await tx.query(`insert into local_auth.sessions (user_id, token_hash, expires_at) values ($1, $2, now() + make_interval(days => $3))`, [u!.id, sha256(sessionToken), SESSION_TTL_DAYS]);
    return { user: u!, sessionToken, nextPath: l.next_path };
  });
}

export async function sessionUser(db: Queryable, sessionToken: string | undefined): Promise<AuthUser | null> {
  if (!sessionToken) return null;
  const [u] = await db.query<AuthUser>(
    `select u.id::text, u.email from local_auth.sessions s join auth.users u on u.id = s.user_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`, [sha256(sessionToken)]);
  return u ?? null;
}

export async function revokeSession(db: Queryable, sessionToken: string | undefined): Promise<void> {
  if (sessionToken) await db.query(`update local_auth.sessions set revoked_at = now() where token_hash = $1`, [sha256(sessionToken)]);
}
