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

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The root model's materials and what its faces are painted with, read through the e2e-only test hook. */
async function paintState(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const { doc } = editor.session;
    const materials = [...doc.materials()].map((material) => ({
      id: material.id,
      name: material.name,
      color: material.color,
    }));
    const faces = [...doc.rootStore.faces()].map((face) => ({
      front: face.attributes.frontMaterialId,
      back: face.attributes.backMaterialId,
    }));
    return { materials, faces, dirty: editor.session.isDirty };
  });
}

async function onScreen(page: Page, point: Point) {
  const viewport = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  const screen = await page.evaluate((target) => window.__planar?.screenOf(target) ?? null, point);
  if (!viewport || !screen) throw new Error('point is not visible');
  return { x: viewport.x + screen.x, y: viewport.y + screen.y };
}

test('creates a material, paints a face with it, and keeps it through save and reopen', async ({
  page,
}, testInfo) => {
  // Force the download and file-input fallback, which works in every browser and can be automated.
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target.showOpenFilePicker;
    delete target.showSaveFilePicker;
  });
  await page.goto('/');
  const viewport = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  if (!viewport) throw new Error('viewport not laid out');
  const centerX = viewport.x + viewport.width / 2;
  const centerY = viewport.y + viewport.height / 2;

  // A 2 m × 1 m rectangle on the ground.
  await page.keyboard.press('r');
  await page.mouse.click(centerX - 40, centerY + 20);
  await page.mouse.move(centerX + 60, centerY - 30, { steps: 3 });
  await page.mouse.click(centerX + 60, centerY - 30);
  await page.keyboard.type('2m,1m');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await paintState(page)).faces.length).toBe(1);

  // Frame it from the top.
  await page.evaluate(() => window.__planar?.editor.runCommand('camera.view.top'));
  await page.keyboard.press('Shift+Z');

  // Create a material and give it a color.
  const panel = page.locator('[data-panel="materials"]');
  await panel.getByRole('button', { name: 'New Material' }).click();
  await expect(panel.getByRole('radio', { name: 'Material 1' })).toBeChecked();
  const hex = panel.getByRole('textbox', { name: 'Material color hex' });
  await hex.fill('#cc3322');
  await hex.press('Enter');
  await expect.poll(async () => (await paintState(page)).materials[0]?.color.r ?? 0).toBeCloseTo(0.6038, 3);

  // Paint the face by clicking its center with the Paint Bucket.
  await page.getByRole('button', { name: 'Paint Bucket' }).click();
  const center = await page.evaluate(() => {
    const store = window.__planar?.editor.session.doc.rootStore;
    const points = [...(store?.vertices() ?? [])].map((vertex) => vertex.position);
    const mean = (axis: 'x' | 'y' | 'z') => points.reduce((sum, p) => sum + p[axis], 0) / points.length;
    return { x: mean('x'), y: mean('y'), z: mean('z') };
  });
  const target = await onScreen(page, center);
  await page.mouse.move(target.x, target.y, { steps: 3 });
  await page.mouse.click(target.x, target.y);

  const painted = await paintState(page);
  const materialId = painted.materials[0]?.id;
  expect(materialId).toBeDefined();
  // Seen from the top, the ground face shows its back.
  expect(painted.faces).toEqual([{ front: null, back: materialId }]);

  // Save, open something else, then reopen the saved file.
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+S');
  const download = await downloadPromise;
  const path = testInfo.outputPath('Painted.planar');
  await download.saveAs(path);
  await expect.poll(async () => (await paintState(page)).dirty).toBe(false);

  await page.evaluate(() => window.__planar?.editor.runCommand('file.new'));
  await expect.poll(async () => (await paintState(page)).materials.length).toBe(0);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+O');
  const chooser = await chooserPromise;
  await chooser.setFiles(path);
  await expect
    .poll(async () => (await paintState(page)).materials.map((material) => material.name))
    .toEqual(['Material 1']);
  const reopened = await paintState(page);
  expect(reopened.faces).toEqual([{ front: null, back: reopened.materials[0]?.id }]);
  expect(reopened.materials[0]?.color.r).toBeCloseTo(0.6038, 3);
  await expect(panel.getByRole('radio', { name: 'Material 1' })).toBeVisible();
});
