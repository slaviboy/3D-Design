import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Page coordinates of a world point in the viewport. */
async function onScreen(page: Page, point: { x: number; y: number; z: number }) {
  const viewport = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  const screen = await page.evaluate((target) => window.__planar?.screenOf(target) ?? null, point);
  if (!viewport || !screen) throw new Error('point is not visible');
  return { x: viewport.x + screen.x, y: viewport.y + screen.y };
}

async function clickWorld(page: Page, point: { x: number; y: number; z: number }): Promise<void> {
  const target = await onScreen(page, point);
  await page.mouse.move(target.x, target.y, { steps: 3 });
  await page.mouse.click(target.x, target.y);
}

test('dimensions an edge and edits the dimension text', async ({ page }) => {
  await page.goto('/');
  const viewport = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  if (!viewport) throw new Error('viewport not laid out');
  const centerX = viewport.x + viewport.width / 2;
  const centerY = viewport.y + viewport.height / 2;

  await page.keyboard.press('r');
  await page.mouse.click(centerX - 40, centerY + 20);
  await page.mouse.move(centerX + 60, centerY - 30, { steps: 3 });
  await page.mouse.click(centerX + 60, centerY - 30);
  await page.keyboard.type('2m,1m');
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.__planar?.editor.runCommand('camera.view.top'));

  const bounds = await page.evaluate(() => {
    const points = [...(window.__planar?.editor.session.doc.rootStore.vertices() ?? [])].map(
      (v) => v.position,
    );
    return {
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
    };
  });

  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Dimension' }).click();
  await clickWorld(page, { x: bounds.minX, y: bounds.minY, z: 0 });
  await clickWorld(page, { x: bounds.maxX, y: bounds.minY, z: 0 });
  await clickWorld(page, { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY - 0.4, z: 0 });

  const label = page.getByTestId('annotation-label');
  await expect(label).toHaveText('2000mm');

  await label.click();
  const dialog = page.getByRole('dialog', { name: 'Dimension Text' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill('Width');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(label).toHaveText('Width');

  await page.keyboard.press('ControlOrMeta+Z');
  await expect(label).toHaveText('2000mm');
});
