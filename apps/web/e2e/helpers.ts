import { expect, type Page } from '@playwright/test';

/** Aucune barre de défilement horizontale (mise en page smartphone). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'débordement horizontal en pixels').toBeLessThanOrEqual(1);
}

/** Attend que le questionnaire soit interactif (hydratation terminée) avant toute saisie. */
export async function questionnaireReady(page: Page) {
  await expect(page.getByTestId('questionnaire')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 });
}

/** Attend que TOUTES les modifications soient confirmées par le serveur (pas seulement un ancien message). */
export async function waitSaved(page: Page) {
  const state = page.getByTestId('save-state');
  // Une saisie vient d'avoir lieu : attendre qu'elle soit vue « en attente » (au moins 700 ms
  // d'anti-rebond), sinon on risquerait de lire l'état précédent avant le rendu de React.
  await expect(state).toHaveAttribute('data-dirty', 'true', { timeout: 5_000 }).catch(() => undefined);
  await expect(state).toHaveAttribute('data-dirty', 'false', { timeout: 15_000 });
  await expect(state).toHaveText('Réponses enregistrées', { timeout: 15_000 });
}

/** Rapport de contraste WCAG entre le texte d'un élément et le fond effectif derrière lui. */
export async function contrastRatio(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const bg = (node: Element | null): number[] => {
      for (let n = node; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.length >= 3 && (c[3] ?? 1) > 0) return c;
      }
      return [255, 255, 255];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const a = lum(parse(getComputedStyle(el).color));
    const b = lum(bg(el));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

/** Dernier lien reçu par une adresse dans la boîte d'envoi de développement. */
export async function latestLinkFor(page: Page, email: string): Promise<string> {
  await page.goto('/dev/emails');
  const card = page.locator(`[data-testid="dev-email"][data-to="${email.toLowerCase()}"]`).first();
  await expect(card).toBeVisible();
  const href = await card.locator('a').first().getAttribute('href');
  if (!href) throw new Error(`Aucun lien pour ${email}`);
  return new URL(href).pathname + new URL(href).search;
}

/** Connexion complète par lien magique dans la page donnée. */
export async function loginByMagicLink(page: Page, email: string) {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByRole('button', { name: 'Recevoir un lien de connexion' }).click();
  await expect(page.getByTestId('login-state')).toContainText('lien de connexion vient d’y être envoyé');
  await page.goto(await latestLinkFor(page, email));
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await expect(page).not.toHaveURL(/\/auth\/confirmer|\/connexion/);
  await expect(page.getByRole('button', { name: 'Déconnexion' })).toBeVisible();
}

/** Crée une entreprise via un audit rapide minimal, la capture du prospect et le lien magique. */
export async function companyViaQuickAudit(page: Page, email: string, siren: string, name: string) {
  await page.goto('/audit');
  await page.getByRole('button', { name: 'Saisie manuelle' }).click();
  await page.getByLabel('Numéro SIREN').fill(siren);
  await page.getByLabel('Raison sociale').fill(name);
  await page.getByLabel('Commune', { exact: true }).fill('Lyon');
  await page.getByRole('button', { name: 'Confirmer et commencer' }).click();
  await expect(page.getByText('Étape 1 sur 7')).toBeVisible();
  await questionnaireReady(page);
  const ids = await page.locator('input[id^="hc-"]').evaluateAll((els) => els.map((e) => e.id));
  for (const id of ids) await page.locator('#' + id).fill('3');
  await waitSaved(page);
  await page.getByRole('button', { name: 'Suivant' }).click();
  for (const id of ids) { const y = id.slice(3); await page.getByRole('tab', { name: y }).click(); await page.locator(`#n-${y}-1_1_1_3`).fill('3'); }
  await waitSaved(page);
  await page.goto(page.url().replace(/\?.*$/, '') + '?etape=7');
  await questionnaireReady(page);
  await page.getByText(/J’accepte que les informations saisies/).click();
  await waitSaved(page);
  await page.getByRole('button', { name: 'Calculer mon estimation' }).click();
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Prénom').fill('Test');
  await page.getByText(/J’accepte d’être recontacté/).click();
  await page.getByRole('button', { name: 'Accéder au détail' }).click();
  await expect(page.getByTestId('lead-done')).toBeVisible();
  await page.goto(await latestLinkFor(page, email));
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Mon espace' })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(name) }).first().click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}
