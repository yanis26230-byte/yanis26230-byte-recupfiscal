# Livraison du projet

Plateforme de récupération fiscale et sociale pour PME françaises (5 à 50 salariés) : audit rétroactif, optimisation future, paiement au résultat. Livraison des phases 1 à 9 du cahier des charges, plus l'antivirus et la saisie en lot des paramètres.

> **État : prêt pour une recette en préproduction, pas pour une ouverture commerciale.** L'application est complète et testée, mais (1) aucun paramètre réglementaire officiel n'est livré — volontairement, aucune valeur n'est inventée —, donc aucun montant réel n'est calculé tant qu'ils ne sont pas saisis et validés ; (2) les textes juridiques sont à rédiger ; (3) les services externes n'ont pas pu être testés en conditions réelles depuis l'environnement de développement.

## 1. Ce qui est livré

### Pour le dirigeant (sans compte)
- Accueil, démarrage par SIREN (API Recherche d'entreprises, saisie manuelle de secours), questionnaire du mode rapide en 7 étapes (sauvegarde automatique, retour arrière, aide adaptée au secteur), résultats immédiats en trois indicateurs séparés (récupération passée, commission indicative, économies futures), mention obligatoire.
- Démonstration « Boulangerie Démo » (entreprise et paramètres fictifs, clairement signalés).

### Pour le client (avec compte)
- Connexion sans mot de passe (lien magique), rattachement automatique de l'estimation et de l'entreprise, reprise sur un autre appareil.
- Espace client : entreprises, estimations, détail par dispositif, rapport PDF, membres et invitations (propriétaire, collaborateur, comptable invité), notifications.
- Mode avancé : dépôt de DSN, journaux de paie (modèle CSV/XLSX), notifications de taux AT, autres pièces ; antivirus ; extraction automatique sans IA ; validation, correction ou rejet de chaque valeur lue ; saisie manuelle de la paie ; calcul salarié par salarié.
- « Je veux récupérer cet argent » : conditions, déclaration d'habilitation, mandat (taux figé), signature électronique (Yousign, désactivée par défaut et jamais simulée), dossier avec chronologie, justificatifs, remboursements et commissions.
- Mon compte : export de toutes ses données, suppression du compte.

### Pour l'équipe interne (`/admin`)
- Indicateurs et conversion, prospects, dossiers (statuts contrôlés, vérification de l'entreprise, demandes de pièces, commentaires internes, remboursements, commissions), revue des opportunités par un analyste.
- Paramètres réglementaires : modèle CSV et import en brouillons, validation par un second administrateur, publication avec relance des cas de référence, historique des versions, « règles à compléter ».
- Modules, zonages (import sourcé), conditions commerciales et textes versionnés, équipe, journal des actions sensibles.

### Moteur de calcul
Cinq modules (réduction générale et RGDU, aides à l'embauche, taux AT, zonages, simulateur d'épargne salariale), paramètres versionnés et datés, délais de réclamation, règles de cumul, calculs reproductibles et rejouables, cas de référence calculés à la main.

## 2. Qualité

| Contrôle | Résultat |
|---|---|
| Typage TypeScript strict | ✅ |
| Tests du moteur | 116 |
| Tests de la base (migrations, règles d'accès par entreprise, règles métier) | 69 |
| Tests de l’application (services, sécurité, RGPD, PDF, documents, antivirus) | 129 |
| Tests de bout en bout dans un navigateur (smartphone, tablette, ordinateur) | 29 |
| Intégration continue GitHub Actions | à chaque push sur `main` |

Correspondance avec les 15 critères d'acceptation : [RECETTE.md](RECETTE.md).

## 3. Démarrer

En local (aucun service externe nécessaire : base PostgreSQL embarquée, e-mails visibles sur `/dev/emails`) — guide détaillé : [DEMARRAGE.md](DEMARRAGE.md) :

```bash
pnpm install
```

```bash
pnpm dev
```

Production : [DEPLOIEMENT.md](DEPLOIEMENT.md) (services, variables, liste de contrôle) et [CLEVER-CLOUD.md](CLEVER-CLOUD.md) (pas à pas, testé en simulation locale du build et du démarrage, pas sur Clever Cloud).

## 4. Ce qui reste à faire avant l'ouverture commerciale

| # | Action | Qui |
|---|---|---|
| 1 | Créer les services : Supabase (UE), Brevo, Yousign, hébergement, démon ClamAV ; recette en préproduction | technique |
| 2 | Saisir, sourcer, faire valider et publier **tous** les paramètres officiels (modèle CSV dans `/admin/parametres`) | expert paie + 2 administrateurs |
| 3 | Valider les formules et hypothèses (points ci-dessous) | expert paie / fiscaliste |
| 4 | Rédiger et publier les conditions du mandat, la politique de confidentialité, les mentions légales, les textes d'e-mails | juriste |
| 5 | Valider le modèle de rémunération, le périmètre d'intervention et les durées de conservation | juriste, DPO |
| 6 | Recette manuelle sur appareils réels (dont iPhone : seul Chromium a été testé) | équipe produit |

## 5. Points à valider par un expert (détail dans [DECISIONS.md](../DECISIONS.md))

- **D-009** Formules de la réduction générale et de la RGDU, SMIC de référence, cas non traités (caisse de congés payés du BTP, déduction forfaitaire spécifique, absences, entrées et sorties, forfaits jours).
- **D-011** Délai de réclamation et date de paiement réputée des cotisations.
- **D-020** Liens précis vers les textes officiels pour chaque paramètre.
- **D-022** Indépendance entre correction du taux AT et réduction générale.
- **D-023** Aides à l'embauche : date de conclusion, prorata, conditions d'âge.
- **D-026** Simulateur : approximation de l'impôt, tranches d'effectif, régime de la PPV.
- **D-032** Années couvertes par le mode rapide.
- **D-034** Textes d'aide sectorielle.
- **D-041** Vérification du rattachement d'un compte à une entreprise.
- **D-048** Correspondances des rubriques DSN.
- **D-060** Durées de conservation des données.

## 6. Non testé en conditions réelles

Ces intégrations sont écrites, désactivées ou configurables, et testées contre des doublures reproduisant leurs protocoles, mais pas contre les services réels (injoignables depuis l'environnement de développement) : API Recherche d'entreprises, Supabase Auth et Storage, Brevo, Yousign, ClamAV, Clever Cloud. Non activés : OCR des documents scannés, extraction par IA.
