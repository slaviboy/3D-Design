import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const fixture = (name: string): string => resolve('tests/fixtures/import', name);

/** Imported content, read through the e2e-only test hook. */
async function importState(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const { doc, selection } = editor.session;
    const [instance] = doc.rootStore.instances();
    const facesUnder = (definitionId: typeof doc.rootDefinitionId): number => {
      const store = doc.store(definitionId);
      let count = store.faceCount;
      for (const child of store.instances()) count += facesUnder(child.definitionId);
      return count;
    };
    const definition = instance ? doc.getDefinition(instance.definitionId) : null;
    return {
      instances: doc.rootStore.instanceCount,
      selected: selection.ids('instance'),
      instanceId: instance?.id ?? null,
      group: definition ? { name: definition.attributes.name, isGroup: definition.attributes.isGroup } : null,
      faces: instance ? facesUnder(instance.definitionId) : 0,
      materials: [...doc.materials()].map((material) => material.name).sort(),
    };
  });
}

/** Opens a top-level menu. Matches the trigger by class, so it works whatever ARIA role the trigger has. */
async function openMenu(page: Page, label: string): Promise<void> {
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await page.locator('.menubar__trigger', { hasText: new RegExp(`^${label}$`) }).click();
}

test.beforeEach(async ({ page }) => {
  // Use the file input and download fallbacks, which every browser has and Playwright can drive.
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target.showOpenFilePicker;
    delete target.showSaveFilePicker;
  });
});

test('imports an OBJ with its MTL, then exports the model as STL', async ({ page }, testInfo) => {
  await page.goto('/');

  const chooserPromise = page.waitForEvent('filechooser');
  await openMenu(page, 'File');
  await page.getByRole('menuitem', { name: 'Import…' }).click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles([fixture('cube.obj'), fixture('cube.mtl')]);

  const options = page.getByRole('dialog', { name: 'Import Options' });
  await expect(options).toContainText('Import cube.obj');
  await expect(options.getByLabel('Merge coplanar faces')).toBeChecked();
  await options.getByRole('button', { name: 'Import' }).click();
  await expect(options).toBeHidden();

  await expect
    .poll(async () => importState(page))
    .toMatchObject({
      instances: 1,
      group: { name: 'cube', isGroup: true },
      faces: 6,
      materials: ['gray', 'red'],
    });
  const state = await importState(page);
  expect(state.selected).toEqual([state.instanceId]);
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');

  await openMenu(page, 'File');
  await page.getByRole('menuitem', { name: 'Export 3D Model…' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export 3D Model' });
  await exportDialog.getByLabel('Format').selectOption('stl');
  await expect(exportDialog.getByLabel('File units')).toHaveValue('mm');
  await exportDialog.getByLabel('File name').fill('cube');
  const downloadPromise = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('cube.stl');
  const path = testInfo.outputPath('cube.stl');
  await download.saveAs(path);
  expect(statSync(path).size).toBe(84 + 12 * 50);
});

test('exports the current view as a PNG', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.evaluate(() => window.__planar?.editor.runCommand('file.openSample'));
  await openMenu(page, 'File');
  await page.getByRole('menuitem', { name: 'Export 2D Graphic…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export 2D Graphic' });
  await dialog.getByLabel('Width (pixels)').fill('320');
  await dialog.getByLabel('Height (pixels)').fill('200');
  await dialog.getByLabel('Transparent background').check();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Sample House.png');
  const path = testInfo.outputPath('view.png');
  await download.saveAs(path);
  expect(statSync(path).size).toBeGreaterThan(100);
});
