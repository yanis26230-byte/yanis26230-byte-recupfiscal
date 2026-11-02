import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/account/login-form';
import { Alert, Card } from '@/components/ui/card';
import { authProvider, getCurrentUser } from '@/lib/auth';
import { safeNextPath } from '@/lib/auth/local-core';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connexion' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ suivant?: string; erreur?: string; email?: string }> }) {
  const sp = await searchParams;
  const next = safeNextPath(sp.suivant);
  if (await getCurrentUser()) redirect(next);
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Card className="space-y-4">
        <h1 className="text-2xl font-bold">Connexion</h1>
        <p className="text-sm text-muted">Pas de mot de passe : nous vous envoyons un lien de connexion par e-mail. Votre espace est créé à la première connexion.</p>
        {sp.erreur === 'lien' && <Alert tone="danger">Ce lien de connexion n’est plus valable (déjà utilisé ou expiré). Demandez-en un nouveau.</Alert>}
        <LoginForm next={next} defaultEmail={sp.email} devOutbox={authProvider() === 'local' && process.env.NODE_ENV !== 'production'} />
      </Card>
    </div>
  );
}
