export const metadata = { title: 'Politique de confidentialité' };

export default function Confidentialite() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-4 py-10 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold">Politique de confidentialité</h1>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4">Projet de politique à faire valider par un professionnel (délégué à la protection des données ou conseil juridique) avant mise en ligne. Les éléments entre crochets sont à compléter.</p>
      <h2 className="text-lg font-semibold">Responsable du traitement</h2>
      <p>[Raison sociale], [adresse], contact : [adresse e-mail dédiée].</p>
      <h2 className="text-lg font-semibold">Données collectées</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Informations publiques sur l’entreprise (SIREN, raison sociale, établissements).</li>
        <li>Réponses au questionnaire : effectifs, répartition des salaires par tranche, dispositifs en place. Aucune donnée nominative sur les salariés n’est demandée.</li>
        <li>Coordonnées du contact (e-mail, prénom, téléphone facultatif) si vous demandez le détail de l’estimation.</li>
      </ul>
      <h2 className="text-lg font-semibold">Finalités et bases légales</h2>
      <p>Calcul de l’estimation (consentement recueilli avant le calcul) ; recontact au sujet de l’estimation (consentement recueilli à la saisie des coordonnées).</p>
      <h2 className="text-lg font-semibold">Durées de conservation</h2>
      <p>[Durée] pour les estimations sans suite ; [durée] pour les coordonnées des prospects ; durées légales pour les dossiers et la facturation.</p>
      <h2 className="text-lg font-semibold">Destinataires et hébergement</h2>
      <p>Données hébergées dans l’Union européenne. Aucune donnée n’est transmise à un fournisseur d’intelligence artificielle sans garanties contractuelles, ni utilisée pour entraîner des modèles.</p>
      <h2 className="text-lg font-semibold">Vos droits</h2>
      <p>Accès, rectification, effacement, opposition, limitation et portabilité : écrivez à [adresse e-mail]. Vous pouvez saisir la CNIL.</p>
    </article>
  );
}
