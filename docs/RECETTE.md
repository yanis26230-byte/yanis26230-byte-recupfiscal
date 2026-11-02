# Recette : critères d'acceptation (§18)

| # | Critère | Couverture automatisée | Réserve |
|---|---|---|---|
| 1 | SIREN → données pré-remplies | `apps/web/tests/domain.test.ts` (client de l'API sur réponse au format documenté, contrôle du SIREN) ; `e2e/parcours.spec.ts` (bascule en saisie manuelle) | API réelle non joignable depuis le développement : à recetter sur staging |
| 2 | Mode rapide terminé sans compte, fourchette affichée | `e2e/parcours.spec.ts` (smartphone) | — |
| 3 | E-mail → prospect ; lien magique → compte + audit rattaché | `tests/audit-service.test.ts`, `tests/accounts.test.ts`, `e2e/parcours.spec.ts` | Supabase Auth à recetter sur staging (fournisseur local testé) |
| 4 | Réponses retrouvées après déconnexion | `e2e/parcours.spec.ts` (autre appareil, déconnexion puis reconnexion), `tests/accounts.test.ts` | — |
| 5 | Isolation entre entreprises | `packages/db-tests/tests/rls.test.ts`, `phase4.test.ts` (RLS sur 11+ tables, stockage), `tests/accounts.test.ts`, `e2e/parcours.spec.ts` (404 pour un tiers) | — |
| 6 | 5 modules avec paramètres versionnés | `packages/engine/tests/*` (116 tests), cas de référence par module | Paramètres officiels à saisir |
| 7 | Paramètres de l'année ; manque = blocage | `packages/engine/tests/parameters.test.ts`, `m1.test.ts`, `modules.test.ts` | — |
| 8 | Montant relié à un calculation_run reproductible | `packages/engine/tests/engine.test.ts` (rejeu, empreintes), stockage des runs dans `submitAudit` | — |
| 9 | Passé, commission, futur séparés | `e2e/parcours.spec.ts`, `tests/report.test.ts` | — |
| 10 | Rapport PDF généré et téléchargeable | `tests/report.test.ts` (texte extrait du PDF), `e2e/avance.spec.ts` (téléchargement) | — |
| 11 | Document extrait, corrigé, validé avant usage | `tests/documents.test.tsx`, `e2e/avance.spec.ts` | OCR, antivirus et IA non activés |
| 12 | Mandat : vraie intégration de signature ou désactivé, jamais simulé | `tests/cases.test.ts` (Yousign contre une doublure de l'API ; mode désactivé), `e2e/backoffice.spec.ts` | Yousign réel à recetter sur son bac à sable |
| 13 | Commission seulement sur remboursement réel saisi par un admin | `packages/db-tests/tests/business-rules.test.ts`, `tests/cases.test.ts` (taux du mandat, justificatif) | — |
| 14 | Parcours principaux sur smartphone | Tous les `e2e/*.spec.ts` en Pixel 7 ; absence de débordement sur smartphone, tablette, ordinateur | Recette manuelle sur appareils réels recommandée (iOS Safari non testé : Chromium seul disponible) |
| 15 | Formules testées, cas de référence, Boulangerie Démo de bout en bout | `packages/engine/tests/*`, `reference-cases`, `e2e/parcours.spec.ts` et `avance.spec.ts` (démo) | — |

Commandes : `pnpm test` (moteur, base, application) et `pnpm test:e2e` (navigateur).
