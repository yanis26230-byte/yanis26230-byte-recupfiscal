import 'server-only';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { hashIp, rateLimit } from '@/lib/privacy-service';

/**
 * Limites par adresse IP (hachée) : protègent les actions publiques contre l'abus et l'énumération.
 * L'IP est lue dans X-Forwarded-For, posé par l'hébergeur (proxy de confiance).
 */
export const LIMITS = {
  recherche: { limit: 30, windowSeconds: 60 },
  creationAudit: { limit: 20, windowSeconds: 3600 },
  prospect: { limit: 10, windowSeconds: 3600 },
  lienConnexion: { limit: 10, windowSeconds: 3600 },
  depot: { limit: 60, windowSeconds: 3600 },
} as const;

export async function allow(action: keyof typeof LIMITS, extra = ''): Promise<boolean> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return true;
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip');
  const { limit, windowSeconds } = LIMITS[action];
  return rateLimit(await getDb(), `${action}:${hashIp(ip ?? null)}${extra ? `:${extra}` : ''}`, limit, windowSeconds);
}

export const TOO_MANY = 'Trop de demandes en peu de temps. Réessayez dans quelques minutes.';
