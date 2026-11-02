import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { internalRole, type InternalRole } from '@/lib/admin-service';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

/** Contrôle d'accès de chaque page du back-office (404 si non autorisé : l'existence n'est pas révélée). */
export async function adminUser(level: InternalRole = 'analyste') {
  const user = await getCurrentUser();
  if (!user) redirect('/connexion?suivant=/admin');
  const role = await internalRole(await getDb(), user.id);
  if (!role || (level === 'administrateur' && role !== 'administrateur')) notFound();
  return user;
}
