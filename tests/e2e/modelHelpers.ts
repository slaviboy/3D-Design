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
import { expect } from './fixtures';

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The model's bounding box, rounded to a micrometre. */
export async function extents(page: Page) {
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

/** How many of the world points are drawn in the faces' back color (blue-gray) rather than their front color. */
export async function backColored(page: Page, points: readonly Point[]): Promise<number> {
  return page.evaluate((targets) => {
    const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas');
    if (!canvas) throw new Error('no viewport canvas');
    const scale = canvas.width / canvas.clientWidth;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d');
    if (!context) throw new Error('no 2D context');
    context.drawImage(canvas, 0, 0);
    let count = 0;
    for (const target of targets) {
      const screen = window.__planar?.screenOf(target);
      if (!screen) throw new Error('point not on screen');
      const [red = 0, , blue = 0] = context.getImageData(
        Math.round(screen.x * scale),
        Math.round(screen.y * scale),
        1,
        1,
      ).data;
      if (blue - red > 12) count++;
    }
    return count;
  }, points);
}

/** Page coordinates of a world point in the viewport. */
export async function onScreen(page: Page, point: Point) {
  const viewport = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  const screen = await page.evaluate((target) => window.__planar?.screenOf(target) ?? null, point);
  if (!viewport || !screen) throw new Error('point is not visible');
  return { x: viewport.x + screen.x, y: viewport.y + screen.y };
}

/** Draws a 2 m × 1 m rectangle and pulls it up 1 m, in the default view (from the front right, above). */
export async function drawBox(page: Page): Promise<void> {
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
  await expect.poll(async () => (await extents(page)).max.x - (await extents(page)).min.x).toBeCloseTo(2, 6);

  const { min, max } = await extents(page);
  await page.keyboard.press('p');
  const face = await onScreen(page, { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: 0 });
  await page.mouse.move(face.x, face.y, { steps: 3 });
  await page.mouse.click(face.x, face.y);
  await page.mouse.move(face.x, face.y - 40, { steps: 3 });
  await page.keyboard.type('1m');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await extents(page)).max.z).toBe(1);
}
