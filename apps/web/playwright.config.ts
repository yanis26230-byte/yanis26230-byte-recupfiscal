import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

/**
 * Parcours de bout en bout sur smartphone (critère 14). La base est une base PGlite neuve.
 * L'API Recherche d'entreprises est volontairement pointée vers un port fermé : on teste ainsi
 * de façon déterministe la bascule vers la saisie manuelle (l'API réelle n'est pas joignable
 * depuis l'environnement d'intégration).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  projects: [
    { name: 'smartphone', use: { ...devices['Pixel 7'] } },
    { name: 'tablette', use: { ...devices['Galaxy Tab S4'], browserName: 'chromium' }, testMatch: /responsive/ },
    { name: 'ordinateur', use: { ...devices['Desktop Chrome'] }, testMatch: /responsive/ },
  ],
  webServer: {
    command: `rm -rf .data/e2e .data/e2e-files && npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Serveur de production avec l'authentification LOCALE et la boîte d'envoi de développement,
    // explicitement autorisées pour les tests (refusées par défaut en production).
    env: {
      PGLITE_DATA_DIR: '.data/e2e', DEMO_ENABLED: 'true', COMPANY_SEARCH_BASE_URL: 'http://127.0.0.1:9', PARAMETER_DATASET: 'officiel',
      AUTH_PROVIDER: 'local', ALLOW_LOCAL_AUTH: 'true', MAIL_PROVIDER: 'outbox', ALLOW_DEV_OUTBOX: 'true', APP_URL: `http://127.0.0.1:${PORT}`,
      STORAGE_PROVIDER: 'local', LOCAL_STORAGE_DIR: '.data/e2e-files', BOOTSTRAP_ADMIN_EMAILS: 'admin@plateforme.test',
    },
  },
});
