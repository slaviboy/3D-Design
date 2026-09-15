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

/** Groups and components in the model root, and the active tool, through the e2e-only test hook. */
async function state(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    return { instances: editor.session.doc.rootStore.instanceCount, tool: editor.tools.activeToolId };
  });
}

/** A viewport point (CSS pixels) over a group, closest to the middle of the view. */
async function pointOnGroup(page: Page) {
  const point = await page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const { width, height } = editor.viewportSize;
    let best: { x: number; y: number; score: number } | null = null;
    for (let y = 20; y < height - 20; y += 10) {
      for (let x = 20; x < width - 20; x += 10) {
        if (editor.pickAt({ x, y })?.ref.kind !== 'instance') continue;
        const score = Math.hypot(x - width / 2, y - height / 2);
        if (!best || score < best.score) best = { x, y, score };
      }
    }
    return best;
  });
  if (!point) throw new Error('no group in view');
  return point;
}

test('cuts, copies and pastes with the keyboard, the right-click menu and the Edit menu', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await page.evaluate(() => window.__planar?.editor.runCommand('file.openSample'));
  const viewport = page.getByRole('application', { name: '3D viewport' });
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('viewport not laid out');
  const group = await pointOnGroup(page);
  const at = (point: { x: number; y: number }) => ({ x: bounds.x + point.x, y: bounds.y + point.y });
  expect(await state(page)).toMatchObject({ instances: 1 });

  // Keyboard: select the sample house, copy it, and drop the copy where the next click lands.
  await page.mouse.click(at(group).x, at(group).y);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+C');
  await page.keyboard.press('ControlOrMeta+V');
  await expect.poll(async () => (await state(page)).tool).toBe('tool.paste');
  const drop = at({ x: Math.min(group.x + 160, bounds.width - 30), y: group.y });
  await page.mouse.move(drop.x, drop.y);
  await page.mouse.click(drop.x, drop.y);
  await expect.poll(async () => (await state(page)).instances).toBe(2);
  await expect.poll(async () => (await state(page)).tool).toBe('tool.select');

  // Right-click menu: Cut the group under the cursor.
  await page.mouse.click(at(group).x, at(group).y, { button: 'right' });
  // Menu items carry their shortcut in the accessible name ("Cut ⌘X"), so they are matched by prefix.
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /^Copy\b/ })).toBeVisible();
  await menu.getByRole('menuitem', { name: /^Cut\b/ }).click();
  await expect.poll(async () => (await state(page)).instances).toBe(1);

  // Edit menu: Paste In Place brings it back at its own coordinates.
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: /^Paste In Place\b/ }).click();
  await expect.poll(async () => (await state(page)).instances).toBe(2);
});
