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

test('keeps keyboard focus inside Preferences, including its lists', async ({ page, browserName }) => {
  // WebKit moves focus between fields only with Tab; Alt+Tab reaches every control, like Tab elsewhere.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Preferences…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  await expect(dialog).toBeVisible();

  // Focus starts on the page's tab; backwards from it wraps to the last control, and forwards from there back.
  const general = dialog.getByRole('tab', { name: 'General' });
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await expect(general).toBeFocused();
  await page.keyboard.press(`Shift+${tab}`);
  await expect(close).toBeFocused();
  await page.keyboard.press(tab);
  await expect(general).toBeFocused();
  await page.keyboard.press(tab);
  await expect(dialog.getByLabel('Theme')).toBeFocused();
  await page.keyboard.press(tab);
  await expect(dialog.getByLabel('Interface size')).toBeFocused();

  // Arrow keys move between the pages.
  await general.focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('tab', { name: 'Navigation' })).toBeFocused();
  await expect(dialog.getByLabel('Invert mouse wheel zoom')).toBeVisible();
  await page.keyboard.press('End');
  await expect(dialog.getByRole('tab', { name: 'Touch & Pen' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByLabel('Two-finger tap')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.getByRole('tab', { name: 'Keyboard' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('button', { name: 'Reset All' })).toBeVisible();
});

test('finds a command on the Keyboard page by its keys', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Keyboard Shortcuts…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  await dialog.getByPlaceholder(/Filter by name or keys/).fill('shift+s');
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Search Commands…' }).first()).toBeVisible();
});

test('reassigns a gesture on the Touch & Pen page and keeps it after reloading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Touch Gestures…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  await expect(dialog.getByRole('tab', { name: 'Touch & Pen' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByLabel('Two-finger tap')).toHaveValue('command:edit.undo');
  await dialog.getByLabel('Four-finger tap').selectOption('toggleTool:tool.orbit');
  await dialog.getByLabel('Moving together').selectOption('pan');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  await page.reload();
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  const touch = await page.evaluate(() => window.__planar?.editor.preferences.touch);
  expect(touch).toMatchObject({ fourFingerTap: 'toggleTool:tool.orbit', twoFingerSlide: 'pan' });
});
