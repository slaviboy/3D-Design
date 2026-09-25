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

import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
}

async function labels(bar: Locator): Promise<(string | null)[]> {
  return bar
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
}

test('moves a tool to the top toolbar by pressing, holding and dragging it, and keeps it there', async ({
  page,
}) => {
  await openApp(page);
  const palette = page.getByRole('toolbar', { name: 'Tools' });
  const main = page.getByRole('toolbar', { name: 'Main toolbar' });
  const line = await palette.getByRole('button', { name: 'Line', exact: true }).boundingBox();
  const undo = await main.getByRole('button', { name: 'Undo' }).boundingBox();
  if (!line || !undo) throw new Error('toolbars not laid out');

  await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  // Just inside the left half of Undo: the tool goes before it.
  await page.mouse.move(undo.x + 4, undo.y + undo.height / 2, { steps: 8 });
  await page.mouse.up();

  const order = await labels(main);
  expect(order.indexOf('Line')).toBe(order.indexOf('Undo') - 1);
  await expect(palette.getByRole('button', { name: 'Line', exact: true })).toHaveCount(0);
  // Arranging doesn't run commands.
  await expect(page.getByRole('application', { name: '3D viewport' })).toHaveAttribute(
    'data-active-tool',
    'tool.select',
  );
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Line', exact: true })).toBeVisible();
  // The moved button still works.
  await main.getByRole('button', { name: 'Line', exact: true }).click();
  await expect(page.getByRole('application', { name: '3D viewport' })).toHaveAttribute(
    'data-active-tool',
    'tool.line',
  );
});

test('arranges the toolbars with the keyboard, and resets them from Preferences', async ({ page }) => {
  await openApp(page);
  const palette = page.getByRole('toolbar', { name: 'Tools' });
  const main = page.getByRole('toolbar', { name: 'Main toolbar' });
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Arrange Toolbars' }).click();

  const select = page.getByRole('button', { name: 'Select', exact: true });
  await expect(select).toBeFocused();
  await page.keyboard.press('ArrowDown');
  expect((await labels(palette)).slice(0, 2)).toEqual(['Eraser', 'Select']);
  await expect(select).toBeFocused();
  await page.keyboard.press('m');
  await expect(main.getByRole('button', { name: 'Select', exact: true })).toBeFocused();
  expect((await labels(main)).at(-1)).toBe('Select');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);

  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Preferences…' }).click();
  await page
    .getByRole('dialog', { name: 'Preferences' })
    .getByRole('button', { name: 'Reset Toolbars' })
    .click();
  expect((await labels(palette)).slice(0, 2)).toEqual(['Select', 'Eraser']);
  await expect(main.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0);
});

test('picks a button up with a tap and puts it down with the next one', async ({ page }) => {
  await openApp(page);
  const palette = page.getByRole('toolbar', { name: 'Tools' });
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Arrange Toolbars' }).click();
  await palette.getByRole('button', { name: 'Push/Pull' }).click();
  await palette.getByRole('button', { name: 'Select', exact: true }).click();
  expect((await labels(palette)).slice(0, 2)).toEqual(['Push/Pull', 'Select']);
});
