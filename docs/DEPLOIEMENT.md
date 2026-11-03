# Déploiement (staging et production)

Ce guide décrit la mise en service sur une infrastructure européenne. **Aucune de ces étapes n'a pu être exécutée depuis l'environnement de développement** (services externes injoignables) : elles sont à dérouler et à recetter sur staging avant la production.

## 1. Services à créer (région UE)

| Service | Usage | Variables |
|---|---|---|
| Supabase (projet en région UE, ex. Francfort/Paris) | PostgreSQL, Auth (lien magique), Storage privé | `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Brevo (ou autre prestataire UE) | E-mails transactionnels (invitations, notifications) + SMTP de Supabase Auth | `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` |
| Yousign (bac à sable puis production) | Signature électronique du mandat | `SIGNATURE_PROVIDER=yousign`, `YOUSIGN_API_KEY`, `YOUSIGN_WEBHOOK_SECRET`, `YOUSIGN_BASE_URL` |
| Hébergement Node.js (UE) | Application Next.js + processus de fond | voir ci-dessous |

## 2. Base de données

Depuis une copie du dépôt, avec la chaîne de connexion Supabase (pooler, mode session) :

```bash
DATABASE_URL="<chaîne Supabase>" pnpm --filter @recupfiscal/web migrate
```

L'exécuteur applique dans l'ordre les migrations non encore appliquées (une transaction par fichier, empreinte enregistrée, refus si une migration déjà appliquée a été modifiée), puis `supabase/seed.sql` (modules, paramètres officiels « à renseigner », cas de référence). Il n'applique **jamais** `supabase/local/` (réservé au développement). Le CLI Supabase (`supabase db push`) reste possible, mais ne mélangez pas les deux méthodes sur une même base.

Sauvegardes : activer la restauration à un instant donné (PITR) de Supabase ; tester une restauration sur staging avant l'ouverture.

## 3. Supabase Auth

- Fournisseur e-mail activé, inscription autorisée, SMTP personnalisé (prestataire UE).
- URL du site = `APP_URL` ; URL de redirection autorisée : `APP_URL/auth/confirmer`.
- Modèle « Magic Link » : lien vers `{{ .SiteURL }}/auth/confirmer?token_hash={{ .TokenHash }}&type=email&suivant=/espace` (flux sans PKCE, fonctionne sur un autre appareil ; la page demande un clic avant de consommer le lien).

## 4. Variables de l'application

| Variable | Production |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | URL publique en https (obligatoire : origine des liens envoyés par e-mail) |
| `AUTH_PROVIDER` | `supabase` (défaut en production ; `local` est refusé) |
| `MAIL_PROVIDER` | `brevo` (défaut en production) |
| `STORAGE_PROVIDER` | `supabase` (défaut en production) |
| `PARAMETER_DATASET` | `officiel` |
| `DEMO_ENABLED` | `false` en production (sauf instance de démonstration dédiée) |
| `COMPANY_SEARCH_BASE_URL` | `https://recherche-entreprises.api.gouv.fr` |
| `BOOTSTRAP_ADMIN_EMAILS` | adresse(s) du premier administrateur, à retirer ensuite |
| `IP_HASH_SALT` | valeur aléatoire secrète (hachage des IP pour la limitation de débit) |
| `RETENTION_*` | durées de conservation validées par le DPO |
| `ANTIVIRUS_PROVIDER=clamav`, `CLAMD_HOST`, `CLAMD_PORT` | démon ClamAV joignable en réseau privé ; analyse obligatoire en production (`ANTIVIRUS_REQUIRED`, défaut `true`) : sans lui, les dépôts sont refusés |
| `DATABASE_SSL_CA` / `DATABASE_SSL_CA_FILE` | certificat racine de la base (Supabase), connexion TLS toujours vérifiée |

Guide pas à pas pour Clever Cloud : [CLEVER-CLOUD.md](CLEVER-CLOUD.md).

## 5. Processus

- Application : `pnpm --filter @recupfiscal/web build` puis `pnpm --filter @recupfiscal/web start`.
- Processus de fond (extraction documentaire) : `pnpm --filter @recupfiscal/web worker` (un processus permanent).
- Purge quotidienne : `pnpm --filter @recupfiscal/web purge` (tâche planifiée).
- Webhook Yousign : `https://<domaine>/api/webhooks/signature`, événements `signature_request.done`, `.declined`, `.expired`.

## 6. Supervision

- Disponibilité : sonde HTTP sur `/api/sante` (base et file de traitement).
- Journaux : sortie standard en JSON (une ligne par événement), à collecter par l'hébergeur ; alerte sur `level=error`.
- Suivi des erreurs : brancher un service hébergé dans l'UE sur `lib/log.ts` (non configuré).

## 7. Avant toute ouverture commerciale (§19)

- [ ] Paramètres officiels saisis, sourcés, validés à quatre yeux et publiés (aucun n'est livré) : modèle CSV téléchargeable dans `/admin/parametres`, import en brouillons.
- [ ] Formules, hypothèses et correspondances DSN validées par un expert paie (voir `DECISIONS.md`, points « À VALIDER »).
- [ ] Conditions du mandat, politique de confidentialité, mentions légales, textes d'e-mails rédigés et validés par des professionnels du droit, puis publiés depuis le back-office.
- [ ] Modèle de rémunération et périmètre d'intervention validés juridiquement.
- [ ] Recette sur staging de Supabase Auth, Storage, Brevo, Yousign et de l'API Recherche d'entreprises.
- [ ] Démon ClamAV déployé (réseau privé) et `ANTIVIRUS_PROVIDER=clamav` configuré ; recette avec le fichier de test EICAR. OCR et fournisseur d'IA uniquement avec garanties contractuelles et hébergement conforme.
- [ ] Tests de restauration de sauvegarde ; registre des traitements ; analyse d'impact si nécessaire.
