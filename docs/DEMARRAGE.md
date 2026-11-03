# Lancer l'application sur votre ordinateur

Aucun service externe n'est nécessaire : la base de données est intégrée, et les e-mails (liens de connexion, invitations) s'affichent dans une page de l'application au lieu d'être envoyés. Testé sur un clone neuf du dépôt.

## 1. Prérequis (une seule fois)

1. Installer **Node.js 22 LTS** : https://nodejs.org (bouton « LTS »).
2. Installer **Git** : https://git-scm.com (sur Mac, il est proposé automatiquement à la première commande `git`).
3. Ouvrir un terminal (Windows : « Terminal » ou « PowerShell » ; Mac : « Terminal ») et activer pnpm, livré avec Node.js :

```bash
corepack enable
```

Sous Windows, si un message parle de droits, relancez le terminal en tant qu'administrateur pour cette commande seulement.

## 2. Récupérer le projet (une seule fois)

Le dépôt est privé : Git vous demandera de vous connecter à GitHub.

```bash
git clone https://github.com/yanis26230-byte/yanis26230-byte-recupfiscal.git
```

```bash
cd yanis26230-byte-recupfiscal
```

```bash
pnpm install
```

Sans Git : sur la page du dépôt GitHub, bouton « Code » puis « Download ZIP », décompressez, ouvrez un terminal dans le dossier et lancez `pnpm install`.

## 3. Devenir administrateur (facultatif, une seule fois)

Pour accéder au back-office, créez le fichier `apps/web/.env.local` contenant votre adresse :

```
BOOTSTRAP_ADMIN_EMAILS=votre.adresse@exemple.fr
```

À votre première connexion avec cette adresse, vous deviendrez administrateur (uniquement si aucun administrateur n'existe encore).

## 4. Lancer

```bash
pnpm dev
```

Attendez le message `Ready`, puis ouvrez **http://localhost:3000** dans votre navigateur. Le premier affichage de chaque page prend quelques secondes (compilation à la volée). Pour arrêter : `Ctrl + C` dans le terminal.

## 5. Que tester

| Pour… | Aller sur |
|---|---|
| Voir un exemple complet avec des montants (entreprise et paramètres **fictifs**) | http://localhost:3000/demo |
| Faire une estimation comme un dirigeant | http://localhost:3000/audit (« Saisie manuelle » : l'API publique des entreprises peut être lente ou bloquée) |
| Vous connecter | http://localhost:3000/connexion puis ouvrez le lien reçu sur **http://localhost:3000/dev/emails** |
| Le back-office | http://localhost:3000/admin (après connexion avec l'adresse de l'étape 3) |
| L'état de l'application | http://localhost:3000/api/sante |

**Pourquoi « Aucun montant chiffré » sur une estimation réelle ?** Les paramètres réglementaires officiels (SMIC, coefficients, montants d'aides…) sont livrés « à renseigner » : aucun n'est inventé. Seule la démonstration, qui utilise des paramètres fictifs, affiche des montants. Pour chiffrer une estimation réelle, saisissez et publiez les paramètres dans `/admin/parametres` (modèle CSV disponible ; la publication exige la validation d'un second administrateur : invitez un deuxième compte dans `/admin/utilisateurs`).

## 6. Repartir de zéro

Arrêtez l'application, supprimez le dossier `apps/web/.data`, relancez `pnpm dev` : une base neuve est créée.

## 7. Vérifier que tout fonctionne

```bash
pnpm test
```

Lance les 317 tests (moteur, base de données, application) en quelques minutes.
