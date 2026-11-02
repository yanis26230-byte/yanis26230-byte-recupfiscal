import Link from 'next/link';
import { AcceptInvitation } from '@/components/account/accept-invitation';
import { buttonVariants } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { inspectInvitation, ROLE_LABELS } from '@/lib/account-service';
import { getCurrentUser } from '@/lib/auth';
import { normalizeEmail } from '@/lib/auth/local-core';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invitation', robots: { index: false } };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await inspectInvitation(await getDb(), token);
  const user = await getCurrentUser();
  const here = `/invitation/${encodeURIComponent(token)}`;
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Card className="space-y-4">
        <h1 className="text-2xl font-bold">Invitation</h1>
        {inv.status !== 'valide' ? (
          <Alert tone="warn">
            {inv.status === 'acceptee' && 'Cette invitation a déjà été acceptée.'}
            {inv.status === 'expiree' && 'Cette invitation a expiré. Demandez une nouvelle invitation au propriétaire de l’entreprise.'}
            {inv.status === 'revoquee' && 'Cette invitation a été annulée.'}
            {inv.status === 'inconnue' && 'Invitation introuvable.'}
          </Alert>
        ) : (
          <>
            <p>Vous êtes invité à rejoindre <strong>{inv.companyName}</strong> en tant que <strong>{ROLE_LABELS[inv.role]?.toLowerCase()}</strong>.</p>
            {!user && (
              <>
                <p className="text-sm text-muted">Connectez-vous avec l’adresse invitée ({inv.email}) pour accepter.</p>
                <Link className={buttonVariants({ className: 'w-full' })} href={`/connexion?suivant=${encodeURIComponent(here)}&email=${encodeURIComponent(inv.email)}`}>Me connecter pour accepter</Link>
              </>
            )}
            {user && normalizeEmail(user.email) !== normalizeEmail(inv.email) && (
              <Alert tone="danger">Vous êtes connecté avec {user.email}, mais cette invitation est réservée à {inv.email}.</Alert>
            )}
            {user && normalizeEmail(user.email) === normalizeEmail(inv.email) && <AcceptInvitation token={token} />}
          </>
        )}
      </Card>
    </div>
  );
}
