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

test('types 3D text in the dialog, places it with a click and undoes it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

  await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: '3D Text…' }).click();
  const dialog = page.getByRole('dialog', { name: '3D Text' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Text', { exact: true }).fill('Planar 3D');
  await dialog.getByLabel('Height', { exact: true }).fill('2000mm');
  await dialog.getByRole('button', { name: 'Place' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Click a face or the ground to place the text.')).toBeVisible();

  await page.keyboard.press('Shift+Z');
  const viewport = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  const screen = await page.evaluate(() => window.__planar?.screenOf({ x: 0, y: 0, z: 0 }) ?? null);
  if (!viewport || !screen) throw new Error('origin is not visible');
  const x = viewport.x + screen.x;
  const y = viewport.y + screen.y;
  await page.mouse.move(x - 20, y + 20);
  await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.click(x, y);

  const placed = () =>
    page.evaluate(() => {
      const doc = window.__planar?.editor.session.doc;
      if (!doc) return null;
      return [...doc.rootStore.instances()].map((instance) => {
        const definition = doc.getDefinition(instance.definitionId);
        return {
          name: instance.attributes.name,
          isGroup: definition.attributes.isGroup,
          hasFaces: definition.store.faceCount > 0,
        };
      });
    });
  await expect.poll(placed).toEqual([{ name: 'Planar 3D', isGroup: true, hasFaces: true }]);
  const height = await page.evaluate(() => {
    const doc = window.__planar?.editor.session.doc;
    const [instance] = doc ? [...doc.rootStore.instances()] : [];
    if (!doc || !instance) return null;
    const ys = [...doc.getDefinition(instance.definitionId).store.vertices()].map((v) => v.position.y);
    return Math.max(...ys);
  });
  expect(height).toBeCloseTo(2);

  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(placed).toEqual([]);
});
