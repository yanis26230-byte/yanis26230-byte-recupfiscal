import { expect, test, type Browser, type Page } from '@playwright/test';
import { companyViaQuickAudit, expectNoHorizontalScroll, loginByMagicLink } from './helpers';

test.describe.configure({ mode: 'serial' });

async function newPage(browser: Browser): Promise<Page> {
  const devices = (await import('@playwright/test')).devices;
  return (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
}

test('back-office : accès réservé, paramètres à quatre yeux, conditions publiées (critères 6, 7)', async ({ browser }) => {
  const client = await newPage(browser);
  await loginByMagicLink(client, 'curieux@exemple.fr');
  expect((await client.goto('/admin'))?.status()).toBe(404);

  const admin = await newPage(browser);
  await loginByMagicLink(admin, 'admin@plateforme.test');
  await admin.goto('/admin');
  await expect(admin.getByRole('heading', { name: 'Indicateurs' })).toBeVisible();
  await expectNoHorizontalScroll(admin);

  // Second administrateur (quatre yeux).
  const admin2 = await newPage(browser);
  await loginByMagicLink(admin2, 'admin2@plateforme.test');
  await admin.goto('/admin/utilisateurs');
  await admin.getByLabel('Adresse e-mail').fill('admin2@plateforme.test');
  await admin.getByLabel('Rôle').selectOption('administrateur');
  await admin.getByRole('button', { name: 'Appliquer' }).click();
  await expect(admin.getByTestId('admin-result')).toContainText('Rôle mis à jour');

  // Renseigner un paramètre « à renseigner » (nouvelle version), valider par l'autre administrateur, publier.
  await admin.goto('/admin/parametres?statut=a_renseigner&cle=pass_annuel');
  const card = admin.getByTestId('parameters').locator('li').first();
  await card.getByText('Renseigner (nouvelle version brouillon)').click();
  await card.getByLabel('Valeur').fill('48 000');
  await card.getByLabel('Source').fill('https://www.urssaf.fr/exemple-de-test');
  await card.getByLabel('Date de vérification').fill('2026-11-01');
  await card.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(card.getByTestId('admin-result')).toContainText('Brouillon créé');
  await admin.goto('/admin/parametres?statut=brouillon&cle=pass_annuel');
  await admin.getByRole('button', { name: 'Valider (second administrateur)' }).click();
  await expect(admin.getByTestId('admin-result')).toContainText('quatre yeux');
  await admin2.goto('/admin/parametres?statut=brouillon&cle=pass_annuel');
  await admin2.getByRole('button', { name: 'Valider (second administrateur)' }).click();
  await expect(admin2.getByTestId('admin-result')).toContainText('Paramètre validé');
  await admin.goto('/admin/parametres?statut=valide&cle=pass_annuel');
  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('button', { name: 'Publier' }).click();
  await expect(admin.getByTestId('admin-result')).toContainText(/Publié\. \d+ cas de référence relancés, tous réussis/);

  // Conditions du mandat publiées.
  await admin.goto('/admin/commercial');
  await admin.getByLabel('Titre').fill('Conditions du mandat (texte de test)');
  await admin.getByLabel('Corps du texte').fill('Texte de test : commission uniquement sur les sommes réellement remboursées. À faire valider par un professionnel du droit.');
  await admin.getByRole('button', { name: 'Publier une nouvelle version' }).click();
  await expect(admin.getByTestId('admin-result').last()).toContainText('Nouvelle version publiée');
});

test('conversion : dossier ouvert, mandat préparé sans signature simulée, suivi notifié (critères 12, 13)', async ({ browser }) => {
  const owner = await newPage(browser);
  await companyViaQuickAudit(owner, 'dirigeante@conversion.fr', '443061841', 'Conversion SAS');
  const companyUrl = owner.url();
  await owner.getByRole('link', { name: 'Résultats' }).first().click();
  await owner.getByRole('link', { name: 'Je veux récupérer cet argent' }).click();
  await expect(owner.getByTestId('terms')).toContainText('commission uniquement sur les sommes réellement remboursées');
  await expect(owner.getByTestId('signature-disabled')).toBeVisible();
  await expectNoHorizontalScroll(owner);
  await owner.getByLabel('Prénom').fill('Alice');
  await owner.getByLabel('Nom', { exact: true }).fill('Durand');
  await owner.getByLabel('Fonction').fill('Présidente');
  await owner.getByRole('button', { name: 'Ouvrir mon dossier et préparer le mandat' }).click();
  await expect(owner.getByText('Vous devez déclarer être habilité')).toBeVisible();
  await owner.getByText('Je déclare être habilité(e)').click();
  await owner.getByText('J’ai lu et j’accepte les conditions').click();
  await owner.getByRole('button', { name: 'Ouvrir mon dossier et préparer le mandat' }).click();
  await expect(owner.getByTestId('mandate-status')).toHaveText('À signer');
  await expect(owner.getByText('le mandat n’est pas signé')).toBeVisible();
  await expect(owner.getByTestId('case-status')).toHaveText('Nouveau');
  await expectNoHorizontalScroll(owner);
  const caseUrl = owner.url().replace(/\?.*$/, '');

  // Back-office : vérification, statut, demande de pièce.
  const admin = await newPage(browser);
  await loginByMagicLink(admin, 'admin@plateforme.test');
  await admin.goto('/admin/dossiers');
  await admin.getByRole('link', { name: 'Conversion SAS' }).click();
  await admin.getByRole('button', { name: 'Marquer vérifiée' }).click();
  await expect(admin.getByText('Entreprise vérifiée.')).toBeVisible();
  await admin.getByLabel('Nouveau statut').selectOption('en_analyse');
  await admin.getByLabel('Message').fill('Nous analysons vos documents.');
  await admin.getByRole('button', { name: 'Appliquer' }).click();
  await expect(admin.getByText('Statut mis à jour, client notifié.')).toBeVisible();
  // Dépôt impossible sans mandat signé (contrôlé en base).
  const apply = admin.getByRole('button', { name: 'Appliquer' });
  for (const s of ['a_valider_expert', 'pret_a_deposer']) { await admin.getByLabel('Nouveau statut').selectOption(s); await apply.click(); await expect(apply).toBeEnabled(); }
  await admin.getByLabel('Nouveau statut').selectOption('depose');
  await admin.getByRole('button', { name: 'Appliquer' }).click();
  await expect(admin.getByText(/Dépôt impossible : aucun mandat signé/)).toBeVisible();

  // Le client voit l'avancement et la notification.
  await owner.goto(caseUrl);
  await expect(owner.getByTestId('case-status')).toHaveText('Prêt à déposer');
  await expect(owner.getByTestId('timeline')).toContainText('Nous analysons vos documents.');
  await owner.goto('/espace');
  await expect(owner.getByTestId('notifications')).toContainText('Votre dossier');
  await owner.goto(companyUrl);
  await expect(owner.getByTestId('cases')).toContainText('Prêt à déposer');
});
