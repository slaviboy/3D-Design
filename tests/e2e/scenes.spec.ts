import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The camera, rounded so equal views compare equal. */
async function camera(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const round = (value: number) => Math.round(value * 1e6) / 1e6;
    const { eye, target, up, projection } = editor.session.camera;
    return {
      eye: [eye.x, eye.y, eye.z].map(round),
      target: [target.x, target.y, target.z].map(round),
      up: [up.x, up.y, up.z].map(round),
      projection,
    };
  });
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const doc = window.__planar?.editor.session.doc;
    if (!doc) throw new Error('test hook missing: build with --mode e2e');
    const points = [...doc.rootStore.vertices()].map((vertex) => vertex.position);
    return {
      faces: doc.rootStore.faceCount,
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxY: Math.max(...points.map((p) => p.y)),
      maxZ: Math.max(...points.map((p) => p.z)),
      sections: [...doc.rootStore.sectionPlanes()].map((plane) => ({
        active: plane.active,
        z: Math.round(plane.point.z * 1e6) / 1e6,
        normalZ: plane.normal.z,
      })),
      shadows: doc.shadows.enabled,
    };
  });
}

/** Waits until the browser has painted two more frames. */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

test('a scene restores the camera, a section plane cuts a box, and shadows turn on', async ({ page }) => {
  await page.goto('/');
  const viewport = page.getByRole('application', { name: '3D viewport' });
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('viewport not laid out');
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  // A 2 m box: a typed rectangle pushed up by a typed distance.
  await page.keyboard.press('r');
  await page.mouse.click(centerX - 40, centerY + 20);
  await page.mouse.move(centerX + 60, centerY - 30, { steps: 4 });
  await page.mouse.click(centerX + 60, centerY - 30);
  await expect.poll(async () => (await geometry(page)).faces).toBe(1);
  await page.keyboard.type('2m,2m');
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.__planar?.editor.runCommand('camera.view.top'));
  await page.keyboard.press('p');
  await page.mouse.move(centerX, centerY);
  await page.mouse.click(centerX, centerY);
  await page.keyboard.type('2m');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await geometry(page)).faces).toBe(6);
  await page.keyboard.press('Space');

  // Add a scene from the Scenes panel.
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Scenes' }).click();
  const scenesPanel = page.getByRole('region', { name: 'Scenes' });
  await scenesPanel.getByRole('button', { name: 'Add', exact: true }).click();
  const tab = page.getByRole('tab', { name: 'Scene 1' });
  await expect(tab).toBeVisible();
  const saved = await camera(page);

  // Change the view, then return to the scene through its tab.
  await page.evaluate(() => window.__planar?.editor.runCommand('camera.view.iso'));
  await expect.poll(() => camera(page)).not.toEqual(saved);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => camera(page), { timeout: 5000 }).toEqual(saved);

  // Place a section plane on the top face of the box.
  await nextFrames(page);
  const box = await geometry(page);
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Section Plane' }).click();
  const top = { x: (box.minX + box.maxX) / 2 + 0.3, y: (box.minY + box.maxY) / 2 + 0.2, z: box.maxZ };
  const area = await viewport.boundingBox();
  const screen = await page.evaluate((point) => window.__planar?.screenOf(point) ?? null, top);
  if (!area || !screen) throw new Error('the top face is not visible');
  await page.mouse.move(area.x + screen.x, area.y + screen.y, { steps: 3 });
  await page.mouse.click(area.x + screen.x, area.y + screen.y);
  await expect
    .poll(async () => (await geometry(page)).sections)
    .toEqual([{ active: true, z: box.maxZ, normalZ: 1 }]);
  await expect(
    page.getByRole('region', { name: 'Entity Info' }).getByTestId('entity-info-heading'),
  ).toHaveText('Section Plane');

  // Turn shadows on from the Shadows panel; the fixtures fail the test on any console error.
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Shadows' }).click();
  const shadowsPanel = page.getByRole('region', { name: 'Shadows' });
  await shadowsPanel.getByRole('button', { name: 'Shadows Off' }).click();
  await expect(shadowsPanel.getByRole('button', { name: 'Shadows On' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(async () => (await geometry(page)).shadows).toBe(true);
  await nextFrames(page);
  await page.evaluate(() => window.__planar?.editor.runCommand('camera.view.iso'));
  await nextFrames(page);
});
