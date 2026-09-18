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

/** The model's size on screen and the camera's distance, through the e2e-only test hook. */
async function view(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const { camera, doc } = { camera: editor.session.camera, doc: editor.session.doc };
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const box = {
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
    };
    for (const definition of doc.definitions()) {
      for (const { position } of definition.store.vertices()) {
        box.minX = Math.min(box.minX, position.x);
        box.maxX = Math.max(box.maxX, position.x);
        box.minY = Math.min(box.minY, position.y);
        box.maxY = Math.max(box.maxY, position.y);
        box.minZ = Math.min(box.minZ, position.z);
        box.maxZ = Math.max(box.maxZ, position.z);
        const screen = window.__planar?.screenOf(position);
        if (!screen) continue;
        minX = Math.min(minX, screen.x);
        maxX = Math.max(maxX, screen.x);
        minY = Math.min(minY, screen.y);
        maxY = Math.max(maxY, screen.y);
      }
    }
    const { eye } = camera;
    return {
      widthPx: Number.isFinite(maxX - minX) ? maxX - minX : 0,
      heightPx: Number.isFinite(maxY - minY) ? maxY - minY : 0,
      modelSize: Math.hypot(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ),
      distance: Math.hypot(eye.x - camera.target.x, eye.y - camera.target.y, eye.z - camera.target.z),
    };
  });
}

async function wheelAt(page: Page, x: number, y: number, notches: number, deltaY: number) {
  await page.mouse.move(x, y);
  for (let i = 0; i < notches; i++) await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(120);
}

test('the wheel cannot zoom through the model or lose it in empty space', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  const viewport = page.getByRole('application', { name: '3D viewport' });
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('viewport not laid out');
  const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const corner = { x: bounds.x + bounds.width - 40, y: bounds.y + 40 };
  const openSample = async () => {
    await page.evaluate(() => window.__planar?.editor.runCommand('file.openSample'));
    await page.waitForTimeout(200);
  };

  // Zooming in a long way magnifies, stops short of the model's own scale, and can be undone by zooming out.
  await openSample();
  const start = await view(page);
  await wheelAt(page, centre.x, centre.y, 60, -100);
  const zoomedIn = await view(page);
  expect(zoomedIn.widthPx).toBeGreaterThan(start.widthPx);
  expect(zoomedIn.distance).toBeGreaterThan(1e-3);
  await wheelAt(page, centre.x, centre.y, 60, 100);
  const recovered = await view(page);
  expect(recovered.heightPx).toBeGreaterThan(4);

  // Zooming out a long way leaves the model visible, so the view can always be found again.
  await openSample();
  await wheelAt(page, centre.x, centre.y, 60, 100);
  const zoomedOut = await view(page);
  expect(zoomedOut.heightPx).toBeGreaterThan(4);

  // Zooming with the cursor over empty space magnifies at about the rate of zooming at the model.
  await openSample();
  const before = await view(page);
  await wheelAt(page, centre.x, centre.y, 12, -100);
  const onModel = (await view(page)).widthPx / before.widthPx;
  await openSample();
  await wheelAt(page, corner.x, corner.y, 12, -100);
  const offModel = (await view(page)).widthPx / before.widthPx;
  expect(offModel).toBeLessThanOrEqual(onModel * 1.5);
});
