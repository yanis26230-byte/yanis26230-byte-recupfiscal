import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

for (const path of ['/', '/audit', '/demo', '/mentions-legales', '/confidentialite']) {
  test(`mise en page sans débordement : ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}
