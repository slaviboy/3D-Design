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

import { readFile } from 'node:fs/promises';
import type { JSHandle, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** A DataTransfer carrying these files, as a real drag from the desktop would. */
async function dataTransferOf(page: Page, files: { name: string; base64: string }[]): Promise<JSHandle> {
  return page.evaluateHandle((entries) => {
    const transfer = new DataTransfer();
    for (const { name, base64 } of entries) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(new File([bytes], name));
    }
    return transfer;
  }, files);
}

async function modelState(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    let faces = 0;
    for (const definition of editor.session.doc.definitions()) {
      faces += [...definition.store.faces()].length;
    }
    return { name: editor.session.documentName, faces };
  });
}

test('dropping files on the window opens a project and imports a model', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

  // The sample model, saved as .planar bytes by the app itself, then a clean empty model to drop it onto.
  const project = await page.evaluate(async () => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    await editor.runCommand('file.openSample');
    const bytes = editor.encodeDocument();
    await editor.runCommand('file.new');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  expect(await modelState(page)).toMatchObject({ faces: 0 });

  // Dragging over the window offers the drop; leaving takes the offer away.
  const transfer = await dataTransferOf(page, [{ name: 'dropped-house.planar', base64: project }]);
  const overlay = page.getByTestId('file-drop');
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: transfer });
  await page.dispatchEvent('body', 'dragover', { dataTransfer: transfer });
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Drop to open');
  await page.dispatchEvent('body', 'dragleave', { dataTransfer: transfer });
  await expect(overlay).toBeHidden();

  // Dropping the project opens it.
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: transfer });
  await page.dispatchEvent('body', 'drop', { dataTransfer: transfer });
  await expect(overlay).toBeHidden();
  await expect.poll(async () => (await modelState(page)).faces).toBeGreaterThan(0);
  expect((await modelState(page)).name).toBe('dropped-house');

  // Dropping a model file offers the import options instead of replacing the model.
  const obj = await readFile('tests/fixtures/import/cube.obj');
  const objTransfer = await dataTransferOf(page, [{ name: 'cube.obj', base64: obj.toString('base64') }]);
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: objTransfer });
  await page.dispatchEvent('body', 'drop', { dataTransfer: objTransfer });
  await expect(page.getByRole('dialog', { name: 'Import Options' })).toBeVisible();
});
