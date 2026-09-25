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

/** Distance from the camera to its target, and the camera's direction around the vertical axis. */
async function view(page: Page) {
  return page.evaluate(() => {
    const camera = window.__planar?.editor.session.camera;
    if (!camera) throw new Error('test hook missing: build with --mode e2e');
    const dx = camera.eye.x - camera.target.x;
    const dy = camera.eye.y - camera.target.y;
    const dz = camera.eye.z - camera.target.z;
    return { distance: Math.hypot(dx, dy, dz), azimuth: Math.atan2(dy, dx) };
  });
}

/** Sends a wheel event to the middle of the view, as a trackpad does for swipes and (with Ctrl) pinches. */
async function wheel(page: Page, init: { deltaX?: number; deltaY?: number; ctrlKey?: boolean }) {
  await page.evaluate((options) => {
    const host = document.querySelector('.viewport');
    if (!host) throw new Error('no viewport');
    const rect = host.getBoundingClientRect();
    host.dispatchEvent(
      new WheelEvent('wheel', {
        ...options,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, init);
}

test('with a trackpad, a pinch zooms and a two-finger swipe orbits', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Preferences…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  await dialog.getByRole('tab', { name: 'Navigation' }).click();
  await dialog.getByLabel('Pointing device').selectOption('trackpad');
  await expect(dialog.getByLabel('Two-finger swipe')).toHaveValue('orbit');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  const start = await view(page);
  await wheel(page, { deltaY: -20, ctrlKey: true });
  await expect.poll(async () => (await view(page)).distance).toBeLessThan(start.distance);

  const zoomed = await view(page);
  await wheel(page, { deltaX: 40, deltaY: 0 });
  await expect.poll(async () => (await view(page)).azimuth).not.toBeCloseTo(zoomed.azimuth, 3);
  expect((await view(page)).distance).toBeCloseTo(zoomed.distance, 6);

  // The choice is kept on this device.
  await page.reload();
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  expect(await page.evaluate(() => window.__planar?.editor.preferences.navigation.device)).toBe('trackpad');
});

test('with a mouse, the wheel zooms at the pointer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  const start = await view(page);
  await wheel(page, { deltaY: -100 });
  await expect.poll(async () => (await view(page)).distance).toBeLessThan(start.distance);
  expect((await view(page)).azimuth).toBeCloseTo(start.azimuth, 6);
});
