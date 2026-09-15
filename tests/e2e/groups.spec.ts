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

/** Open groups and a fingerprint of every vertex position, read through the e2e-only test hook. */
async function modelState(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    let fingerprint = 0;
    for (const definition of editor.session.doc.definitions()) {
      for (const { position } of definition.store.vertices()) {
        fingerprint += position.x * 1.1 + position.y * 1.3 + position.z * 1.7;
      }
    }
    return { openGroups: editor.session.editPath.length, geometry: fingerprint.toFixed(6) };
  });
}

/** A viewport point (CSS pixels) where the active context shows an entity of `kind`, closest to the view center. */
async function pointOn(page: Page, kind: 'instance' | 'face') {
  const point = await page.evaluate((wanted) => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const { width, height } = editor.viewportSize;
    let best: { x: number; y: number; score: number } | null = null;
    for (let y = 20; y < height - 20; y += 10) {
      for (let x = 20; x < width - 20; x += 10) {
        if (editor.pickAt({ x, y })?.ref.kind !== wanted) continue;
        const score = Math.hypot(x - width / 2, y - height / 2);
        if (!best || score < best.score) best = { x, y, score };
      }
    }
    return best;
  }, kind);
  if (!point) throw new Error(`no ${kind} in view`);
  return point;
}

test('double-clicking a group opens it, so its faces can be pushed and pulled', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await page.evaluate(() => window.__planar?.editor.runCommand('file.openSample'));
  const viewport = page.getByRole('application', { name: '3D viewport' });
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('viewport not laid out');

  // The sample house is one group: a click selects it, a double-click opens it.
  const group = await pointOn(page, 'instance');
  await page.mouse.dblclick(bounds.x + group.x, bounds.y + group.y);
  await expect.poll(async () => (await modelState(page)).openGroups).toBe(1);

  const face = await pointOn(page, 'face');
  const before = await modelState(page);
  await page.keyboard.press('p');
  await page.mouse.move(bounds.x + face.x, bounds.y + face.y);
  await page.mouse.click(bounds.x + face.x, bounds.y + face.y);
  await page.keyboard.type('0.5m');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await modelState(page)).geometry).not.toBe(before.geometry);
  expect((await modelState(page)).openGroups).toBe(1);
});
