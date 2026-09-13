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

import { expect, test } from './fixtures';

interface WebManifest {
  readonly name?: string;
  readonly short_name?: string;
  readonly start_url?: string;
  readonly scope?: string;
  readonly display?: string;
  readonly icons?: readonly { readonly src: string; readonly sizes?: string; readonly type?: string }[];
}

test('serves an installable web app manifest with a service worker', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const response = await request.get(href ?? '');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as WebManifest;
  expect(manifest).toMatchObject({ name: 'Planar', short_name: 'Planar', display: 'standalone' });
  expect(manifest.start_url).toBeTruthy();
  expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);
  for (const icon of manifest.icons ?? []) {
    const image = await request.get(new URL(icon.src, new URL(href ?? '/', page.url())).toString());
    expect(image.ok(), `icon ${icon.src}`).toBe(true);
  }

  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active !== null;
  });
  expect(registered).toBe(true);
});

test('Chromium reports no installability errors', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'installability is queried through the Chrome DevTools Protocol');
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const session = await page.context().newCDPSession(page);
  const { installabilityErrors } = await session.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});
