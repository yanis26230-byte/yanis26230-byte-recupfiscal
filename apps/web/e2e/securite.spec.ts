import { expect, test } from '@playwright/test';
import { companyViaQuickAudit, expectNoHorizontalScroll } from './helpers';

test('en-têtes de sécurité et point de santé', async ({ request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).not.toContain('unsafe-eval');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-powered-by']).toBeUndefined();
  const health = await request.get('/api/sante');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ok', database: 'ok' });
});

test('webhook de signature non authentifié refusé', async ({ request }) => {
  const r = await request.post('/api/webhooks/signature', { data: { event_name: 'signature_request.done', data: { signature_request: { id: 'x' } } } });
  expect(r.status()).toBe(401);
});

test('mon compte : export des données puis suppression définitive (RGPD)', async ({ page }) => {
  await companyViaQuickAudit(page, 'rgpd@exemple.fr', '542065479', 'Données Perso SARL');
  await page.goto('/espace/compte');
  await expectNoHorizontalScroll(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-link').click()]);
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(data.profile.email).toBe('rgpd@exemple.fr');
  expect(data.memberships[0].legal_name).toBe('Données Perso SARL');
  const button = page.getByRole('button', { name: 'Supprimer définitivement mon compte' });
  await expect(button).toBeDisabled();
  await page.getByLabel(/Pour confirmer/).fill('rgpd@exemple.fr');
  await button.click();
  await expect(page.getByText('Votre compte et vos données ont été supprimés.')).toBeVisible();
  await page.goto('/espace');
  await expect(page).toHaveURL(/\/connexion/);
});
