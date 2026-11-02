import 'server-only';
import type { AuditAccess } from '@/lib/audit-service';
import { getCurrentUser } from '@/lib/auth';
import { getAuditToken } from './session';

export async function auditAccess(auditId: string): Promise<AuditAccess> {
  const user = await getCurrentUser();
  return { token: await getAuditToken(auditId), userId: user?.id ?? null };
}
