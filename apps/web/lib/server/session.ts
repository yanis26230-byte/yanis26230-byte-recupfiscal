import 'server-only';
import { cookies } from 'next/headers';

const cookieName = (auditId: string) => `rf_audit_${auditId}`;

/** Jeton d'accès à un audit anonyme : cookie httpOnly, jamais lisible par le JavaScript de la page. */
export async function setAuditToken(auditId: string, token: string) {
  (await cookies()).set(cookieName(auditId), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getAuditToken(auditId: string): Promise<string | undefined> {
  return (await cookies()).get(cookieName(auditId))?.value;
}

/** Date du jour à Paris (AAAA-MM-JJ). */
export function todayInParis(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function demoEnabled(): boolean {
  if (process.env.DEMO_ENABLED) return process.env.DEMO_ENABLED === 'true';
  return process.env.NODE_ENV !== 'production';
}

export function magicLinkEnabled(): boolean {
  return process.env.MAGIC_LINK_ENABLED === 'true';
}
