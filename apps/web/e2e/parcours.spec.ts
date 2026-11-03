import { expect, test } from '@playwright/test';
import { contrastRatio, expectNoHorizontalScroll, latestLinkFor, loginByMagicLink, questionnaireReady, waitSaved } from './helpers';

test.describe.configure({ mode: 'serial' });

test('accueil : promesse, piliers, paiement au résultat, mentions et aucun faux témoignage', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Votre entreprise paie peut-être trop de cotisations. Découvrez combien vous pourriez récupérer.');
  await expect(page.getByText('25 % sur le récupéré')).toBeVisible();
  for (const t of ['Audit rétroactif', 'Optimisation future', 'Les dispositifs analysés', 'Sécurité et confidentialité', 'Questions fréquentes']) await expect(page.getByText(t).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mentions légales' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/témoignage|ils nous font confiance/i);
  await expectNoHorizontalScroll(page);
  // Lisibilité des boutons principaux (contraste WCAG AA ≥ 4,5).
  for (const sel of ['section a[href="/audit"]', 'header a[href="/audit"]']) expect(await contrastRatio(page, sel), sel).toBeGreaterThanOrEqual(4.5);
  await page.getByRole('link', { name: 'Estimer mes économies gratuitement' }).first().click();
  await expect(page).toHaveURL(/\/audit$/);
});

test('SIREN invalide refusé ; API indisponible : bascule vers la saisie manuelle pré-remplie', async ({ page }) => {
  await page.goto('/audit');
  await page.getByLabel('Numéro SIREN ou nom de l’entreprise').fill('552 100 555');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page.getByText('Ce numéro SIREN n’est pas valide')).toBeVisible();
  await page.getByLabel('Numéro SIREN ou nom de l’entreprise').fill('552 100 554');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page.getByText(/ne répond pas. Vous pouvez saisir vos informations manuellement/)).toBeVisible();
  await expect(page.getByLabel('Numéro SIREN')).toHaveValue('552100554');
  await expectNoHorizontalScroll(page);
});

let questionnaireUrl = '';

