# Feuille de route par phases

| Phase | Contenu | Critères d'acceptation visés | État |
|---|---|---|---|
| **1** | Fondations : monorepo, moteur de calcul (cœur, paramètres versionnés, délais, cumul, calculation_runs, rejeu), **module M1**, schéma PostgreSQL complet + RLS testée, Boulangerie Démo, seed des paramètres officiels | 5, 6 (M1), 7, 8, 13 (règle en base), 15 (M1) | ✅ Terminée |
| **2** | Modules M2 (apprentissage), M3 (taux AT), M4 (zonages + tables versionnées), M5 (simulateur épargne salariale), cumul par assiettes hiérarchiques, cas de référence par module | 6, 7, 8, 15 | ✅ Terminée |
| **3** | Application Next.js : accueil, démarrage SIREN (API Recherche d'entreprises + saisie manuelle), mode rapide (étapes, progression, sauvegarde auto, aide contextuelle sectorielle), résultats sans compte, capture prospect, démonstration | 1, 2, 3 (prospect), 4 (même appareil), 9, 14 | ✅ Terminée (API réelle non testée : hôte bloqué) |
| **4** | Lien magique (Supabase Auth en production, fournisseur local en développement), rattachement de l'audit et de l'entreprise, espace client multi-entreprises, membres et invitations, reprise sur un autre appareil, politiques Storage | 3, 4, 5 (bout en bout) | ✅ Terminée (adaptateurs Supabase et Brevo non testés : services injoignables) |
| **5** | Rapport PDF serveur (React), conservation dans l'espace client | 10 | ✅ Terminée |
| **6** | Mode avancé : saisie mensuelle et salarié par salarié, import (PDF, CSV, XLSX, DSN), file asynchrone, extraction déterministe (couche IA abstraite, désactivée), validation champ par champ | 11 | ✅ Terminée (OCR, antivirus et IA non activés) |
| **7** | Back-office : indicateurs, prospects, revue des opportunités, paramètres (saisie, quatre yeux, publication, relance des tests de référence), modules, zonages, commercial, équipe, journal | 6, 7, 13 | ✅ Terminée |
| **8** | Conversion : conditions, mandat Yousign (désactivé par défaut, jamais simulé), dossiers et statuts, notifications, remboursements, commissions | 12, 13 | ✅ Terminée (Yousign non testé contre le service réel) |
| **9** | Sécurité/RGPD (export, suppression, durées de conservation), limitation de débit, en-têtes, tests de bout en bout mobile, intégration continue, guide de déploiement, supervision | 14, 15 | ✅ Terminée (déploiement réel à effectuer) |
