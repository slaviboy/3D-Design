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

test('the workspace shows menus, tools, the 3D view and panels', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Untitled — Planar');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Main toolbar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('application', { name: '3D viewport' }).locator('canvas')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Entity Info' })).toBeVisible();
  await expect(page.getByTestId('selection-count')).toHaveText('Nothing selected');
});

test('the 3D view and status bar fit the window however many tools the palette has', async ({ page }) => {
  await page.goto('/');
  const windowHeight = await page.evaluate(() => window.innerHeight);
  const viewport = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  const statusBar = await page.getByRole('contentinfo').boundingBox();
  if (!viewport || !statusBar) throw new Error('workspace not laid out');
  expect(viewport.y + viewport.height).toBeLessThanOrEqual(statusBar.y + 1);
  expect(statusBar.y + statusBar.height).toBeLessThanOrEqual(windowHeight + 1);
  const palette = page.getByRole('toolbar', { name: 'Tools' });
  const lastTool = palette.getByRole('button').last();
  await lastTool.scrollIntoViewIfNeeded();
  await expect(lastTool).toBeInViewport();
});

test('the production build sets a restrictive Content-Security-Policy', async ({ page }) => {
  await page.goto('/');
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("style-src 'self'");
  expect(policy).toContain("object-src 'none'");
});

test.describe('on a large tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('the workspace still fits: menus, a usable 3D view, and no sideways scrolling', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
    const size = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
    const viewport = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
    const statusBar = await page.getByRole('contentinfo').boundingBox();
    if (!viewport || !statusBar) throw new Error('workspace not laid out');
    expect(viewport.width).toBeGreaterThanOrEqual(480);
    expect(viewport.height).toBeGreaterThanOrEqual(400);
    expect(statusBar.y + statusBar.height).toBeLessThanOrEqual(size.height + 1);
    await expect(page.getByRole('complementary', { name: 'Panels' })).toBeVisible();
  });
});
