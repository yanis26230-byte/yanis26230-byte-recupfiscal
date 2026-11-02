import { StartAudit } from '@/components/audit/start-audit';

export const metadata = { title: 'Démarrer l’estimation' };

export default function StartPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <p className="text-sm font-semibold text-brand">Étape préalable</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Quelle est votre entreprise ?</h1>
      <p className="mt-2 text-muted">Nous pré-remplissons les informations publiques de l’entreprise. Vous pourrez les corriger.</p>
      <StartAudit />
    </div>
  );
}
