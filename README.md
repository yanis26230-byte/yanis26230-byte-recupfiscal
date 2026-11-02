# Plateforme de récupération fiscale et sociale pour PME

Audit rétroactif des cotisations et aides, optimisation future, paiement au résultat.
Référence permanente : le cahier des charges du projet. Feuille de route : [PHASES.md](PHASES.md). Décisions : [DECISIONS.md](DECISIONS.md). Déploiement : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md). Recette : [docs/RECETTE.md](docs/RECETTE.md).

## Structure

```
apps/web/               Application Next.js : parcours public, espace client, mode avancé, dossiers, back-office (/admin)
  app/                    Pages et actions serveur
  components/             Questionnaire, formulaires, composants d'interface
  lib/                    Services serveur (audits, recherche d'entreprises, base), questionnaire
  e2e/                    Tests Playwright (smartphone, tablette, ordinateur)
packages/engine/        Moteur de calcul TypeScript pur (Vitest)
  src/parameters.ts       Résolution stricte des paramètres versionnés
  src/claim.ts            Délai de réclamation mois par mois
  src/cumulation.ts       Règles de cumul par assiette
  src/engine.ts           Exécution, calculation_runs, empreintes, rejeu
  src/commercial.ts       Commission indicative / commission réelle
  src/reference-data.ts   Zonages et dispositifs zonaux versionnés
  src/modules/            Un dossier par dispositif : M1 réduction générale, M2 aides à l'embauche,
                          M3 taux AT, M4 zonages, M5 simulateur épargne salariale
  src/reference-cases/    Cas de référence par module (valeurs calculées à la main)
  src/fixtures/           Paramètres officiels (à renseigner), paramètres et zonages de TEST, Boulangerie Démo
packages/db-tests/      Tests des migrations et de la RLS sur PostgreSQL (PGlite)
supabase/migrations/    Schéma, triggers métier, politiques RLS
supabase/local/         Socle Supabase minimal pour PGlite (tests et développement)
docs/captures/          Captures d'écran smartphone
supabase/seed.sql       Généré : modules, paramètres officiels « à renseigner », cas de référence
```

## Commandes

```bash
pnpm install
```

```bash
pnpm test
```

```bash
pnpm typecheck
```

```bash
pnpm dev
```

Sans `DATABASE_URL`, l'application crée une base PostgreSQL locale (PGlite) dans `apps/web/.data/`. En développement, la connexion utilise un lien magique local et les e-mails sont visibles sur http://localhost:3000/dev/emails. Voir `apps/web/.env.example` pour Supabase Auth et Brevo en production.

```bash
pnpm test:e2e
```

Processus de fond et maintenance (production) :

```bash
pnpm --filter @recupfiscal/web worker
```

```bash
pnpm --filter @recupfiscal/web purge
```

Premier administrateur : `BOOTSTRAP_ADMIN_EMAILS` (voir `docs/DEPLOIEMENT.md`) ou :

```bash
pnpm --filter @recupfiscal/web admin:grant <email> administrateur
```

```bash
pnpm --filter @recupfiscal/engine seed:generate
```

## Règles absolues rappelées dans le code
- Aucun taux, plafond ou montant inventé : le jeu officiel est livré « à renseigner ».
- Un paramètre manquant ou non publié bloque le calcul de la période concernée.
- Aucun montant produit par une IA ; estimation, montant validé et montant récupéré restent séparés.
- La Boulangerie Démo est fictive et utilise exclusivement des paramètres de test fictifs.
