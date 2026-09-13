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

test('changes the theme and units in Preferences and keeps them after reloading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Preferences…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await dialog.getByLabel('Interface size').selectOption('1.25');
  await dialog.getByLabel('Length').selectOption('architectural');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();

  const viewport = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  if (!viewport) throw new Error('viewport not laid out');
  await page.keyboard.press('r');
  await page.mouse.click(viewport.x + viewport.width / 2 - 40, viewport.y + viewport.height / 2 + 20);
  await page.mouse.move(viewport.x + viewport.width / 2 + 60, viewport.y + viewport.height / 2 - 30, {
    steps: 3,
  });
  await expect(page.getByTestId('measurements')).toHaveValue(/"/);
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()),
    )
    .toBe('1.25');
});
