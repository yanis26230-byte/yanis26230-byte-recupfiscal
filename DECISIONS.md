# Journal des décisions techniques

Chaque décision : contexte, choix, conséquences. Les points marqués **[À VALIDER]** doivent être confirmés par un expert humain (paie / URSSAF / fiscalité / juridique) avant toute mise en production.

---

## Phase 1 – Fondations et moteur

### D-001 Monorepo pnpm
- `packages/engine` : moteur de calcul TypeScript pur (aucune dépendance d'exécution).
- `packages/db-tests` : tests des migrations SQL et de la RLS.
- `supabase/` : migrations et seed. `apps/web` (Next.js) arrivera en phase 3.
- Le moteur ne dépend ni de Next.js ni de Supabase : il peut être appelé par une action serveur, une tâche de fond ou un script de rejeu.

### D-002 Moteur déterministe et traçable
- `runCalculation(input, { modules, parameters, dataset })` est une fonction pure : pas d'horloge (la date de référence `asOfDate` fait partie des entrées figées), pas d'aléa, pas d'IA.
- Le résultat (`CalculationRunRecord`) contient : version du moteur, version de chaque module, identifiants **et copie** des paramètres utilisés, entrées figées, opportunités, conflits de cumul, totaux, empreintes SHA-256 des entrées et des sorties (JSON canonique, clés triées).
- `replayCalculation` rejoue un calcul avec exactement les mêmes identifiants de paramètres, même s'ils ont été archivés entre-temps, et compare l'empreinte de sortie. Une version de module différente fait échouer le rejeu explicitement.
- L'empreinte utilise `node:crypto` : le moteur s'exécute côté serveur uniquement (choix assumé ; les estimations ne sont jamais calculées dans le navigateur).

### D-003 Deux jeux de paramètres strictement séparés
- `dataset = 'officiel' | 'test'`. Un calcul utilise un seul jeu. Les paramètres de test (Boulangerie Démo, tests unitaires) portent des valeurs **fictives**, libellées « TEST – valeur fictive », et ne peuvent pas fuiter dans un calcul réel.

### D-004 Résolution stricte des paramètres
- Seuls les paramètres `publie` sont utilisables. `a_renseigner`, `brouillon`, `valide`, `archive` → calcul bloqué avec motif `non_publie` (et statuts trouvés, pour le back-office).
- La valeur doit couvrir **toute** la période calculée. Absence, trou, chevauchement de deux versions publiées, valeur nulle → échec motivé (`absent`, `couverture_partielle`, `ambigu`, `sans_valeur`). Jamais de valeur par défaut, jamais la valeur d'une autre année.
- `resolveSegments` permet plusieurs valeurs successives sur une période (cas du SMIC revalorisé en cours d'année) ; `resolve` exige une valeur unique et renvoie `decoupage_infra_annuel` sinon.
- Les manques sont agrégés dans `missingParameters` du calcul : c'est la liste « règles à compléter » du back-office. Le module M1 continue la résolution après un premier manque pour lister **tous** les paramètres manquants d'une année.

### D-005 Invariants des opportunités (moteur + base)
- Statuts : `estime`, `parametre_manquant`, `informations_manquantes`, `non_reclamable`, `aucun_ecart`.
- Seul `estime` porte un montant (bas ≤ central ≤ haut). Le moteur lève une erreur si un module viole cette règle ; la base l'impose aussi par contrainte CHECK.
- Estimation, montant validé (analyste) et montant récupéré (table `recoveries`) sont trois champs/tables distincts.

### D-006 Règles de cumul par assiette
- Chaque opportunité déclare ses assiettes (ex. `cotisations_patronales:reduction_generale:2024`). Deux modules différents sur la même assiette sans règle de cumul explicite → conflit signalé, montants **exclus** des totaux, arbitrage par un analyste.

### D-007 Totaux séparés, commission indicative vs réelle
- `totals.pastRecovery` et `totals.futureAnnualSavings` sont calculés séparément et ne sont jamais additionnés.
- `indicativeCommission` (affichage) et `realCommission` (sur remboursement réel, saisi par un administrateur, avec justificatif) sont deux fonctions distinctes. En base, la commission est créée **uniquement** par trigger à l'insertion d'un remboursement (D-016).

### D-008 Module M1 – régime selon l'année
- 2023 à 2025 : ancienne réduction générale. À partir de 2026 : RGDU. Avant 2023 : hors périmètre. Ce découpage vient du cahier des charges et est codé dans `regimeForYear`.
- Toutes les valeurs (T, seuils de sortie, Tmin, Tdelta, P, SMIC, durée mensuelle, seuil d'effectif, décimales d'arrondi, délai de réclamation) sont des paramètres versionnés.

### D-009 M1 – formules **[À VALIDER]**
- Ancienne RG, forme généralisée : `C = T / (S − 1) × (S × SMIC / RAB − 1)`, bornée à [0, T], S = seuil de sortie (paramètre). Avec S = 1,6 on retrouve la forme usuelle `T / 0,6 × (1,6 × SMIC / RAB − 1)`.
- RGDU : `C = Tmin + Tdelta × [(S × SMIC / RAB − 1) / (S − 1)]^P`, nulle à partir de S SMIC, base bornée à [0, 1]. Avec S = 3 : formule de référence du cahier des charges.
- Coefficient arrondi au nombre de décimales paramétré (`reduction_generale_arrondi_coefficient_decimales`).
- Mode avancé : SMIC de référence = Σ (SMIC horaire du mois × heures rémunérées du mois, heures supplémentaires/complémentaires incluses, hors majoration) ; RAB = Σ bruts ; réduction = C × RAB, calcul annuel par salarié.
- **Non traités à ce stade (à valider/compléter)** : entrées-sorties en cours de mois et absences non rémunérées (proratisation fine du SMIC), salariés non mensualisés, forfaits jours, **majoration pour les entreprises affiliées à une caisse de congés payés (BTP)**, déduction forfaitaire spécifique pour frais professionnels (BTP), cas où T change en cours d'année (le moteur bloque alors l'année avec `decoupage_infra_annuel`), méthode légale de calcul de l'effectif (le moteur utilise l'effectif moyen déclaré de l'année).

### D-010 M1 – mode rapide par tranches
- Chaque tranche est exprimée en multiple du SMIC **temps plein**. La réduction par ETP `C(m) × m × SMIC annuel` n'est pas monotone en RGDU : bas et haut sont donc le min et le max sur 21 points échantillonnés dans la tranche `[a, b[`, le central est la valeur au milieu.
- Temps partiels : nombre d'ETP = n × (1 − part + part × quotité). Si la quotité n'est pas connue, **hypothèse** 0,5 / 0,65 / 0,8 (bas / central / haut), affichée dans le détail du calcul, et confiance faible. Ce n'est pas un paramètre réglementaire mais une hypothèse d'estimation.
- Heures supplémentaires ignorées en mode rapide ; apprentis payés sous le SMIC comptés dans la première tranche (surestimation possible, signalée).
- **Réduction déclarée inconnue → aucun montant** (statut `informations_manquantes`) : la réduction théorique est montrée dans le détail, mais n'est jamais présentée comme récupérable, car la plupart des logiciels de paie l'appliquent déjà. Évite les promesses gonflées.

### D-011 Délai de réclamation, mois par mois **[À VALIDER]**
- Paramètre `delai_reclamation_cotisations_annees`, lu à la date de référence (statut « à renseigner » dans le jeu officiel).
- Hypothèse prudente : cotisations du mois M réputées payées le 5 du mois M+1 (date d'exigibilité la plus précoce → délai qui expire le plus tôt). Un mois est réclamable s'il est écoulé et si la date de référence est strictement antérieure à « paiement + délai ».
- Mode rapide : montant × (mois réclamables / 12). Mode avancé : fraction appliquée salarié par salarié sur ses mois travaillés.
- Écart existant mais période prescrite → `non_reclamable`, sans montant, avec conseil pour l'avenir.

### D-012 M1 – mode avancé et sur-application
- Seules les lignes de paie `validated = true` sont utilisées ; les autres sont comptées et signalées.
- Les années sans paie validée retombent sur le mode rapide : aucune donnée n'est perdue en passant au mode avancé.
- Une sur-application (réduction appliquée > réduction théorique) est un risque de redressement : elle est signalée et **déduite de l'estimation basse et centrale** ; l'estimation haute = sous-application brute.
- Écart individuel annuel < 1 € attribué aux arrondis mensuels et ignoré (hypothèse affichée).

### D-013 Base : RLS partout, anon sans aucun accès
- RLS activée **et forcée** sur toutes les tables. Le rôle `anon` n'a aucune politique : le parcours sans compte (SIREN, mode rapide, prospect) passera par des actions serveur avec `service_role`, qui valident les entrées avec Zod. Raison : ne jamais exposer l'API PostgREST en écriture anonyme.
- Fonctions d'autorisation dans un schéma `app` non exposé, en `SECURITY DEFINER` avec `search_path` vide (pas de récursion RLS, pas de détournement de `search_path`).
- Rôles d'entreprise : `proprietaire` (tout, gère les membres), `collaborateur` (écriture), `comptable_invite` (lecture + dépôt de documents). Rôles internes : `analyste`, `administrateur` (colonne `users.internal_role`, modifiable par un administrateur uniquement, protégée par trigger).
- Création d'entreprise via `app.create_company` : l'appelant en devient propriétaire atomiquement.

### D-014 Cohérence inter-entreprises par clés étrangères composites
- Les tables enfants portent `company_id` et référencent le parent par `(id, company_id)` : impossible de rattacher un salarié, une ligne de paie, un taux AT, un champ extrait, un mandat ou un remboursement à une ressource d'une autre entreprise, même avec un bug applicatif.

### D-015 Paramètres réglementaires en base
- Création au statut `a_renseigner` ou `brouillon` uniquement, par un administrateur (auteur = utilisateur courant).
- Contenu modifiable seulement avant validation ; ensuite, toute modification = nouvelle version.
- Transitions contrôlées : brouillon → validé → publié → archivé (retour validé → brouillon possible pour rejet). Pas de brouillon → publié direct.
- Quatre yeux : le validateur est l'utilisateur courant et doit être différent de l'auteur (trigger + contrainte CHECK). Validation/publication exigent source URL et date de vérification.
- La publication d'une version archive automatiquement les versions publiées qui la chevauchent (même clé, jeu, territoire) : jamais deux valeurs publiées concurrentes.
- Suppression impossible (aucune politique DELETE + trigger, y compris pour `service_role`). Chaque changement est journalisé.
- La relance automatique des tests de référence à la publication sera branchée en phase 7 (table `reference_test_cases` déjà prévue).

### D-016 Remboursements et commissions
- Remboursement : administrateur uniquement, justificatif obligatoire (FK vers `documents` de la même entreprise), montant > 0.
- Commission créée exclusivement par trigger au taux de `commercial_settings` (25 % par défaut, modifiable), montant et taux immuables ensuite. Option « commission sur économies futures » présente, désactivée par défaut, sans effet à ce stade.

### D-017 Immuabilité
- `calculation_runs` : aucune mise à jour. `opportunities` : champs d'estimation figés, seule la revue est modifiable. `audit_logs` : ajout seul. Mandat `signe` impossible sans identifiant de demande du prestataire, date et document signé (jamais simulé).

### D-018 Tests de la base avec PGlite
- PostgreSQL réel compilé en WASM, sans Docker. Le harnais recrée le minimum Supabase (`anon`, `authenticated`, `service_role`, `auth.users`, `auth.uid()` lisant le claim `sub`). Les mêmes migrations seront appliquées telles quelles sur Supabase.
- Limite : les politiques Storage (`storage.objects`) et l'Auth réelle seront testées en phase 4 sur un projet Supabase local/staging.

### D-019 Seed généré depuis le TypeScript
- `supabase/seed.sql` est généré par `pnpm --filter @recupfiscal/engine seed:generate` à partir du registre des modules et de `OFFICIAL_PARAMETERS_SEED` : une seule source de vérité pour les clés de paramètres. Un test vérifie qu'aucun paramètre officiel n'est publié par le seed.

### D-020 Sources officielles **[À VALIDER]**
- Les URL de sources du module M1 pointent vers des pages générales (BOSS « allègements généraux », urssaf.fr). Les liens profonds exacts (articles du code de la sécurité sociale sur Légifrance, fiches URSSAF, BOSS) sont à renseigner par l'administrateur sur chaque paramètre lors de sa saisie.

---

## Phase 2 – Modules M2 à M5, zonages, cumul, cas de référence

### D-021 Évolutions du cœur (moteur 0.2.0)
- Nouveau statut `a_confirmer` : piste détectée sans conclusion ferme (M3 sans notification officielle, M4). Jamais de montant (moteur + contrainte en base).
- Nouveau champ `countsInTotals` : un résultat de simulation (M5) est affiché mais jamais additionné aux totaux de récupération ou d'économies.
- Les calculs tracent aussi les **données de référence** utilisées (`referenceIds` + copie) : jeux de zonage, communes, dispositifs zonaux. Le rejeu épingle ces identifiants.
- Le changement de format de sortie fait passer le moteur en 0.2.0 et M1 en 1.1.0 (assiette renommée). Un calcul enregistré en 0.1.0 n'est plus rejouable par ce moteur : le rejeu l'indique explicitement (aucun calcul réel n'a été enregistré en 0.1.0).

### D-022 Assiettes hiérarchiques et cumul
- Les assiettes sont des chemins (`cotisations_patronales:allegements:2024`, `…:2024:<siret>`). Deux assiettes se chevauchent si elles sont égales ou si l'une est un préfixe de l'autre.
- M1 utilise l'assiette annuelle de l'entreprise ; M4 l'assiette annuelle de l'établissement, qui la chevauche : une exonération zonale chiffrée ne sera jamais additionnée à la réduction générale de la même année sans règle de cumul explicite.
- M3 (`cotisations_patronales:atmp:…`) ne chevauche pas M1 : la correction du taux AT ne modifie pas le montant de réduction générale recalculé. **[À VALIDER]** (imputation de la réduction générale sur la part AT/MP).
- **Aucune règle de cumul réelle n'est livrée** : ce sont des règles juridiques, à saisir par l'administrateur avec leur source (table `cumulation_rules`).

### D-023 M2 – aides à l'embauche **[À VALIDER]**
- Paramètres résolus **à la date de début du contrat** (assimilée à la date de conclusion) : montant annuel, durée maximale, niveau de diplôme maximal, effectif « strictement inférieur à », délai de demande en mois. Une ligne par type de contrat (apprentissage, professionnalisation).
- Aide théorique = montant annuel / 12 × mois éligibles, mois éligibles = min(durée du contrat, durée maximale, mois entiers exécutés en cas de rupture).
- Découpage : mois déjà écoulés → récupération passée ; mois restants d'un contrat en cours → « à percevoir » (économie future), si la demande est encore possible.
- Aide « non » demandée et délai dépassé → `non_reclamable` : « non récupérable, à anticiper pour les prochains contrats ». Aide « partiellement » versée → contrôle des versements, sans application du délai de demande.
- « Je ne sais pas » ou montant perçu inconnu → aucun montant. « Oui » sans montant → supposée intégralement perçue.
- **Non traités** : conditions d'âge (affichées comme « à vérifier »), aides cumulables spécifiques (handicap, etc.), versements mensuels conditionnés à la transmission de la DSN.

### D-024 M3 – taux AT/MP
- Conclusion ferme uniquement avec une notification officielle **validée** (champ `notified_rate_validated`, qui exige un document rattaché en base). Confiance élevée si le taux appliqué est lui aussi validé sur pièce, sinon moyenne.
- Sans notification : `a_confirmer`, confiance faible, écart potentiel affiché dans le détail seulement (comparé au taux notifié déclaré, sinon au taux collectif du code risque `taux_at_collectif_<code>` s'il est publié).
- Taux appliqué inférieur au notifié : signalé comme **risque** (redressement), jamais comme gain.
- Trop-versé = masse salariale × écart × part des mois réclamables (masse supposée uniforme sur l'année). Pour la dernière année connue : économie future annuelle « si le taux erroné est toujours appliqué », confiance faible.

### D-025 M4 – zonages versionnés
- Une commune n'est classée qu'à travers un **jeu de zonage** (`zoning_datasets`) sourcé, versionné, couvrant une période, publié après validation à quatre yeux. Les communes d'un jeu validé ne sont plus modifiables.
- Si aucune table publiée ne couvre toute la période pour un type de zone, le moteur ne conclut **jamais** « hors zone » : `parametre_manquant` (clé `zonage:<type>`).
- Les dispositifs (`zone_schemes`) — nom, conditions, justificatifs, source — sont saisis par l'administrateur ; aucun n'est livré pour le jeu officiel (ce sont des règles). Sans dispositif publié, M4 signale « règle à compléter ».
- **Pas d'estimation chiffrée** : ces exonérations dépendent des embauches, des rémunérations et de conditions propres à chaque dispositif. M4 produit des pistes `a_confirmer` (passé réclamable / prochaines embauches). Un module d'estimation pourra être ajouté par dispositif quand ses règles seront paramétrées.
- Types de zone à importer en priorité (à confirmer par un expert, avec leurs textes) : ZRR / France Ruralités Revitalisation, ZFU-TE, QPV, BER.

### D-026 M5 – simulateur **[À VALIDER]**
- Six scénarios pour une même enveloppe de coût employeur par salarié : augmentation de salaire, prime classique, intéressement versé, intéressement placé sur PEE + abondement, PPV, titres-restaurant.
- Tous les taux et plafonds sont paramétrés par année et, pour le forfait social et la PPV, par **tranche d'effectif** (deux seuils paramétrés). Aucune valeur officielle n'est livrée.
- Taux de cotisations : ceux de l'entreprise s'ils sont saisis, sinon des **taux de référence de simulation** paramétrés (hypothèse : taux moyen, hors réduction générale propre à chaque salaire).
- Impôt sur le revenu approché par net × TMI saisi ; sans TMI, comparaison avant impôt (signalée).
- Intéressement + abondement : résolution exacte de l'équation de coût, linéaire par morceaux (abondement limité à un multiple du versement et à un plafond), puis plafond individuel d'intéressement.
- PPV : régime paramétré applicable seulement sous un seuil de rémunération en SMIC annuel ; sinon scénario « non applicable ».
- Titres-restaurant : part patronale au maximum exonéré, limitée au nombre de jours de repas ; la quote-part salarié est affichée.
- Le résultat (gain de net vs prime classique, coût à net égal) est **hors totaux** (`countsInTotals = false`). Les conditions de mise en place, dont la **non-substitution**, sont affichées pour chaque dispositif.
- Arrondi au centime uniquement en fin de calcul (un écart de 4 centimes détecté par le cas de référence RC-M5-01 a conduit à corriger un arrondi intermédiaire).

### D-027 Cas de référence
- `src/reference-cases` : au moins un cas par module (10 au total), valeurs attendues calculées à la main hors du code, sur les paramètres de TEST. `runReferenceCase` est réutilisable par le back-office (relance à la publication d'un paramètre, phase 7). Les cas sont exportés dans `reference_test_cases` par le seed.

### D-028 Boulangerie Démo enrichie
- Établissement avec code risque de démonstration, taux AT 2024 appliqué à 2,70 % pour 2,10 % notifié, aide apprenti de E11 perçue à 2 000 € sur 5 000 €, commune classée dans un **zonage fictif** (`zone_demo`) jusqu'à mi-2024, simulation de rémunération 2026. Toutes les données de zonage de test sont fictives (aucune commune réelle classée dans un zonage réel).

---

## Phase 3 – Application web : accueil, SIREN, mode rapide, résultats, prospects

### D-029 Application Next.js 15 (App Router)
- `apps/web` : Next.js 15.5, React 19, Tailwind CSS 4, composants maison au style shadcn/ui (Button, Input, Card, Alert, Progress), React Hook Form + Zod pour les formulaires plats (démarrage, prospect), état contrôlé + schémas Zod pour le questionnaire à étapes (structure imbriquée par année).
- Next 15 plutôt que 16 : version stable maîtrisée ; migration à planifier.
- Le moteur est importé tel quel (`transpilePackages`, alias `.js` → `.ts`) et ne s'exécute que côté serveur.

### D-030 Accès aux données côté serveur uniquement
- Le navigateur n'accède jamais à la base : toutes les lectures/écritures passent par des **actions serveur** qui valident les entrées (Zod) et contrôlent l'accès. Le serveur se connecte avec un rôle de service (équivalent `service_role`) ; la RLS reste la défense en profondeur pour les accès authentifiés (phase 4).
- Base : `DATABASE_URL` (PostgreSQL / Supabase) si défini, sinon **PGlite** local persistant dans `.data/` (vrai PostgreSQL, mêmes migrations, socle Supabase minimal de `supabase/local/`). Aucune base simulée.

### D-031 Audits anonymes sécurisés
- Un audit sans compte est accessible par un **jeton aléatoire de 256 bits**, stocké haché (SHA-256) en base et en cookie `httpOnly`, `SameSite=Lax`, `Secure` en production, 30 jours. Comparaison en temps constant.
- **Un audit anonyme n'est jamais rattaché à une ligne `companies`** : un visiteur pourrait saisir le SIREN d'une entreprise cliente et injecter des données visibles par ses membres. L'entreprise est conservée dans les réponses ; le rattachement se fera après authentification et vérification (phase 4).
- Les métadonnées (années, date figée de la démo) sont dans une étape `_meta` que le client ne peut pas écrire ; le SIREN n'est plus modifiable après création ; un audit calculé est figé (nouveau calcul = même `calculation_run`).
- Reprise : les réponses sont retrouvées après rechargement ou fermeture du navigateur sur le **même appareil**. La reprise sur un autre appareil nécessite un compte (phase 4, critère 4 complet).

### D-032 Périmètre temporel du mode rapide **[À VALIDER]**
- Années demandées : les deux années civiles précédentes et l'année en cours (au 02/11/2026 : 2024, 2025, 2026). Raison : limiter la saisie à 3 années comme le prévoit le cahier des charges ; l'année N-3, réclamable seulement sur ses derniers mois, sera couverte par le mode avancé.
- Montants de l'année en cours : saisis comme estimation annuelle, proratisés par le moteur sur les mois écoulés.
- Mode rapide : taux AT déclarés, donc `notifiedRateFromValidatedDocument = false` (jamais de conclusion ferme, conformément au §6.4 M3) ; date de début des contrats au mois près (confiance faible).

### D-033 API Recherche d'entreprises
- Client `lib/company-search.ts` : requête `/search?q=…&per_page=5`, validation Zod tolérante, délai de 6 s, établissements fermés exclus, SIREN contrôlé par clé de Luhn avant l'appel.
- En cas d'échec (réseau, statut HTTP, format inattendu), bascule automatique vers la **saisie manuelle**, SIREN pré-rempli.
- La liste d'établissements renvoyée peut être partielle : si le registre annonce plus d'établissements ouverts, l'utilisateur est invité à compléter.
- **Non vérifié contre l'API réelle** : l'hôte est bloqué par la politique réseau de l'environnement de développement. Le format a été codé d'après la documentation publique et testé sur une réponse au même format. Test de recette à faire dès que l'hôte est autorisé.

### D-034 Secteurs et aide contextuelle **[À VALIDER]**
- Secteur déduit du NAF : 41-43 bâtiment, 45-47 commerce, 55-56 restauration, 10-33 industrie, avec une catégorie « artisanat alimentaire » (boulangerie-pâtisserie, charcuterie…).
- L'aide indique où trouver l'information, sans affirmation réglementaire chiffrée. Les textes sectoriels sont à relire par un expert paie.

### D-035 Résultats sans compte
- Affichage immédiat des trois indicateurs **séparés** : récupération passée (fourchette), commission indicative au taux de `commercial_settings` avec gain net, économies futures (« jusqu'à », non commissionnées). La mention obligatoire est affichée.
- Le détail par dispositif est réservé aux comptes (phase 4) ; il est visible directement dans la **démonstration** uniquement.
- Lorsque les paramètres officiels d'une année ne sont pas publiés, la page l'indique explicitement (« en cours de vérification ») au lieu d'afficher zéro comme une conclusion.

### D-036 Prospects et lien magique
- Le prospect est enregistré dès la validation du formulaire (e-mail, prénom, téléphone facultatif, consentement versionné), rattaché à l'audit (`audits.lead_id`), même s'il ne crée jamais de compte. Champ piège anti-robot enregistré (`honeypot_triggered`) sans bloquer l'utilisateur.
- **Le lien magique n'est pas encore envoyé** (phase 4). L'interface le dit explicitement ; aucun envoi n'est simulé.

### D-037 Démonstration
- `/demo` crée un audit Boulangerie Démo marqué `is_demo`, calculé avec le jeu **test** (contrainte en base : un audit non démo ne peut pas utiliser le jeu test) et une date de référence figée (02/11/2026) pour des résultats stables. Bandeaux « fictif » sur chaque écran. Activée par défaut hors production, pilotée par `DEMO_ENABLED`.
- Le jeu test est chargé par le serveur sans circuit de validation (exception limitée au rôle service et au jeu test ; le jeu officiel et les utilisateurs restent soumis aux quatre yeux).

### D-038 Tests de bout en bout et accessibilité
- Playwright (Chromium) : parcours complet en **format smartphone** (Pixel 7) et absence de débordement horizontal sur smartphone, tablette et ordinateur. L'API d'entreprises est pointée vers un port fermé pour tester de façon déterministe la bascule manuelle.
- Contrôle du contraste WCAG AA des boutons principaux, ajouté après la découverte (sur capture d'écran) d'un bouton blanc sur blanc dû à une fusion de classes Tailwind absente — corrigé (`buttonVariants` passe désormais par tailwind-merge).
- Nom de marque provisoire « Récupération PME » (`NEXT_PUBLIC_BRAND_NAME`) en attendant le nom commercial.

---

## Phase 4 – Comptes, lien magique, espace client, membres et invitations

### D-039 Deux fournisseurs d'authentification, une même RLS
- `AUTH_PROVIDER=supabase` (défaut en production) : Supabase Auth par lien magique, via `@supabase/ssr`. Flux **token_hash + verifyOtp** (et non PKCE), afin que le lien fonctionne sur un autre appareil que celui qui l'a demandé. **À configurer** : modèle d'e-mail « Magic Link » de Supabase pointant vers `{{ .SiteURL }}/auth/confirmer?token_hash={{ .TokenHash }}&type=email&suivant=/espace`, SMTP d'un prestataire UE, URL du site. **Non testé** : aucun projet Supabase n'est joignable depuis l'environnement de développement.
- `AUTH_PROVIDER=local` (défaut hors production, **refusé en production**) : lien magique maison (jeton 256 bits haché, 15 min, usage unique, 5 demandes/heure/adresse), sessions en base (jeton haché, 30 jours, révocables). Tables dans `supabase/local/local-auth.sql`, jamais appliquées sur Supabase.
- Dans les deux cas, l'utilisateur est une ligne `auth.users` (profil `public.users` créé par trigger) et les requêtes faites en son nom passent par `db.asUser()` : rôle `authenticated` + claim `sub`, donc **la RLS PostgreSQL s'applique pleinement**, exactement comme avec l'API Supabase.

### D-040 Lien consommé uniquement par un clic (POST)
- Le lien reçu ouvre `/auth/confirmer` sans consommer le jeton ; la connexion n'a lieu qu'au clic sur « Me connecter ». Les robots de messagerie qui pré-ouvrent les liens ne les consomment donc pas.
- Redirection après connexion limitée aux chemins internes (`safeNextPath`) ; réponse identique que l'adresse ait un compte ou non (pas d'énumération).
- En production, l'origine des liens vient de `APP_URL` (jamais de l'en-tête Host, falsifiable).

### D-041 Rattachement de l'audit et de l'entreprise
- La capture du prospect crée une **réclamation** (`audit_claims`, 30 jours) liée à l'e-mail saisi, puis envoie le lien magique. La réclamation n'est exécutée qu'après vérification de l'adresse par le lien.
- Entreprise inconnue : elle est créée (statut `non_verifiee`) et l'utilisateur en devient propriétaire.
- Entreprise déjà présente dont il est membre (écriture) : l'audit y est rattaché.
- Entreprise déjà présente dont il n'est **pas** membre : l'audit reste **personnel** ; il doit être invité par un propriétaire. Un visiteur ne peut donc jamais rejoindre une entreprise cliente en saisissant son SIREN.
- **[À VALIDER]** Le rattachement d'un compte à une nouvelle entreprise est déclaratif. Une vérification (Kbis, mandat, contrôle analyste) est prévue avant tout mandat (phase 8) ; elle est signalée dans l'espace.
- Audits personnels : nouvelle colonne `audits.owner_user_id`, prise en compte par toutes les politiques RLS des tables rattachées à un audit (`app.can_read_audit` / `app.can_write_audit`).

### D-042 Membres et invitations
- Seul un propriétaire invite, change les rôles ou retire un membre (RLS). Rôles invitables : collaborateur, comptable invité ; jamais propriétaire par invitation (un propriétaire peut ensuite promouvoir un membre).
- Une entreprise conserve **toujours au moins un propriétaire** (trigger en base).
- Invitation : jeton haché, 7 jours, une seule en attente par adresse, annulable, **réservée à l'adresse invitée** (vérifiée par le lien magique). Membres visibles avec leur e-mail uniquement par les co-membres (`app.list_company_members`).
- Comptable invité : lecture des résultats et de l'entreprise, aucune modification ni calcul (contrôlé en base et par le service).

### D-043 E-mails
- Interface `Mailer` : `outbox` (développement : e-mails stockés et affichés sur `/dev/emails`, page absente en production) et `brevo` (prestataire français, hébergement UE, API transactionnelle). **Brevo non testé** contre le service réel (réseau restreint). En mode Supabase, les liens de connexion sont envoyés par Supabase (SMTP à configurer) ; les invitations par le `Mailer`.

### D-044 Stockage des documents
- Seau Supabase Storage privé `documents`, chemins `<company_id>/<fichier>`. Lecture : membres ; dépôt : tout membre (y compris comptable invité) ; aucune modification ni suppression par un client ; suppression réservée aux administrateurs. Testé sur un schéma `storage` local reproduisant les tables de Supabase ; les URL signées courtes arriveront avec l'import documentaire (phase 6).

### D-045 Accès aux résultats
- Le détail par dispositif est visible pour un compte ayant accès à l'audit (propriétaire personnel ou membre de l'entreprise) et pour la démonstration. Le jeton anonyme seul donne la fourchette globale.

---

## Phase 5 – Rapport PDF

### D-046 Génération
- `@react-pdf/renderer` côté serveur (composants React). Contenu construit par une fonction pure (`buildReportData`) couvrant le §9 : entreprise, date, mode, périmètre, données déclarées, opportunités avec détail du calcul, hypothèses, paramètres (valeur, version, période, source), zonages consultés, confiance et risques, informations et documents manquants, commission indicative, prochaines étapes, identifiant du calcul, empreintes, mention obligatoire (deux fois).
- Polices PDF standard : les espaces insécables fines de `Intl` sont remplacées (non prises en charge). Mise en page en trois pages explicites (synthèse, opportunités, annexes) : la combinaison `minPresenceAhead` + saut de page interne provoquait une erreur du moteur de mise en page.
- Un rapport par calcul et par version de modèle (`rapport-v1`) : régénérer renvoie le même document. Rapport immuable, empreinte SHA-256 vérifiée à chaque téléchargement.
- Réservé aux comptes ayant accès à l'audit (et à la démonstration), comme le détail des résultats. Téléchargement via une route serveur qui contrôle les droits (`Cache-Control: private, no-store`).

### D-047 Stockage des fichiers
- Interface `FileStore` : disque local (développement, hors dossier public) ou Supabase Storage (production, clé de service côté serveur ; **non testé** contre un projet réel). Chemins validés (`<uuid>/<nom>`, pas de `..`), jamais d'écrasement.

## Phase 6 – Mode avancé, import, extraction, validation

### D-048 Pipeline documentaire
- Dépôt : format détecté **par le contenu** (signature PDF, conteneur XLSX, rubriques DSN, CSV), 15 Mo maximum, empreinte SHA-256 (doublons reconnus), nom de fichier assaini, stockage privé `<company_id>/<uuid>.<ext>`. Antivirus : **non disponible** (statut enregistré `non_disponible`) — à brancher (ex. ClamAV) avant la production.
- File asynchrone `jobs` (tentatives, verrou `skip locked`) : traitement lancé après la réponse (`after()` de Next.js) et par le processus de fond `pnpm --filter @recupfiscal/web worker` en production (PostgreSQL ; PGlite ne permet pas deux processus).
- Extraction **déterministe uniquement** :
  - modèle CSV/XLSX de journal de paie fourni (`/modeles/journal-paie.csv`), confiance 1 ;
  - DSN : mois, SIRET, salariés **pseudonymisés** (matricule haché avec l'identifiant de l'entreprise), brut (type 001), heures, réduction générale (code de cotisation 018) ; **le NIR et le nom ne sont jamais lus ni stockés** ; confiance 0,8. **[À VALIDER]** correspondances de rubriques DSN (types de rémunération, code de la réduction générale, heures supplémentaires non lues) ;
  - notification de taux AT (PDF texte) : un seul taux et une année trouvés, sinon rien ; confiance 0,6 ;
  - autres PDF : classification par mots-clés, puis **saisie manuelle** ; PDF scannés : OCR non activé, saisie manuelle.
- **IA** : interface `AiExtractor` indépendante du fournisseur, **aucun fournisseur activé** (aucun document transmis) conformément au §15 tant qu'un fournisseur avec garanties contractuelles et hébergement conforme n'est pas retenu. Une IA ne produirait jamais un montant de calcul, seulement des champs à valider.

### D-049 Validation
- Chaque champ conserve valeur d'origine (immuable en base), page/ligne/salarié source, confiance, extracteur, statut, auteur et date de validation. Une correction est stockée à part (`corrected_value`).
- Validation, correction, rejet : propriétaire ou collaborateur (le comptable invité dépose mais ne valide pas). Validation groupée possible, avec confirmation explicite.
- Seules les valeurs validées sont appliquées : lignes de paie (`validated = true`, lien vers le champ source) et taux AT notifié validé (avec le document source, condition de conclusion ferme du module M3). Un rejet retire la ligne appliquée.

### D-050 Mode avancé
- Un audit avancé est rattaché à une entreprise (droit d'écriture) et **reprend les réponses du dernier audit rapide** (consentement à renouveler).
- Le calcul transmet au moteur toutes les lignes de paie validées (calcul salarié par salarié de M1), les lignes extraites non validées marquées `validated: false` (comptées, jamais utilisées) et les taux AT notifiés validés.
- Saisie manuelle mois par mois toujours disponible (déclarations de l'utilisateur, utilisées directement) : l'import n'est jamais obligatoire.

---

## Phase 7 – Back-office

### D-051 Accès
- `/admin` réservé aux rôles internes : analyste (indicateurs, prospects, dossiers, revue des opportunités) et administrateur (en plus : paramètres, moteur, zonages, conditions commerciales, équipe). Contrôle dans chaque page (404 : l'existence n'est pas révélée) et, en profondeur, par la RLS (toutes les requêtes en `asUser`).
- Premier administrateur : `BOOTSTRAP_ADMIN_EMAILS` (adresse vérifiée par lien magique, seulement si aucun administrateur n'existe, journalisé) ou script `admin:grant`. Ensuite, attribution par un administrateur ; il reste toujours au moins un administrateur.

### D-052 Paramètres
- Compléter une ligne « à renseigner » ou modifier une valeur publiée crée **une nouvelle version brouillon** (jamais d'écrasement). Validation par un second administrateur (quatre yeux, en base). Publication réservée aux paramètres validés ; elle **relance les cas de référence du module** concerné et **est refusée si un cas échoue**. La version publiée archive celle qu'elle remplace.
- « Règles à compléter » : agrégation des paramètres manquants des 500 derniers calculs réels.

### D-053 Revue des opportunités
- L'analyste valide (montant validé) ou rejette (motif obligatoire) ; auteur et date posés par trigger ; journalisé. Trois montants distincts : estimation du moteur (immuable), montant validé, montant remboursé.

### D-054 Zonages, commercial, textes
- Import CSV de communes dans un jeu sourcé (brouillon), validation à quatre yeux, publication. Dispositifs zonaux créés en brouillon, avec source, conditions et justificatifs.
- Taux de commission modifiable (journalisé) ; option « commission sur économies futures » désactivée par défaut, exigeant un taux si activée (sans effet sur le calcul tant que non contractualisée).
- Textes contractuels et e-mails automatiques versionnés (une version active par texte, anciennes conservées). **Aucun texte juridique n'est fourni** : à rédiger et faire valider par un professionnel.

## Phase 8 – Conversion, mandat, dossiers

### D-055 Démarche de récupération
- Réservée au **propriétaire** de l'entreprise, depuis une estimation de l'entreprise (hors démonstration) ; impossible tant que des conditions du mandat ne sont pas publiées. Déclaration d'habilitation et acceptation des conditions obligatoires. Une seule démarche ouverte par estimation.
- Le mandat fige à sa création le taux de commission et la version des conditions ; un mandat signé est immuable. PDF du mandat généré et conservé avec les documents de l'entreprise.
- Le bouton « Je veux récupérer cet argent » apparaît dès qu'une piste existe, même non chiffrée (y compris en attente de paramètres officiels), avec un texte adapté.

### D-056 Signature électronique
- `SIGNATURE_PROVIDER=yousign` : API Yousign v3 (création, document, signataire, activation ; webhook authentifié par HMAC-SHA256 `X-Yousign-Signature-256`, idempotent ; document signé récupéré et conservé). **Non testé contre le service réel** (testé contre une doublure reproduisant l'API documentée). Position du champ de signature à ajuster sur le modèle réel du mandat.
- Par défaut `desactive` : le dossier s'ouvre, le mandat est préparé, mais il reste « à signer » et l'interface le dit. **Aucune signature n'est simulée.**

### D-057 Dossiers
- Transitions contrôlées en base ; « déposé » exige un mandat signé **et** une entreprise vérifiée par l'équipe ; « remboursé » exige un remboursement enregistré. Chaque changement est horodaté (événement), journalisé et **notifié** (notification dans l'espace de chaque membre + e-mail, texte « email_statut_dossier » s'il est publié).
- Commentaires internes invisibles du client (RLS) ; demandes de pièces visibles et notifiées ; justificatifs déposés par le client et rattachés au dossier.

### D-058 Remboursements et commissions
- Remboursement saisi par un **administrateur**, avec justificatif de l'entreprise, uniquement si un mandat est signé. La commission est créée par trigger **au taux figé du mandat signé** (et non au taux en vigueur) ; montant immuable ; suivi facturable → facturée → payée (transitions contrôlées).
- Espace client : remboursements obtenus, commissions dues et réglées.

### D-059 Formulaires
- Les formulaires à plusieurs champs utilisent `onSubmit` : avec React 19, une `action` de formulaire vide les champs même en cas d'erreur (défaut constaté par les tests de bout en bout sur le formulaire de mandat).

---

## Phase 9 – Sécurité, RGPD, environnements, supervision

### D-060 RGPD
- **Export** (portabilité) : fichier JSON des données de l'utilisateur (profil, adhésions, estimations et réponses, dossiers, documents référencés, notifications, consentements de prospect), lu sous RLS : jamais les données d'un tiers.
- **Suppression** : profil, sessions, notifications, estimations personnelles, entreprises dont l'utilisateur est le seul membre (en cascade, fichiers compris), prospects anonymisés. Refusée pour le dernier propriétaire d'une entreprise partagée (transfert d'abord), pour un compte interne, et lorsqu'une démarche est engagée (conservation légale des pièces). Toutes les références à un utilisateur passent à NULL à la suppression (traçabilité sans donnée personnelle). Chaque demande est tracée (`privacy_requests`, e-mail haché).
- **Conservation** (paramétrable, **[À VALIDER]** par le DPO) : audit anonyme 180 jours ; prospect sans compte 3 ans après le dernier contact puis anonymisation ; données techniques 30 jours. Purge par `pnpm purge` (tâche quotidienne).

### D-061 Sécurité applicative
- En-têtes : CSP (pas d'`unsafe-eval` en production ; `unsafe-inline` requis par Next.js sans nonce — durcissement par nonce possible ultérieurement), `frame-ancestors 'none'`, HSTS en https, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, sans `X-Powered-By`.
- Limitation de débit en base (fenêtre fixe, IP hachée avec sel) : recherche SIREN, création d'audit, prospect, lien de connexion, dépôt de fichiers.
- Webhook de signature authentifié (HMAC) ; fichiers servis uniquement après contrôle des droits, sans cache.

### D-062 Exploitation
- Point de santé `/api/sante` (base, file de traitement) ; journaux JSON structurés (`lib/log.ts`), sans donnée personnelle.
- Intégration continue GitHub Actions (`.github/workflows/ci.yml`) : seed à jour, typage, tests (moteur, base avec RLS, application), tests de bout en bout.
- Déploiement, sauvegardes et liste de contrôle avant ouverture : `docs/DEPLOIEMENT.md`. Recette des 15 critères : `docs/RECETTE.md`.
