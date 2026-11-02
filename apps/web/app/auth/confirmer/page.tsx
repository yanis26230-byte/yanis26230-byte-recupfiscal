import Link from 'next/link';
import { confirmSignInAction } from '@/app/actions';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { authProvider, inspectLocalLink } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confirmer la connexion', robots: { index: false } };

/**
 * Le lien reçu par e-mail ouvre cette page sans consommer le jeton : la connexion n'a lieu qu'au
 * clic sur « Me connecter » (POST). Les robots qui pré-ouvrent les liens ne le consomment donc pas.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ jeton?: string; token_hash?: string; type?: string; suivant?: string }> }) {
  const sp = await searchParams;
  let invalid = false;
  let email: string | null = null;
  if (authProvider() === 'local') {
    const state = sp.jeton ? await inspectLocalLink(sp.jeton) : { valid: false as const, reason: 'inconnu' as const };
    invalid = !state.valid;
    if (state.valid) email = state.email;
  } else invalid = !sp.token_hash;

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Card className="space-y-4">
        <h1 className="text-2xl font-bold">Connexion à votre espace</h1>
        {invalid ? (
          <>
            <Alert tone="danger">Ce lien de connexion n’est plus valable (déjà utilisé ou expiré).</Alert>
            <Link href="/connexion" className={buttonVariants({ className: 'w-full' })}>Recevoir un nouveau lien</Link>
          </>
        ) : (
          <form action={confirmSignInAction} className="space-y-4">
            {email && <p className="text-sm text-muted">Connexion avec <strong>{email}</strong></p>}
            <input type="hidden" name="jeton" value={sp.jeton ?? ''} />
            <input type="hidden" name="token_hash" value={sp.token_hash ?? ''} />
            <input type="hidden" name="type" value={sp.type ?? ''} />
            <input type="hidden" name="suivant" value={sp.suivant ?? ''} />
            <Button type="submit" size="lg" className="w-full">Me connecter</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
