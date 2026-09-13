import { expect, test } from './fixtures';

test.use({ startScreen: true });

test('offers templates at startup, reopens from the File menu, and can be turned off', async ({ page }) => {
  await page.goto('/');
  const start = page.getByRole('dialog', { name: 'Start' });
  await expect(start).toBeVisible();

  await start.getByRole('button', { name: /Site Plan/ }).click();
  await expect(start).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.__planar?.editor.session.doc.rootStore.instanceCount))
    .toBe(1);

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Start Screen…' }).click();
  await expect(start).toBeVisible();
  await start.getByRole('checkbox', { name: 'Show at startup' }).uncheck();
  await start.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(start).toBeHidden();

  await page.reload();
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await expect(page.getByRole('application', { name: '3D viewport' })).toBeVisible();
  await expect(start).toBeHidden();
});
