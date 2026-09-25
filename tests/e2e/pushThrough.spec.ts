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
import { drawBox, extents, onScreen } from './modelHelpers';

/** How many faces the model has, and how many holes each face lying on the ground has. */
async function faces(page: Page): Promise<{ count: number; groundHoles: number[] }> {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const store = editor.session.doc.rootStore;
    const all = [...store.faces()];
    return {
      count: all.length,
      groundHoles: all
        .filter((face) => store.loopPoints(face.outer).every((p) => Math.abs(p.z) < 1e-9))
        .map((face) => face.inners.length),
    };
  });
}

// Views jump instead of gliding, so framing the box takes effect at once.
test.use({ reducedMotion: 'reduce' });

/**
 * Draws a 2 m × 1 m × 1 m box, marks a 1 m × 0.5 m rectangle in the middle of its top and pushes it down past the
 * bottom, which cuts a hole through. Returns the hole's corners at the top, in page coordinates.
 */
async function boxWithHole(page: Page) {
  await drawBox(page);
  const { min, max } = await extents(page);
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
  // Frame the box, so the rectangle's corners are well clear of its edges and don't snap to them.
  await page.keyboard.press('Shift+Z');

  await page.keyboard.press('r');
  const corner = await onScreen(page, { x: center.x - 0.5, y: center.y - 0.25, z: 1 });
  const toward = await onScreen(page, { x: center.x + 0.5, y: center.y + 0.25, z: 1 });
  await page.mouse.move(corner.x, corner.y, { steps: 3 });
  await page.mouse.click(corner.x, corner.y);
  await page.mouse.move(toward.x, toward.y, { steps: 3 });
  await page.keyboard.type('1m,0.5m');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await faces(page)).count).toBe(7);

  // Push it down, with the pointer going on to a point a metre below the box.
  await page.keyboard.press('p');
  const top = await onScreen(page, { x: center.x, y: center.y, z: 1 });
  await page.mouse.move(top.x, top.y, { steps: 3 });
  await page.mouse.click(top.x, top.y);
  const below = await onScreen(page, { x: center.x, y: center.y, z: -1 });
  await page.mouse.move(below.x, below.y, { steps: 6 });
  await expect(page.locator('.statusbar__hint')).toContainText('Offset limited to 1000mm');
  await page.mouse.click(below.x, below.y);
  await expect.poll(() => faces(page)).toEqual({ count: 10, groundHoles: [1] });
  return { corner, opposite: toward };
}

test('pushing a rectangle on top down past the bottom stops there and cuts a hole', async ({ page }) => {
  await boxWithHole(page);
});

test('a rectangle from one corner of the opening to the diagonal one closes it', async ({ page }) => {
  const { corner, opposite } = await boxWithHole(page);
  await page.keyboard.press('r');
  await page.mouse.move(corner.x, corner.y, { steps: 3 });
  await expect(page.getByTestId('inference-label')).toHaveText('Endpoint');
  await page.mouse.click(corner.x, corner.y);
  await page.mouse.move(opposite.x, opposite.y, { steps: 3 });
  await expect(page.getByTestId('inference-label')).toHaveText('Endpoint');
  await page.mouse.click(opposite.x, opposite.y);
  await expect.poll(async () => (await faces(page)).count).toBe(11);
});
