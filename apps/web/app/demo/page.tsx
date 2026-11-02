import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { startDemoAction } from '@/app/actions';
import { demoEnabled } from '@/lib/server/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Démonstration' };

export default function DemoPage() {
  if (!demoEnabled()) notFound();
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Card>
        <h1 className="text-2xl font-bold">Exemple : Boulangerie Démo</h1>
        <Alert tone="warn" className="mt-4">
          Entreprise <strong>fictive</strong>, calculée avec des <strong>paramètres de test fictifs</strong> qui ne correspondent pas à la réglementation réelle.
          Les montants servent uniquement à illustrer le fonctionnement de la plateforme.
        </Alert>
        <p className="mt-4 text-sm text-muted">12 salariés dont 2 apprentis, un établissement, et quelques anomalies volontaires : réduction de cotisations sous-appliquée, taux accident du travail erroné, aide à l’apprentissage incomplète.</p>
        <form action={startDemoAction} className="mt-6"><Button type="submit" size="lg" className="w-full">Parcourir l’exemple</Button></form>
      </Card>
    </div>
  );
}
