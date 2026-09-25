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

async function menuLabels(page: Page): Promise<string[]> {
  return page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem').allTextContents();
}

// In a new model most commands are disabled, so a menu may start with disabled items followed by a separator.
// Opening it once blanked the whole window (Edit: Undo and Redo are disabled, then comes a separator).
test('every menu opens in a new model and focuses its first enabled item', async ({ page }) => {
  await openApp(page);
  const labels = await menuLabels(page);
  expect(labels).toContain('Edit');

  for (const label of labels) {
    const trigger = page.getByRole('menuitem', { name: label, exact: true });
    const menu = page.getByRole('menu', { name: label });

    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(menu.locator('.menu__item:enabled').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.menu__item:enabled').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  }

  // The workspace is still there after all of it.
  await expect(page.getByRole('application', { name: '3D viewport' })).toBeVisible();
});

test('the Edit menu of a new model shows Undo and Redo disabled', async ({ page }) => {
  await openApp(page);
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('menu', { name: 'Edit' });
  await expect(edit.getByRole('menuitem', { name: 'Undo' })).toBeDisabled();
  await expect(edit.getByRole('menuitem', { name: 'Redo' })).toBeDisabled();
  await expect(edit.getByRole('menuitem', { name: 'Select All' })).toBeFocused();
});
