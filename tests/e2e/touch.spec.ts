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
}

/** Viewport-local screen position of a world point. */
async function screenOf(page: Page, world: { x: number; y: number; z: number }): Promise<Point> {
  const screen = await page.evaluate((target) => window.__planar?.screenOf(target) ?? null, world);
  if (!screen) throw new Error('point is not visible');
  return screen;
}

/** A synthetic finger event on the view, at viewport-local coordinates. */
async function finger(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  id: number,
  point: Point,
): Promise<void> {
  await page.evaluate(
    ({ type, id, point }) => {
      const host = document.querySelector('.viewport');
      if (!host) throw new Error('no viewport');
      const rect = host.getBoundingClientRect();
      host.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: 'touch',
          isPrimary: id === 1,
          clientX: rect.left + point.x,
          clientY: rect.top + point.y,
          button: type === 'pointermove' ? -1 : 0,
          buttons: type === 'pointerup' ? 0 : 1,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    },
    { type, id, point },
  );
}

async function tap(page: Page, point: Point, id = 1): Promise<void> {
  await finger(page, 'pointerdown', id, point);
  await finger(page, 'pointerup', id, point);
}

/** Several fingers down together and up again: a two- or three-finger tap. */
async function tapWith(page: Page, fingers: number): Promise<void> {
  const points = Array.from({ length: fingers }, (_, index) => ({ x: 60 + index * 40, y: 60 }));
  for (const [index, point] of points.entries()) await finger(page, 'pointerdown', 10 + index, point);
  for (const [index, point] of points.entries()) await finger(page, 'pointerup', 10 + index, point);
}

async function faces(page: Page): Promise<number> {
  return page.evaluate(() => [...(window.__planar?.editor.session.doc.rootStore.faces() ?? [])].length);
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
}

test('draws with taps, undoes with two fingers and redoes with three, naming each step', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('r');
  await tap(page, await screenOf(page, { x: -1, y: -1, z: 0 }));
  await tap(page, await screenOf(page, { x: 1, y: 1, z: 0 }), 2);
  await expect.poll(() => faces(page)).toBe(1);

  await page.waitForTimeout(400);
  await tapWith(page, 2);
  await expect.poll(() => faces(page)).toBe(0);
  await expect(page.getByRole('status').filter({ hasText: 'Undo Rectangle' })).toBeVisible();

  await tapWith(page, 3);
  await expect.poll(() => faces(page)).toBe(1);
  await expect(page.getByRole('status').filter({ hasText: 'Redo Rectangle' })).toBeVisible();
});

test('pinches to zoom and opens the context menu on a long press', async ({ page }) => {
  await openApp(page);
  const distance = () =>
    page.evaluate(() => {
      const camera = window.__planar?.editor.session.camera;
      if (!camera) throw new Error('no camera');
      return Math.hypot(
        camera.eye.x - camera.target.x,
        camera.eye.y - camera.target.y,
        camera.eye.z - camera.target.z,
      );
    });
  const before = await distance();
  await finger(page, 'pointerdown', 1, { x: 200, y: 200 });
  await finger(page, 'pointerdown', 2, { x: 260, y: 200 });
  for (let step = 1; step <= 6; step++) {
    await finger(page, 'pointermove', 1, { x: 200 - step * 10, y: 200 });
    await finger(page, 'pointermove', 2, { x: 260 + step * 10, y: 200 });
  }
  await finger(page, 'pointerup', 1, { x: 140, y: 200 });
  await finger(page, 'pointerup', 2, { x: 320, y: 200 });
  expect(await distance()).toBeLessThan(before);

  await finger(page, 'pointerdown', 3, { x: 200, y: 200 });
  await page.waitForTimeout(700);
  await expect(page.getByRole('menu')).toBeVisible();
  await finger(page, 'pointerup', 3, { x: 200, y: 200 });
  await expect(page.getByRole('menu')).toBeVisible();
});

