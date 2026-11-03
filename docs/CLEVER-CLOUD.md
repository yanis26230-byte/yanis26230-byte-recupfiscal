# Déploiement sur Clever Cloud

Complément de [DEPLOIEMENT.md](DEPLOIEMENT.md) (Supabase, Brevo, Yousign, liste de contrôle). Configuration établie d'après la documentation publique de Clever Cloud ([Node.js](https://www.clever-cloud.com/developers/doc/applications/nodejs), [workers](https://developers.clever-cloud.com/doc/develop/workers), [CRON](https://developers.clever-cloud.com/doc/administrate/cron)) : **non testée sur Clever Cloud** depuis l'environnement de développement. À dérouler d'abord sur une application de préproduction.

## Ce que contient le dépôt

| Élément | Rôle |
|---|---|
| `package.json` → `engines.node` | Node 22 |
| `package.json` → `packageManager` | pnpm 10.28 (via Corepack) |
| script `clever:build` | installe **toutes** les dépendances (`--prod=false` : TypeScript et Tailwind sont nécessaires au build même avec `NODE_ENV=production`) puis construit l'application |
| script `clever:start` | démarre Next.js sur `0.0.0.0:8080` (port imposé par Clever Cloud) |
| script `clever:worker` | processus de fond : extraction documentaire |
| `clevercloud/cron.json` + `clevercloud/purge.sh` | purge RGPD quotidienne à 03:17 UTC |

## 1. Créer l'application (région Paris)

Avec la console Clever Cloud, ou avec Clever Tools :

```bash
npm install -g clever-tools
```

```bash
clever login
```

```bash
clever create --type node recupfiscal-preprod --region par
```

## 2. Variables de build et d'exécution

```bash
clever env set NODE_ENV production
```

```bash
clever env set CC_PRE_BUILD_HOOK "corepack enable"
```

```bash
clever env set CC_NODE_BUILD_TOOL custom
```

```bash
clever env set CC_CUSTOM_BUILD_TOOL "pnpm run clever:build"
```

```bash
clever env set CC_RUN_COMMAND "pnpm run clever:start"
```

```bash
clever env set CC_WORKER_COMMAND "pnpm run clever:worker"
```

Si `corepack enable` échoue au build, remplacez le hook par `npm install -g pnpm@10.28.0`.

## 3. Variables de l'application

À définir **avant le premier build** : les variables `NEXT_PUBLIC_*` et `APP_URL` sont lues au moment de la construction (politique de sécurité du contenu).

| Variable | Valeur |
|---|---|
| `APP_URL` | `https://votre-domaine` |
| `DATABASE_URL` | chaîne du **pooler Supabase, mode session** |
| `DATABASE_SSL_CA` | contenu du certificat racine Supabase (voir ci-dessous) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase (secret) |
| `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | Brevo |
| `IP_HASH_SALT` | longue valeur aléatoire (`openssl rand -hex 32`) |
| `BOOTSTRAP_ADMIN_EMAILS` | votre adresse, à retirer après la première connexion |
| `DEMO_ENABLED` | `false` |
| `COMPANY_SEARCH_BASE_URL` | `https://recherche-entreprises.api.gouv.fr` |
| `ANTIVIRUS_PROVIDER`, `CLAMD_HOST`, `CLAMD_PORT` | démon ClamAV (voir ci-dessous) |

### Certificat de la base (TLS vérifié)

La connexion à PostgreSQL vérifie **toujours** le certificat du serveur (les paramètres `sslmode` de l'URL sont ignorés et ne peuvent pas l'affaiblir).

1. Supabase → Database Settings → SSL Configuration → télécharger le certificat.
2. Le placer dans la variable `DATABASE_SSL_CA`. Une seule ligne avec des `\n` littéraux est acceptée :

```bash
clever env set DATABASE_SSL_CA "$(awk 'BEGIN{ORS="\\n"} {print}' prod-ca-2021.crt)"
```

Alternative : déposer le fichier et indiquer son chemin dans `DATABASE_SSL_CA_FILE`. Sans certificat fourni, la vérification utilise les autorités système ; si la connexion échoue avec une erreur de certificat, c'est cette variable qui manque.

### Antivirus

L'application Node.js n'embarque pas ClamAV : il faut un démon `clamd` joignable en **réseau privé** (par exemple le conteneur officiel `clamav/clamav` sur une machine ou un réseau privé de votre hébergeur ; ne jamais exposer le port 3310 sur Internet). Tant qu'il n'est pas configuré, les dépôts de documents sont **refusés** en production (`ANTIVIRUS_REQUIRED` vaut `true` par défaut). Recette : déposer le fichier de test EICAR, qui doit être bloqué.

## 4. Déployer

Clever Cloud déploie par git : poussez la branche `main` vers le dépôt git de l'application (ou reliez le dépôt GitHub dans la console).

```bash
clever deploy
```

## 5. Vérifier

```bash
clever logs
```

- `https://<application>.cleverapps.io/api/sante` doit renvoyer `"status":"ok"` et `"database":"ok"`.
- Les journaux du processus de fond affichent `worker démarré`.
- Le lendemain, une ligne `purge` doit apparaître vers 03:17 UTC.

## 6. Domaine et dimensionnement

```bash
clever domain add www.votre-domaine.fr
```

Configurez ensuite le DNS indiqué par Clever Cloud (certificat HTTPS automatique). Pour plusieurs instances : la purge est idempotente, et la file de traitement utilise des verrous (`skip locked`), donc plusieurs processus de fond peuvent coexister.

## 7. Production

Une fois la préproduction recettée (voir la liste de contrôle de `DEPLOIEMENT.md`), créez une seconde application `recupfiscal-prod` avec ses propres projets Supabase et clés, et répétez les étapes 1 à 6.
