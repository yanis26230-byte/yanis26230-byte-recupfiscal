import { redirect } from 'next/navigation';
import { DeleteAccount } from '@/components/account/delete-account';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/auth';
import { RETENTION } from '@/lib/privacy-service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mon compte', robots: { index: false } };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/connexion?suivant=/espace/compte');
  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <h1 className="text-2xl font-bold">Mon compte</h1>
      <Card className="space-y-2">
        <h2 className="font-semibold">Mes données</h2>
        <p className="text-sm text-muted">Téléchargez l’ensemble de vos données (profil, entreprises, estimations, réponses, documents référencés, notifications, consentements) dans un fichier réutilisable.</p>
        <a href="/espace/compte/export" className="inline-block rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold" data-testid="export-link">Exporter mes données</a>
      </Card>
      <Card className="space-y-2 text-sm">
        <h2 className="font-semibold">Durées de conservation</h2>
        <ul className="list-disc pl-5 text-muted">
          <li>Estimation sans compte : {RETENTION.anonymousAuditDays} jours.</li>
          <li>Coordonnées de prospect sans compte : {Math.round(RETENTION.leadInactiveDays / 365)} ans après le dernier contact, puis anonymisation.</li>
          <li>Dossiers de récupération, mandats et facturation : durée légale de conservation des pièces.</li>
        </ul>
      </Card>
      <Card className="space-y-2">
        <h2 className="font-semibold">Supprimer mon compte</h2>
        <p className="text-sm text-muted">Supprime votre profil, vos estimations personnelles, les entreprises dont vous êtes le seul membre (sans démarche engagée) et anonymise vos coordonnées de prospect. Action définitive.</p>
        <DeleteAccount email={user.email} />
      </Card>
    </div>
  );
}
