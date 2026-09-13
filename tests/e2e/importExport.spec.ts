import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
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

/** A real, decodable RGBA PNG (a 2 × 2 checker), so the renderer can decode it without errors. */
function checkerPng(): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.from([
    0, 200, 60, 40, 255, 240, 240, 240, 255, 0, 240, 240, 240, 255, 200, 60, 40, 255,
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('imports an OBJ with a textured MTL material and its PNG', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

  const obj = [
    'mtllib panel.mtl',
    'v 0 0 0',
    'v 2 0 0',
    'v 2 1 0',
    'v 0 1 0',
    'vt 0 0',
    'vt 2 0',
    'vt 2 1',
    'vt 0 1',
    'usemtl checker',
    'f 1/1 2/2 3/3 4/4',
    '',
  ].join('\n');
  const mtl = 'newmtl checker\nKd 1 1 1\nmap_Kd checker.png\n';

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import…' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles([
    { name: 'panel.obj', mimeType: 'text/plain', buffer: Buffer.from(obj) },
    { name: 'panel.mtl', mimeType: 'text/plain', buffer: Buffer.from(mtl) },
    { name: 'checker.png', mimeType: 'image/png', buffer: checkerPng() },
  ]);
  const options = page.getByRole('dialog', { name: 'Import Options' });
  await expect(options).toContainText('Import panel.obj');
  await options.getByRole('button', { name: 'Import' }).click();
  await expect(options).toBeHidden();

  const textureState = () =>
    page.evaluate(() => {
      const editor = window.__planar?.editor;
      if (!editor) throw new Error('test hook missing: build with --mode e2e');
      const { doc } = editor.session;
      return {
        assets: [...doc.assets()].map((asset) => ({
          name: asset.name,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
        })),
        materials: [...doc.materials()].map((material) => ({
          name: material.name,
          textured: material.texture !== null && doc.asset(material.texture.assetId) !== undefined,
          width: material.texture?.width ?? null,
        })),
      };
    });
  await expect.poll(textureState).toEqual({
    assets: [{ name: 'checker.png', mimeType: 'image/png', width: 2, height: 2 }],
    materials: [{ name: 'checker', textured: true, width: 1 }],
  });
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
