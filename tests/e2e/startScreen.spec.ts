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

  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
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

test('shows the preview of a recently saved file', async ({ page }) => {
  // Force the download fallback, which works in every browser and can be automated.
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target.showOpenFilePicker;
    delete target.showSaveFilePicker;
  });
  await page.goto('/');
  const start = page.getByRole('dialog', { name: 'Start' });
  await expect(start).toBeVisible();
  await start.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(start).toBeHidden();

  await page.evaluate(() => window.__planar?.editor.runCommand('file.openSample'));
  await expect
    .poll(() => page.evaluate(() => window.__planar?.editor.session.doc.rootStore.instanceCount))
    .toBe(1);
  const download = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+S');
  expect((await download).suggestedFilename()).toBe('Sample House.planar');

  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Start Screen…' }).click();
  await expect(start).toBeVisible();
  const entry = start.getByRole('button', { name: 'Sample House.planar' });
  await expect(entry).toBeVisible();
  const preview = entry.locator('img.start-screen__thumbnail');
  await expect(preview).toBeVisible();
  await expect
    .poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
});
