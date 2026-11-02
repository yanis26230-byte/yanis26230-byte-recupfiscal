import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { companyViaQuickAudit, expectNoHorizontalScroll, waitSaved } from './helpers';

test.describe.configure({ mode: 'serial' });

test('rapport PDF généré, conservé et téléchargeable (critère 10)', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Parcourir l’exemple' }).click();
  await page.waitForURL(/\/audit\/[0-9a-f-]{36}/);
  await page.goto(page.url().replace(/\?.*$/, '') + '?etape=7');
  await page.getByRole('button', { name: 'Calculer mon estimation' }).click();
  await page.getByRole('button', { name: 'Générer le rapport PDF' }).click();
  const link = page.getByTestId('report-link');
  await expect(link).toBeVisible({ timeout: 20_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toMatch(/^rapport-boulangerie-demo.*\.pdf$/);
  const { readFileSync } = await import('node:fs');
  expect(readFileSync((await download.path())!).subarray(0, 5).toString()).toBe('%PDF-');
  // Rechargement : le rapport est conservé.
  await page.reload();
  await expect(page.getByTestId('report-link')).toBeVisible();
  // Un autre navigateur ne peut pas le télécharger.
  const other = await page.context().browser()!.newContext();
  expect((await other.request.get(`http://127.0.0.1:3100${await link.getAttribute('href')}`)).status()).toBe(404);
  await other.close();
});

test('mode avancé : DSN déposée, valeurs validées, paie saisie, calcul avancé (critère 11)', async ({ page }) => {
  await companyViaQuickAudit(page, 'avance@exemple.fr', '732829320', 'Atelier Avancé');
  const companyUrl = page.url();
  await page.getByRole('link', { name: 'Documents' }).click();
  await page.locator('#fichier').setInputFiles(join(process.cwd(), 'tests/fixtures/dsn-fictive.txt'));
  await page.getByRole('button', { name: 'Déposer' }).click();
  await expect(page.getByTestId('upload-state')).toContainText('analyse en cours');
  await expectNoHorizontalScroll(page);
  // Traitement asynchrone : la liste se met à jour.
  await expect(async () => { await page.reload(); await expect(page.getByTestId('document-row')).toContainText('2 à valider', { timeout: 1000 }); }).toPass({ timeout: 20_000 });
  await page.getByTestId('document-row').click();
  await expect(page.getByTestId('field-row')).toHaveCount(2);
  await expect(page.getByText(/confiance 80 %/).first()).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Valider les 2 valeurs en attente' }).click();
  await expect(page.getByTestId('review-state')).toContainText('2 valeur(s) validée(s)');
  await expectNoHorizontalScroll(page);

  // Saisie manuelle (le mode manuel fonctionne sans import).
  await page.goto(companyUrl + '/paie?annee=2024');
  await page.getByLabel('Identifiant interne').fill('S001');
  await page.getByLabel('Brut Janv.').fill('2000');
  await page.getByLabel('Heures Janv.', { exact: true }).fill('151,67');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByTestId('payroll-state')).toContainText('1 mois enregistrés pour S001');
  await page.reload();
  await expect(page.getByTestId('payroll-summary')).toContainText('2024 : 1 salarié(s), 1 mois');
  await expectNoHorizontalScroll(page);

  // Analyse avancée : reprise des réponses rapides, données validées utilisées.
  await page.goto(companyUrl);
  await page.getByRole('button', { name: 'Lancer une analyse avancée' }).click();
  await expect(page.getByTestId('advanced-info')).toContainText('3 mois de paie validés');
  await page.getByText(/J’accepte que les informations saisies/).click();
  await waitSaved(page);
  await page.getByRole('button', { name: 'Calculer mon estimation' }).click();
  await expect(page.getByRole('heading', { name: 'Détail par dispositif' })).toBeVisible({ timeout: 20_000 });
  await page.goto(companyUrl);
  await expect(page.getByText(/avancée · calculée/)).toBeVisible();
});
