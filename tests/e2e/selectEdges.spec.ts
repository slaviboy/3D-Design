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
import { drawBox, extents, onScreen, type Point } from './modelHelpers';

async function selectedKinds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__planar?.editor.session.selection.refs().map((ref) => ref.kind) ?? []);
}

async function counts(page: Page): Promise<{ edges: number; faces: number }> {
  return page.evaluate(() => {
    const store = window.__planar?.editor.session.doc.rootStore;
    if (!store) throw new Error('test hook missing: build with --mode e2e');
    return { edges: [...store.edges()].length, faces: [...store.faces()].length };
  });
}

/** Pixels in the selection blue within a few pixels of where a world point is drawn. */
async function selectionBlueNear(page: Page, point: Point): Promise<number> {
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
    const radius = Math.ceil(3 * scale);
    const data = context.getImageData(
      Math.round(screen.x * scale) - radius,
      Math.round(screen.y * scale) - radius,
      2 * radius + 1,
      2 * radius + 1,
    ).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [red, green, blue] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      if (blue - red > 60 && blue - green > 30) count++;
    }
    return count;
  }, point);
}

/**
 * How many pixels of the selection blue a vertical run through where a world point is drawn crosses: the width of a
 * selected, roughly horizontal line, in device pixels.
 */
async function selectionBlueAcross(page: Page, point: Point): Promise<number> {
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
    const reach = Math.ceil(8 * scale);
    const data = context.getImageData(
      Math.round(screen.x * scale),
      Math.round(screen.y * scale) - reach,
      1,
      2 * reach + 1,
    ).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [red, green, blue] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      if (blue - red > 60 && blue - green > 30) count++;
    }
    return count / scale;
  }, point);
}

test('selects a line with a click, shows it selected, and deletes it', async ({ page }) => {
  await drawBox(page);
  const { min, max } = await extents(page);
  const middle: Point = { x: (min.x + max.x) / 2, y: min.y, z: 1 };
  await page.keyboard.press('Escape');
  await page.keyboard.press(' ');
  expect(await selectionBlueNear(page, middle)).toBe(0);

  const edge = await onScreen(page, middle);
  await page.mouse.click(edge.x, edge.y);
  await expect.poll(() => selectedKinds(page)).toEqual(['edge']);
  // Drawn in the selection color over the model's own edge, not hidden under it, and wider than an edge.
  await expect.poll(() => selectionBlueNear(page, middle)).toBeGreaterThan(0);
  expect(await selectionBlueAcross(page, middle)).toBeGreaterThanOrEqual(2.5);

  // Deselected, it is an ordinary edge again.
  const view = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  if (!view) throw new Error('viewport not laid out');
  await page.mouse.click(view.x + 15, view.y + 15);
  await expect.poll(() => selectedKinds(page)).toEqual([]);
  await expect.poll(() => selectionBlueNear(page, middle)).toBe(0);
  await page.mouse.click(edge.x, edge.y);
  await expect.poll(() => selectedKinds(page)).toEqual(['edge']);

  // Deleting a box's edge takes the two faces it bounded with it, as in the reference.
  await page.keyboard.press('Delete');
  await expect.poll(() => counts(page)).toEqual({ edges: 11, faces: 4 });
});
