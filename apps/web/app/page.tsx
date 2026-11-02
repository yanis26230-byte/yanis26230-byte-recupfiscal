import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getCommissionRate } from '@/lib/server/settings';
import { demoEnabled } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const PILLARS = [
  { title: 'Audit rétroactif', text: 'Nous recherchons les cotisations payées en trop et les aides non perçues sur les périodes encore légalement réclamables.' },
  { title: 'Optimisation future', text: 'Nous identifions des leviers pour baisser le coût employeur à net égal, ou augmenter le net de vos salariés à coût égal.' },
  { title: 'Paiement au résultat', text: 'Le questionnaire, l’estimation et le rapport sont gratuits. Vous ne payez que sur les sommes réellement récupérées.' },
];

const SCHEMES = [
  { title: 'Réduction générale des cotisations patronales', text: 'Vérification de la réduction appliquée sur vos salaires, y compris la réduction dégressive à partir de 2026.' },
  { title: 'Aides à l’apprentissage et à l’alternance', text: 'Contrôle des aides perçues pour chaque contrat et des délais de demande.' },
  { title: 'Taux accident du travail', text: 'Comparaison, établissement par établissement, du taux notifié et du taux appliqué en paie.' },
  { title: 'Zonages et exonérations locales', text: 'Recherche des dispositifs liés à la commune de vos établissements, à partir des tables officielles.' },
  { title: 'Épargne salariale et rémunération', text: 'Simulation de l’intéressement, de l’abondement, de la prime de partage de la valeur et des titres-restaurant.' },
];

export default async function Home({ searchParams }: { searchParams: Promise<{ compte?: string }> }) {
  const { compte } = await searchParams;
  const rate = await getCommissionRate();
  const pct = `${Math.round(rate * 100)} %`;
  const faq = [
    { q: 'L’estimation est-elle vraiment gratuite ?', a: 'Oui. Le questionnaire, l’estimation et le rapport ne sont jamais facturés. Une commission n’est due que sur un remboursement effectivement obtenu.' },
    { q: `Comment est calculée la commission de ${pct} ?`, a: `Elle porte uniquement sur les remboursements rétroactifs réellement encaissés par votre entreprise. Si rien n’est récupéré, vous ne payez rien. Les économies futures que nous identifions ne sont pas commissionnées.` },
    { q: 'Quelles données dois-je fournir ?', a: 'Pour l’estimation rapide : le SIREN, l’effectif, la répartition des salaires par tranche et quelques informations sur vos dispositifs. Aucun nom ni numéro de sécurité sociale de salarié n’est demandé.' },
    { q: 'Les montants affichés sont-ils garantis ?', a: 'Non. Ce sont des estimations fondées sur vos réponses. Chaque opportunité doit être confirmée par l’analyse de vos documents avant toute démarche.' },
    { q: 'Sur quelle période portent les récupérations ?', a: 'Uniquement sur les périodes encore réclamables au regard des délais légaux. Les périodes prescrites sont signalées comme non récupérables.' },
  ];
  return (
    <div>
      {compte === 'supprime' && <p role="status" className="bg-green-50 px-4 py-3 text-center text-sm text-green-900">Votre compte et vos données ont été supprimés.</p>}
      <section className="bg-navy text-white">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:py-20">
          <h1 className="max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">
            Votre entreprise paie peut-être trop de cotisations. Découvrez combien vous pourriez récupérer.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-blue-100">
            Découvrez gratuitement combien votre entreprise peut récupérer sur ses cotisations et ses aides des trois dernières années, et combien elle peut économiser chaque année.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/audit" className={buttonVariants({ size: 'lg', className: 'bg-white text-navy hover:bg-blue-50' })}>Estimer mes économies gratuitement</Link>
            {demoEnabled() && <Link href="/demo" className={buttonVariants({ size: 'lg', variant: 'ghost', className: 'text-white hover:bg-white/10' })}>Voir un exemple fictif</Link>}
          </div>
          <p className="mt-4 text-sm text-blue-200">5 à 10 minutes, sans document, sans création de compte.</p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="text-2xl font-bold">Trois façons de faire baisser vos charges</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {PILLARS.map((p) => <Card key={p.title}><h3 className="font-semibold">{p.title}</h3><p className="mt-2 text-sm text-muted">{p.text}</p></Card>)}
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <h2 className="text-2xl font-bold">Paiement au résultat, sans surprise</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            <li className="rounded-2xl bg-surface p-5"><p className="text-sm font-semibold text-brand">1. Estimation gratuite</p><p className="mt-2 text-sm text-muted">Vous répondez au questionnaire et obtenez une fourchette, sans engagement.</p></li>
            <li className="rounded-2xl bg-surface p-5"><p className="text-sm font-semibold text-brand">2. Analyse de vos documents</p><p className="mt-2 text-sm text-muted">Si vous le souhaitez, nous vérifions chaque opportunité sur pièces avant toute démarche.</p></li>
            <li className="rounded-2xl bg-surface p-5"><p className="text-sm font-semibold text-brand">3. {pct} sur le récupéré</p><p className="mt-2 text-sm text-muted">Notre commission porte uniquement sur les sommes réellement remboursées. Rien n’est dû sinon.</p></li>
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="text-2xl font-bold">Les dispositifs analysés</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {SCHEMES.map((s) => <li key={s.title}><Card className="h-full"><h3 className="font-semibold">{s.title}</h3><p className="mt-2 text-sm text-muted">{s.text}</p></Card></li>)}
        </ul>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <h2 className="text-2xl font-bold">Sécurité et confidentialité</h2>
          <ul className="mt-6 grid gap-3 text-sm text-muted sm:grid-cols-2">
            <li className="rounded-xl bg-surface p-4">Aucune donnée nominative sur vos salariés n’est demandée pour l’estimation.</li>
            <li className="rounded-xl bg-surface p-4">Vos réponses sont enregistrées sur des serveurs situés dans l’Union européenne et accessibles uniquement depuis votre navigateur ou votre compte.</li>
            <li className="rounded-xl bg-surface p-4">Les montants sont calculés par des règles déterministes et traçables, jamais par une intelligence artificielle.</li>
            <li className="rounded-xl bg-surface p-4">Vos données ne servent jamais à entraîner des modèles et peuvent être supprimées sur simple demande.</li>
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-12">
        <h2 className="text-2xl font-bold">Questions fréquentes</h2>
        <div className="mt-6 divide-y divide-line rounded-2xl border border-line bg-white">
          {faq.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="cursor-pointer list-none font-medium marker:hidden">{f.q}</summary>
              <p className="mt-3 text-sm text-muted">{f.a}</p>
            </details>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link href="/audit" className={buttonVariants({ size: 'lg' })}>Estimer mes économies gratuitement</Link>
        </div>
      </section>
    </div>
  );
}
