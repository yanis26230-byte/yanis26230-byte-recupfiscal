import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { signOutAction } from '@/app/actions';
import { getCurrentUser } from '@/lib/auth';
import { BRAND_NAME } from '@/lib/utils';

export const metadata: Metadata = {
  title: { default: `${BRAND_NAME} – Estimez vos cotisations récupérables`, template: `%s – ${BRAND_NAME}` },
  description: 'Découvrez gratuitement combien votre entreprise peut récupérer sur ses cotisations et ses aides, et combien elle peut économiser chaque année.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b1f3a' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  return (
    <html lang="fr">
      <body className="min-h-dvh font-sans antialiased">
        <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Aller au contenu</a>
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-base font-bold text-navy">{BRAND_NAME}</Link>
            <nav className="flex items-center gap-2" aria-label="Compte">
              {user ? (
                <>
                  <Link href="/espace" className="rounded-lg px-3 py-2 text-sm font-semibold text-navy hover:bg-surface">Mon espace</Link>
                  <form action={signOutAction}><button type="submit" className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface">Déconnexion</button></form>
                </>
              ) : (
                <>
                  <Link href="/connexion" className="rounded-lg px-3 py-2 text-sm font-semibold text-navy hover:bg-surface">Connexion</Link>
                  <Link href="/audit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Estimer</Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main id="contenu">{children}</main>
        <footer className="mt-16 border-t border-line bg-white">
          <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:justify-between">
            <p>© {new Date().getFullYear()} {BRAND_NAME}</p>
            <nav className="flex gap-4">
              <Link href="/mentions-legales" className="hover:text-navy">Mentions légales</Link>
              <Link href="/confidentialite" className="hover:text-navy">Confidentialité</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
