export const metadata = { title: 'Mentions légales' };

export default function MentionsLegales() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-4 py-10 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold">Mentions légales</h1>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4">Les informations entre crochets doivent être complétées par l’éditeur avant toute mise en ligne publique.</p>
      <h2 className="text-lg font-semibold">Éditeur</h2>
      <p>[Raison sociale], [forme juridique] au capital de [montant] €, immatriculée au RCS de [ville] sous le numéro [SIREN], siège social : [adresse]. Directeur de la publication : [nom].</p>
      <h2 className="text-lg font-semibold">Hébergement</h2>
      <p>[Nom de l’hébergeur], [adresse], hébergement des données dans l’Union européenne.</p>
      <h2 className="text-lg font-semibold">Nature du service</h2>
      <p>Les estimations fournies reposent sur les informations déclarées par l’utilisateur. Elles ne constituent ni une validation fiscale ou sociale, ni une garantie de remboursement. Chaque opportunité doit être confirmée par une analyse documentaire.</p>
    </article>
  );
}