test('mode rapide complet sans compte, avec reprise après rechargement', async ({ page }) => {
  await page.goto('/audit');
  await page.getByRole('button', { name: 'Saisie manuelle' }).click();
  await page.getByLabel('Numéro SIREN').fill('552100554');
  await page.getByLabel('Raison sociale').fill('Menuiserie Exemple');
  await page.getByLabel('Code NAF').fill('43.32A');
  await expect(page.getByText('Secteur : Bâtiment et travaux')).toBeVisible();
  await page.getByLabel('Commune', { exact: true }).fill('Valence');
  await page.getByLabel('Code postal').fill('26000');
  await page.getByRole('button', { name: 'Confirmer et commencer' }).click();

  // Étape 1
  await expect(page.getByRole('heading', { name: 'Votre entreprise' })).toBeVisible();
  await expect(page.getByText('Étape 1 sur 7')).toBeVisible();
  await questionnaireReady(page);
  questionnaireUrl = page.url();
  const years = await page.locator('input[id^="hc-"]').evaluateAll((els) => els.map((e) => e.id.slice(3)));
  expect(years).toHaveLength(3);
  for (const y of years) await page.locator(`#hc-${y}`).fill('9');
  await waitSaved(page);
  await expectNoHorizontalScroll(page);

  // Reprise : les réponses sont retrouvées après rechargement.
  await page.reload();
  await questionnaireReady(page);
  await expect(page.locator(`#hc-${years[0]}`)).toHaveValue('9');

  // Étape 2 : aide sectorielle, répartition, recopie d'une année sur l'autre.
  await page.getByRole('button', { name: 'Suivant' }).click();
  await expect(page.getByRole('heading', { name: 'Répartition des salaires' })).toBeVisible();
  await page.getByText('Aide pour cette étape').click();
  await expect(page.getByText(/Bâtiment : comptez tous les compagnons/)).toBeVisible();
  await page.locator(`#n-${years[0]}-lt_1_1`).fill('6');
  await page.locator(`#n-${years[0]}-1_3_1_6`).fill('3');
  await expect(page.getByTestId('bracket-total')).toContainText('9 salarié(s)');
  for (const y of years.slice(1)) {
    await page.getByRole('tab', { name: y }).click();
    await page.getByRole('button', { name: /Recopier les réponses/ }).click();
  }
  await waitSaved(page);
  await expectNoHorizontalScroll(page);

  // Retour arrière puis avance.
  await page.getByRole('button', { name: 'Précédent' }).click();
  await expect(page.getByRole('heading', { name: 'Votre entreprise' })).toBeVisible();
  await page.goto(`${questionnaireUrl}?etape=3`);
  await expect(page.getByRole('heading', { name: 'Réduction de cotisations déjà appliquée' })).toBeVisible();
  await questionnaireReady(page);
  await page.locator(`#red-${years[0]}`).fill('4 500');
  await waitSaved(page);

  // Étapes 4 à 6 : facultatives.
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Suivant' }).click(); await expectNoHorizontalScroll(page); }
  await expect(page.getByRole('heading', { name: 'Dispositifs existants' })).toBeVisible();
  await page.getByRole('button', { name: 'Suivant' }).click();

  // Étape 7 : récapitulatif, consentement, calcul.
  await expect(page.getByRole('heading', { name: 'Récapitulatif et calcul' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calculer mon estimation' })).toBeDisabled();
  await page.getByText(/J’accepte que les informations saisies/).click();
  await waitSaved(page);
  await page.getByRole('button', { name: 'Calculer mon estimation' }).click();

  // Résultats sans compte : trois indicateurs séparés et mention obligatoire.
  await expect(page.getByRole('heading', { name: 'Votre estimation' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('1. Récupération passée estimée')).toBeVisible();
  await expect(page.getByText(/2\. Commission indicative de 25 %/)).toBeVisible();
  await expect(page.getByText('3. Économies annuelles futures estimées')).toBeVisible();
  // Jeu officiel livré « à renseigner » : aucun montant n'est inventé.
  await expect(page.getByText('Aucun montant chiffré à ce stade')).toBeVisible();
  await expect(page.getByText(/paramètres réglementaires de .* sont en cours de vérification/)).toBeVisible();
  await expect(page.getByTestId('disclaimer')).toHaveText(/Ces résultats sont des estimations fondées sur les informations communiquées\. Ils ne constituent ni une validation fiscale ou sociale, ni une garantie de remboursement\./);
  await expectNoHorizontalScroll(page);

  // Capture du prospect.
  await page.getByRole('button', { name: 'Accéder au détail' }).click();
  await expect(page.getByText('Adresse e-mail invalide')).toBeVisible();
  await page.getByLabel('Adresse e-mail').fill('dirigeant@exemple.fr');
  await page.getByLabel('Prénom').fill('Camille');
  await page.getByText(/J’accepte d’être recontacté/).click();
  await page.getByRole('button', { name: 'Accéder au détail' }).click();
  await expect(page.getByTestId('lead-done')).toContainText('Un lien de connexion vient de vous être envoyé');
  await page.reload();
  await expect(page.getByTestId('lead-done')).toBeVisible();

  // Un audit calculé renvoie vers ses résultats.
  await page.goto(questionnaireUrl);
  await expect(page.getByRole('heading', { name: 'Votre estimation' })).toBeVisible();
});

test('un autre navigateur ne peut pas ouvrir l’audit', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(questionnaireUrl);
  await expect(page.getByText('Cet audit n’est pas accessible depuis ce navigateur')).toBeVisible();
  const res = await page.goto(`${questionnaireUrl}/resultats`);
  expect(res?.status()).toBe(404);
  await ctx.close();
});

test('démonstration Boulangerie Démo : montants fictifs, indicateurs séparés et détail', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByText(/Entreprise\s+fictive/)).toBeVisible();
  await page.getByRole('button', { name: 'Parcourir l’exemple' }).click();
  await expect(page.getByText(/Démonstration : entreprise et paramètres/)).toBeVisible();
  // Équivalent en euros des tranches : SMIC fictif du jeu de test publié.
  await page.getByRole('button', { name: 'Suivant' }).click();
  await expect(page.getByTestId('euros-lt_1_1')).toContainText('€');
  await page.goto(page.url().replace(/\?.*$/, '') + '?etape=7');
  await questionnaireReady(page);
  await page.getByRole('button', { name: 'Calculer mon estimation' }).click();
  await expect(page.getByTestId('past-range')).toContainText(/Entre [\d\s\u202f\u00a0]+€ et [\d\s\u202f\u00a0]+€/, { timeout: 20_000 });
  await expect(page.getByTestId('commission')).toContainText('€');
  await expect(page.getByText('Détail par dispositif')).toBeVisible();
  await expect(page.getByText('Aide à l’apprentissage – contrat C-E11').first()).toBeVisible();
  await expect(page.getByText('(simulation, non additionnée)')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('lien magique ouvert sur un autre appareil : compte créé, audit et entreprise rattachés, détail visible (critères 3 et 4)', async ({ browser }) => {
  const other = await browser.newContext({ ...(await import('@playwright/test')).devices['Pixel 7'] });
  const page = await other.newPage();
  const link = await latestLinkFor(page, 'dirigeant@exemple.fr');
  await page.goto(link);
  // Ouvrir le lien ne connecte pas (protection contre les robots de messagerie) : il faut cliquer.
  await expect(page.getByRole('button', { name: 'Me connecter' })).toBeVisible();
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Mon espace' })).toBeVisible();
  await expect(page.getByText('Votre estimation a été rattachée à votre espace.')).toBeVisible();
  await expect(page.getByText('Menuiserie Exemple').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('link', { name: 'Voir les résultats' }).click();
  await expect(page.getByRole('heading', { name: 'Détail par dispositif' })).toBeVisible();
  await expect(page.getByTestId('disclaimer')).toBeVisible();

  // Le lien est à usage unique.
  await page.goto(link);
  await expect(page.getByText('Ce lien de connexion n’est plus valable')).toBeVisible();

  // Déconnexion puis reconnexion : les réponses et résultats sont retrouvés.
  await page.getByRole('button', { name: 'Déconnexion' }).click();
  await page.goto('/espace');
  await expect(page).toHaveURL(/\/connexion/);
  await loginByMagicLink(page, 'dirigeant@exemple.fr');
  await expect(page.getByRole('heading', { name: 'Mon espace' })).toBeVisible();
  await expect(page.getByText('Menuiserie Exemple').first()).toBeVisible();
  await other.close();
});

test('invitation d’un comptable : réservée à l’adresse invitée ; un tiers n’accède pas à l’entreprise (critère 5)', async ({ browser }) => {
  const devices = (await import('@playwright/test')).devices;
  const owner = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
  await loginByMagicLink(owner, 'dirigeant@exemple.fr');
  await owner.getByRole('link', { name: /Menuiserie Exemple/ }).click();
  await expect(owner.getByRole('heading', { name: 'Menuiserie Exemple' })).toBeVisible();
  const companyUrl = owner.url();
  await owner.getByLabel('Adresse e-mail', { exact: true }).fill('compta@cabinet.fr');
  await owner.getByLabel('Rôle', { exact: true }).selectOption('comptable_invite');
  await owner.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(owner.getByTestId('invite-state')).toContainText('Invitation envoyée');
  await expectNoHorizontalScroll(owner);

  // Un tiers connecté ne peut ni voir l'entreprise ni accepter l'invitation.
  const intruder = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
  const inviteLink = await latestLinkFor(intruder, 'compta@cabinet.fr');
  await loginByMagicLink(intruder, 'intrus@ailleurs.fr');
  const res = await intruder.goto(companyUrl);
  expect(intruder.url()).toBe(companyUrl); // connecté : pas de renvoi vers la connexion
  expect(res?.status()).toBe(404);
  await expect(intruder.getByText('Menuiserie Exemple')).toHaveCount(0);
  await intruder.goto(inviteLink);
  await expect(intruder.getByText('cette invitation est réservée à compta@cabinet.fr')).toBeVisible();

  // Le comptable invité se connecte depuis l'invitation et l'accepte.
  const accountant = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
  await accountant.goto(inviteLink);
  await accountant.getByRole('link', { name: 'Me connecter pour accepter' }).click();
  await expect(accountant.getByLabel('Adresse e-mail')).toHaveValue('compta@cabinet.fr');
  await accountant.getByRole('button', { name: 'Recevoir un lien de connexion' }).click();
  await expect(accountant.getByTestId('login-state')).toBeVisible();
  await accountant.goto(await latestLinkFor(accountant, 'compta@cabinet.fr'));
  await accountant.getByRole('button', { name: 'Me connecter' }).click();
  await accountant.getByRole('button', { name: 'Accepter l’invitation' }).click();
  await expect(accountant.getByRole('heading', { name: 'Menuiserie Exemple' })).toBeVisible();
  await expect(accountant.getByText('Votre rôle : Comptable invité')).toBeVisible();
  await expect(accountant.getByRole('button', { name: 'Envoyer l’invitation' })).toHaveCount(0);
});
