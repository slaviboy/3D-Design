/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { extents, onScreen, type Point } from './modelHelpers';

/** Geometry statistics read through the e2e-only test hook. Extents cover the root context only. */
async function stats(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const doc = editor.session.doc;
    let faces = 0;
    for (const definition of doc.definitions()) faces += [...definition.store.faces()].length;
    const points = [...doc.rootStore.vertices()].map((vertex) => vertex.position);
    const size = (axis: 'x' | 'y' | 'z') =>
      points.length === 0
        ? 0
        : Math.round(
            (Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis]))) * 1e6,
          ) / 1e6;
    return {
      faces,
      instances: doc.rootStore.instanceCount,
      sizeX: size('x'),
      sizeY: size('y'),
      sizeZ: size('z'),
      dirty: editor.session.isDirty,
      platform: editor.platform,
    };
  });
}

test('draws a box with exact dimensions, copies it into an array, groups it, undoes, saves and reopens', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target.showOpenFilePicker;
    delete target.showSaveFilePicker;
  });
  await page.goto('/');
  const viewport = page.getByRole('application', { name: '3D viewport' });
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('viewport not laid out');
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  // Rectangle with typed dimensions; the origin is inferred at the view center.
  await page.keyboard.press('r');
  const measurements = page.getByTestId('measurements');
  await expect(page.getByText('Dimensions', { exact: true })).toBeVisible();
  await page.mouse.move(centerX + 3, centerY - 2);
  await expect(page.getByTestId('inference-label')).toHaveText('Origin');
  await page.mouse.click(centerX - 40, centerY + 20);
  await page.mouse.move(centerX + 60, centerY - 30, { steps: 4 });
  await page.mouse.click(centerX + 60, centerY - 30);
  await expect.poll(async () => (await stats(page)).faces).toBe(1);
  await page.keyboard.type('2m,1m');
  await expect(measurements).toHaveValue('2m,1m');
  await page.keyboard.press('Enter');
  await expect.poll(() => stats(page)).toMatchObject({ faces: 1, sizeX: 2, sizeY: 1, sizeZ: 0 });

  // Push/Pull the face up by a typed distance.
  await page.evaluate(() => window.__planar?.editor.runCommand('camera.view.top'));
  await page.keyboard.press('p');
  await page.mouse.move(centerX, centerY);
  await page.mouse.click(centerX, centerY);
  await page.keyboard.type('1m');
  await page.keyboard.press('Enter');
  await expect.poll(() => stats(page)).toMatchObject({ faces: 6, sizeX: 2, sizeY: 1, sizeZ: 1 });

  // Copy the box 3 m to the right, then make it an array of three copies.
  const { platform } = await stats(page);
  const copyKey = platform === 'mac' ? 'Alt' : 'Control';
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('m');
  await page.mouse.click(centerX, centerY);
  await page.keyboard.down(copyKey);
  await page.mouse.move(centerX + 120, centerY, { steps: 6 });
  await page.mouse.click(centerX + 120, centerY);
  await page.keyboard.up(copyKey);
  // Where the dragged copy lands depends on the zoom; it may even merge with the original. Typing a distance
  // replaces it with a copy exactly 3 m away.
  await expect.poll(async () => (await stats(page)).faces).toBeGreaterThan(6);
  await page.keyboard.type('3m');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await stats(page)).faces).toBe(12);
  await page.keyboard.type('3x');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await stats(page)).faces).toBe(24);

  // Group everything, undo and redo.
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+G');
  await expect.poll(async () => (await stats(page)).instances).toBe(1);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => stats(page)).toMatchObject({ instances: 0, faces: 24 });
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect.poll(() => stats(page)).toMatchObject({ instances: 1, faces: 24 });

  // Save, start a new model, and open the file again.
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+S');
  const download = await downloadPromise;
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  await expect.poll(async () => (await stats(page)).dirty).toBe(false);
  await page.evaluate(() => window.__planar?.editor.runCommand('file.new'));
  await expect.poll(async () => (await stats(page)).faces).toBe(0);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+O');
  const chooser = await chooserPromise;
  await chooser.setFiles(path);
  await expect.poll(() => stats(page)).toMatchObject({ instances: 1, faces: 24, dirty: false });
});

/** Device pixels in the dark of a plain edge along a short horizontal run through where a world point is drawn. */
async function edgeDarkAcross(page: Page, point: Point): Promise<number> {
  return page.evaluate((target) => {
    const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas');
    const screen = window.__planar?.screenOf(target);
    if (!canvas || !screen) throw new Error('nothing drawn there');
    const scale = canvas.width / canvas.clientWidth;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d');
    if (!context) throw new Error('no 2D context');
    context.drawImage(canvas, 0, 0);
    const reach = Math.ceil(6 * scale);
    const data = context.getImageData(
      Math.round(screen.x * scale) - reach,
      Math.round(screen.y * scale),
      2 * reach + 1,
      1,
    ).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.max(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0) < 150) count++;
    }
    return count;
  }, point);
}

test('a polygon pulled up with Push/Pull shows a line down each side it turns', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await page
    .getByRole('toolbar', { name: 'Tools' })
    .getByRole('button', { name: 'Polygon', exact: true })
    .click();
  const center = await onScreen(page, { x: 1, y: 1, z: 0 });
  await page.mouse.move(center.x, center.y, { steps: 3 });
  await page.mouse.click(center.x, center.y);
  const toward = await onScreen(page, { x: 2, y: 1, z: 0 });
  await page.mouse.move(toward.x, toward.y, { steps: 3 });
  await page.keyboard.type('1m');
  await page.keyboard.press('Enter');
  await expect.poll(() => stats(page)).toMatchObject({ faces: 1 });

  await page.keyboard.press('p');
  await page.mouse.move(center.x, center.y, { steps: 3 });
  await page.mouse.click(center.x, center.y);
  await page.mouse.move(center.x, center.y - 40, { steps: 3 });
  await page.keyboard.type('1m');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await extents(page)).max.z).toBe(1);

  // The six edges up the sides are ordinary edges, not soft ones as on a cylinder.
  const sides = await page.evaluate(() => {
    const store = window.__planar?.editor.session.doc.rootStore;
    if (!store) throw new Error('test hook missing: build with --mode e2e');
    return [...store.edges()]
      .map((edge) => ({ a: store.position(edge.v0), b: store.position(edge.v1), soft: edge.attributes.soft }))
      .filter(({ a, b }) => Math.abs(a.z - b.z) > 0.5);
  });
  expect(sides.map(({ soft }) => soft)).toEqual([false, false, false, false, false, false]);
  // The one furthest toward the camera, at the front right, lies between two sides it sees, and shows as a line.
  const front = sides.reduce((best, side) => (side.a.x - side.a.y > best.a.x - best.a.y ? side : best));
  expect(await edgeDarkAcross(page, { x: front.a.x, y: front.a.y, z: 0.5 })).toBeGreaterThan(0);
});