test('pushes a face by tapping it, dragging and lifting', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('r');
  await tap(page, await screenOf(page, { x: -1, y: -1, z: 0 }));
  await tap(page, await screenOf(page, { x: 1, y: 1, z: 0 }), 2);
  await expect.poll(() => faces(page)).toBe(1);
  await page.waitForTimeout(400);

  await page.keyboard.press('p');
  const face = await screenOf(page, { x: 0, y: 0, z: 0 });
  await tap(page, face);
  await finger(page, 'pointerdown', 3, face);
  for (let step = 1; step <= 5; step++)
    await finger(page, 'pointermove', 3, { x: face.x, y: face.y - step * 12 });
  await finger(page, 'pointerup', 3, { x: face.x, y: face.y - 60 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.max(
          ...[...(window.__planar?.editor.session.doc.rootStore.vertices() ?? [])].map((v) => v.position.z),
        ),
      ),
    )
    .toBeGreaterThan(0.1);
});

test('switches to Orbit and back from a corner, and with the pen button', async ({ page }) => {
  await openApp(page);
  const viewport = page.getByRole('application', { name: '3D viewport' });
  const box = await viewport.boundingBox();
  if (!box) throw new Error('viewport not laid out');
  const corner = { x: 20, y: box.height - 20 };

  await tap(page, corner);
  await expect(viewport).toHaveAttribute('data-active-tool', 'tool.orbit');
  await page.waitForTimeout(400);
  await tap(page, corner, 2);
  await expect(viewport).toHaveAttribute('data-active-tool', 'tool.select');

  // The pen's side button reports as the secondary button; it switches tools instead of opening a menu.
  await page.evaluate(() => {
    const host = document.querySelector('.viewport');
    if (!host) throw new Error('no viewport');
    const rect = host.getBoundingClientRect();
    const init = {
      pointerId: 7,
      pointerType: 'pen',
      isPrimary: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 2,
      buttons: 2,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    host.dispatchEvent(new PointerEvent('pointerdown', init));
    host.dispatchEvent(new MouseEvent('contextmenu', { ...init, bubbles: true, cancelable: true }));
    host.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
  });
  await expect(viewport).toHaveAttribute('data-active-tool', 'tool.orbit');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test.describe('real multi-touch', () => {
  test.use({ hasTouch: true });

  test('pinches and taps with two fingers without zooming the page', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-touch is driven through the Chromium DevTools protocol');
    await openApp(page);
    const viewport = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
    if (!viewport) throw new Error('viewport not laid out');
    const cx = viewport.x + viewport.width / 2;
    const cy = viewport.y + viewport.height / 2;
    const client = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: readonly Point[]) =>
      client.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((point, index) => ({ x: point.x, y: point.y, id: index + 1 })),
      });

    const camera = () => page.evaluate(() => JSON.stringify(window.__planar?.editor.session.camera));
    const before = await camera();
    await touch('touchStart', [
      { x: cx - 30, y: cy },
      { x: cx + 30, y: cy },
    ]);
    for (let step = 1; step <= 6; step++) {
      await touch('touchMove', [
        { x: cx - 30 - step * 12, y: cy },
        { x: cx + 30 + step * 12, y: cy },
      ]);
    }
    await touch('touchEnd', []);
    expect(await camera()).not.toBe(before);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

    await page.keyboard.press('r');
    await page.touchscreen.tap(cx - 40, cy + 20);
    await page.touchscreen.tap(cx + 40, cy - 20);
    await expect.poll(() => faces(page)).toBe(1);
    await page.waitForTimeout(400);
    await touch('touchStart', [
      { x: cx - 100, y: cy - 100 },
      { x: cx + 100, y: cy - 100 },
    ]);
    await touch('touchEnd', []);
    await expect.poll(() => faces(page)).toBe(0);
  });

  test('shows the corners on a touch screen', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'touch screens are emulated in Chromium');
    await openApp(page);
    await expect(page.getByTestId('corner-zone-bottomLeft')).toBeVisible();
    await expect(page.getByTestId('corner-zone-bottomRight')).toBeVisible();
    await expect(page.getByTestId('corner-zone-topLeft')).toHaveCount(0);
    const box = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
    if (!box) throw new Error('viewport not laid out');
    await page.touchscreen.tap(box.x + 20, box.y + box.height - 20);
    await expect(page.getByTestId('corner-flash')).toContainText('Orbit');
  });
});

test('hides the corners without a touch screen', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('corner-zone-bottomLeft')).toHaveCount(0);
});
