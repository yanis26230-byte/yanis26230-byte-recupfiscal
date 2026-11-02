import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { internalRole } from '@/lib/admin-service';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Back-office', robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/connexion?suivant=/admin');
  const role = await internalRole(await getDb(), user.id);
  if (!role) notFound();
  const links = [
    ['/admin', 'Indicateurs'], ['/admin/prospects', 'Prospects'], ['/admin/dossiers', 'Dossiers'],
    ...(role === 'administrateur' ? [['/admin/parametres', 'Paramètres'], ['/admin/moteur', 'Moteur'], ['/admin/zonages', 'Zonages'], ['/admin/commercial', 'Commercial'], ['/admin/utilisateurs', 'Équipe']] : []),
  ];
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Back-office · {role}</p>
      <nav className="mt-2 flex gap-1 overflow-x-auto border-b border-line pb-2" aria-label="Back-office">
        {links.map(([href, label]) => <Link key={href} href={href!} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium hover:bg-white">{label}</Link>)}
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}
