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
import { backColored, drawBox, extents, onScreen, type Point } from './modelHelpers';

/** Points spread over the inside of a horizontal face spanning the box's footprint, clear of its edges. */
function grid(min: Point, max: Point, z: number): Point[] {
  const points: Point[] = [];
  for (let i = 1; i < 10; i++) {
    for (let j = 1; j < 5; j++) {
      points.push({ x: min.x + (i / 10) * (max.x - min.x), y: min.y + (j / 5) * (max.y - min.y), z });
    }
  }
  return points;
}

// Views jump instead of gliding.
test.use({ reducedMotion: 'reduce' });

/** The next two frames have been drawn. */
async function drawn(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test('a box pushed almost flat shows its top, not the back of its bottom, from above and from low down', async ({
  page,
}) => {
  await drawBox(page);
  const { min, max } = await extents(page);
  await page.keyboard.press('p');
  const top = await onScreen(page, { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: 1 });
  await page.mouse.move(top.x, top.y, { steps: 3 });
  await page.mouse.click(top.x, top.y);
  await page.mouse.move(top.x, top.y + 20, { steps: 3 });

  // From ten micrometres above the bottom, far closer than the depth buffer can tell apart, to a few millimetres.
  for (const depth of ['999.99', '999.9', '999', '997']) {
    await page.keyboard.type(`${depth}mm`);
    await page.keyboard.press('Enter');
    const gap = 1 - Number(depth) / 1000;
    await expect.poll(async () => (await extents(page)).max.z).toBeCloseTo(gap, 7);
    await drawn(page);
    const points = grid(min, max, gap);
    expect(await backColored(page, points)).toBe(0);
  }

  await page.evaluate(() => {
    const session = window.__planar?.editor.session;
    if (!session) throw new Error('test hook missing: build with --mode e2e');
    session.setCamera({ ...session.camera, eye: { x: 7, y: -6, z: 2 }, target: { x: 1, y: 0.5, z: 0 } });
  });
  await drawn(page);
  expect(await backColored(page, grid(min, max, 0.003))).toBe(0);
});

test('pushing a box top down past its bottom takes the box, without it popping back on the way', async ({
  page,
}) => {
  await drawBox(page);
  const { min, max } = await extents(page);
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
  await page.keyboard.press('p');
  const top = await onScreen(page, { ...center, z: 1 });
  await page.mouse.move(top.x, top.y, { steps: 3 });
  await page.mouse.click(top.x, top.y);

  // Down past the bottom a few pixels at a time: the top only ever comes down.
  const below = await onScreen(page, { ...center, z: -1 });
  let lowest = 1;
  for (let step = 1; step <= 24; step++) {
    await page.mouse.move(top.x + (step / 24) * (below.x - top.x), top.y + (step / 24) * (below.y - top.y));
    const height = await page.evaluate(() => {
      const store = window.__planar?.editor.session.doc.rootStore;
      if (!store) throw new Error('test hook missing: build with --mode e2e');
      return Math.max(0, ...[...store.vertices()].map((vertex) => vertex.position.z));
    });
    expect(height).toBeLessThanOrEqual(lowest + 1e-9);
    lowest = height;
  }
  await expect(page.locator('.statusbar__hint')).toContainText(
    'Offset limited to 1000mm: this is the far side',
  );
  await page.mouse.click(below.x, below.y);
  await expect
    .poll(async () =>
      page.evaluate(() => window.__planar?.editor.session.doc.rootStore.vertices().next().done),
    )
    .toBe(true);
});
