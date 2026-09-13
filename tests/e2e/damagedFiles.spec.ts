import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { expect, test } from './fixtures';

interface ModelJson {
  nextId: number;
  definitions: { faces: { attributes: Record<string, unknown> }[] }[];
}

async function openApp(page: Page): Promise<void> {
  // Force the file-input fallback, which works in every browser and can be automated.
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target.showOpenFilePicker;
    delete target.showSaveFilePicker;
  });
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
}

/** The sample model as .planar bytes, produced by the app itself. */
async function sampleFileEntries(page: Page) {
  const bytes = await page.evaluate(async () => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    await editor.runCommand('file.openSample');
    return [...editor.encodeDocument()];
  });
  return unzipSync(new Uint8Array(bytes));
}

async function modelState(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const { doc } = editor.session;
    return {
      name: editor.session.documentName,
      dirty: editor.session.isDirty,
      faces: [...doc.definitions()].reduce(
        (sum, definition) => sum + [...definition.store.faces()].length,
        0,
      ),
    };
  });
}

async function openThroughFileChooser(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+O');
  await (await chooser).setFiles(path);
}

test('opens a damaged file repaired, with a notice and unsaved changes', async ({ page }, testInfo) => {
  await openApp(page);
  const entries = await sampleFileEntries(page);
  const facesBefore = (await modelState(page)).faces;
  const modelEntry = entries['model.json'];
  if (!modelEntry) throw new Error('the file has no model.json');
  const model = JSON.parse(strFromU8(modelEntry)) as ModelJson;
  const face = model.definitions.flatMap((definition) => definition.faces)[0];
  if (!face) throw new Error('the sample model has no faces');
  face.attributes.frontMaterialId = model.nextId + 10;
  entries['model.json'] = strToU8(JSON.stringify(model));
  const path = testInfo.outputPath('damaged.planar');
  await writeFile(path, zipSync(entries));

  // Start from an empty, saved state so the open doesn't ask to discard changes.
  await page.evaluate(() => window.__planar?.editor.runCommand('file.new'));
  await openThroughFileChooser(page, path);

  await expect(
    page.getByRole('status').filter({ hasText: 'Repaired 1 problem in damaged.planar' }),
  ).toBeVisible();
  await expect.poll(() => modelState(page)).toEqual({ name: 'damaged', dirty: true, faces: facesBefore });
});

test('refuses a file it cannot read and keeps the current model', async ({ page }, testInfo) => {
  await openApp(page);
  const entries = await sampleFileEntries(page);
  entries['model.json'] = strToU8('{ this is not json');
  const path = testInfo.outputPath('unreadable.planar');
  await writeFile(path, zipSync(entries));
  const before = await modelState(page);

  await openThroughFileChooser(page, path);

  await expect(page.getByRole('alert').filter({ hasText: 'Could not open unreadable.planar' })).toBeVisible();
  expect(await modelState(page)).toEqual(before);
});
