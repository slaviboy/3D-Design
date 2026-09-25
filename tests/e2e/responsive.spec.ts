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

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
}

async function pageScrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the view wide, with the panels in a drawer', async ({ page }) => {
    await openApp(page);
    expect(await pageScrollsSideways(page)).toBe(false);
    const view = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
    expect(view?.width).toBeGreaterThan(300);

    const panels = page.getByRole('complementary', { name: 'Panels' });
    const toggle = page.getByRole('button', { name: 'Panels', exact: true });
    await expect(panels).toBeHidden();
    await toggle.click();
    await expect(panels).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(panels).toBeHidden();

    // Showing a panel from the Window menu opens the drawer on it.
    await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Shadows' }).click();
    await expect(panels).toBeVisible();
    // A tap beside the drawer closes it.
    await page.mouse.click(20, 400);
    await expect(panels).toBeHidden();
  });

  test('opens every menu within the window', async ({ page }) => {
    await openApp(page);
    for (const label of ['File', 'Edit', 'View', 'Window', 'Help']) {
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      const menu = page.getByRole('menu', { name: label });
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      const size = page.viewportSize();
      if (!box || !size) throw new Error('menu not laid out');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      await page.keyboard.press('Escape');
    }
    expect(await pageScrollsSideways(page)).toBe(false);
  });
});

test.describe('on a tablet held upright', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('keeps the panels beside the view', async ({ page }) => {
    await openApp(page);
    expect(await pageScrollsSideways(page)).toBe(false);
    await expect(page.getByRole('complementary', { name: 'Panels' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Panels', exact: true })).toBeHidden();
    const view = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
    expect(view?.width).toBeGreaterThan(400);
  });
});

test.describe('with fingers', () => {
  // Firefox can't emulate a mobile device, and WebKit doesn't report a coarse pointer for an emulated touch screen.
  test.skip(({ browserName }) => browserName !== 'chromium', 'touch screens are emulated in Chromium');
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 820, height: 1180 } });

  test('makes targets bigger and typed values large enough not to zoom the page', async ({ page }) => {
    await openApp(page);
    const select = await page.getByRole('button', { name: 'Select', exact: true }).boundingBox();
    expect(select?.width).toBeGreaterThanOrEqual(40);
    await page.getByRole('button', { name: 'Rectangle', exact: true }).tap();
    const field = page.getByTestId('measurements');
    await expect(field).toBeVisible();
    expect(
      await field.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    await expect(field).toHaveAttribute('enterkeyhint', 'done');
  });
});

test.describe('when the graphics context is lost', () => {
  // Views jump rather than glide, so the same view draws the same picture every time.
  test.use({ reducedMotion: 'reduce' });

  test('draws the view again once it is restored', async ({ page }) => {
    await openApp(page);
    // A checksum of the drawn view: preserveDrawingBuffer keeps the last frame readable.
    const picture = () =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas');
        if (!canvas) throw new Error('no canvas');
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const context = copy.getContext('2d');
        if (!context) throw new Error('no 2D context');
        context.drawImage(canvas, 0, 0);
        const data = context.getImageData(0, 0, copy.width, copy.height).data;
        let checksum = 0;
        for (let i = 0; i < data.length; i += 4 * 3) {
          checksum =
            (checksum * 31 + (data[i] ?? 0) * 7 + (data[i + 1] ?? 0) * 3 + (data[i + 2] ?? 0)) %
            1_000_000_007;
        }
        return checksum;
      });
    // Clicks a standard view and waits until two readings agree on a picture other than `previous`.
    const show = async (view: string, previous: number | null): Promise<number> => {
      await page.getByRole('button', { name: view, exact: true }).click();
      let last = Number.NaN;
      await expect
        .poll(async () => {
          const now = await picture();
          const settled = now === last && now !== previous;
          last = now;
          return settled;
        })
        .toBe(true);
      return last;
    };
    const top = await show('Top View', null);
    await show('Iso View', top);

    const lost = await page.evaluate(async () => {
      const gl = document.querySelector<HTMLCanvasElement>('.viewport canvas')?.getContext('webgl2');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!gl || !extension) return null;
      // Kept for restoring: a lost context hands out no extensions.
      (window as Window & { loseContext?: WEBGL_lose_context }).loseContext = extension;
      extension.loseContext();
      await new Promise((resolve) => setTimeout(resolve, 200));
      return gl.isContextLost();
    });
    test.skip(lost === null, 'this browser cannot simulate a lost context');
    expect(lost).toBe(true);

    // The view changes while nothing can be drawn; the restored context has to draw it, not show the old picture.
    await page.getByRole('button', { name: 'Top View', exact: true }).click();
    await page.evaluate(() => {
      (window as Window & { loseContext?: WEBGL_lose_context }).loseContext?.restoreContext();
    });
    await expect.poll(picture, { timeout: 5000 }).toBe(top);
  });
});
