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

test('hovering a tool shows its name, and Preferences can turn that off', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  const tools = page.getByRole('toolbar', { name: 'Tools' });
  const line = tools.getByRole('button', { name: 'Line' });
  const rectangle = tools.getByRole('button', { name: 'Rectangle' });
  const tooltip = page.getByTestId('tooltip');

  // Tool tips are on to begin with: resting on a button names it, moving to the next renames it.
  await expect(tooltip).toBeHidden();
  await line.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(/^Line/);
  await rectangle.hover();
  await expect(tooltip).toHaveText(/^Rectangle/);

  // Moving off the buttons takes the tooltip away.
  await page.getByRole('application', { name: '3D viewport' }).hover();
  await expect(tooltip).toBeHidden();

  // While tool tips are on, the browser's own tooltip stays out of the way.
  await expect(line).not.toHaveAttribute('title', /.+/);

  // Turning them off in Preferences leaves the browser's tooltip instead.
  await page.evaluate(() => window.__planar?.editor.runCommand('app.preferences'));
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await expect(preferences).toBeVisible();
  const toggle = preferences.getByRole('checkbox', { name: /tool tips/i });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await preferences.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(preferences).toBeHidden();

  await line.hover();
  await expect(line).toHaveAttribute('title', /^Line/);
  await expect(tooltip).toBeHidden();
});
