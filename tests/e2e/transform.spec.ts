import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Root-context extents, rounded to micrometers. */
async function extents(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const points = [...editor.session.doc.rootStore.vertices()].map((vertex) => vertex.position);
    const round = (value: number) => Math.round(value * 1e6) / 1e6;
    const bound = (axis: 'x' | 'y' | 'z', pick: (...values: number[]) => number) =>
      round(pick(...points.map((p) => p[axis])));
    return {
      min: { x: bound('x', Math.min), y: bound('y', Math.min), z: bound('z', Math.min) },
      max: { x: bound('x', Math.max), y: bound('y', Math.max), z: bound('z', Math.max) },
    };
  });
}

async function size(page: Page) {
  const { min, max } = await extents(page);
  return { x: Math.round((max.x - min.x) * 1e6) / 1e6, y: Math.round((max.y - min.y) * 1e6) / 1e6 };
}

/** Page coordinates of a world point in the viewport. */
async function onScreen(page: Page, point: Point) {
  const viewport = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  const screen = await page.evaluate((target) => window.__planar?.screenOf(target) ?? null, point);
  if (!viewport || !screen) throw new Error('point is not visible');
  return { x: viewport.x + screen.x, y: viewport.y + screen.y };
}

async function clickAt(page: Page, point: Point): Promise<void> {
  const target = await onScreen(page, point);
  await page.mouse.move(target.x, target.y, { steps: 3 });
  await page.mouse.click(target.x, target.y);
}

test('rotates a rectangle by a typed angle and scales it by a typed factor', async ({ page }) => {
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
  await expect.poll(() => size(page)).toEqual({ x: 2, y: 1 });
  await page.evaluate(() => window.__planar?.editor.runCommand('camera.view.top'));

  // Rotate 90° about the lower-left corner.
  const { min, max } = await extents(page);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('q');
  await clickAt(page, { x: min.x, y: min.y, z: 0 });
  await clickAt(page, { x: max.x, y: min.y, z: 0 });
  await page.keyboard.type('90');
  await page.keyboard.press('Enter');
  await expect.poll(() => size(page)).toEqual({ x: 1, y: 2 });

  // Scale by 2 from the upper-right grip, after framing the rotated shape so the grip is on screen.
  await page.keyboard.press('Shift+Z');
  await page.keyboard.press('s');
  const rotated = await extents(page);
  await clickAt(page, { x: rotated.max.x, y: rotated.max.y, z: 0 });
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await expect.poll(() => size(page)).toEqual({ x: 2, y: 4 });

  await page.keyboard.press('ControlOrMeta+Z');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => size(page)).toEqual({ x: 2, y: 1 });
});
