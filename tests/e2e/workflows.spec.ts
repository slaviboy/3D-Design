import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Model statistics read through the e2e-only test hook. */
async function modelState(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const { session } = editor;
    return {
      instances: session.doc.rootStore.instanceCount,
      definitions: [...session.doc.definitions()].length,
      name: session.documentName,
      dirty: session.isDirty,
    };
  });
}

async function openSample(page: Page): Promise<void> {
  await page.evaluate(() => window.__planar?.editor.runCommand('file.openSample'));
  await expect.poll(async () => (await modelState(page)).instances).toBe(1);
}

test('opens the sample model from the File menu using only the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'File', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menu', { name: 'File' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Open Sample Model' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'File' })).toBeHidden();
  await expect.poll(async () => (await modelState(page)).name).toBe('Sample House');
  await expect(page.getByTestId('entity-info-heading')).toHaveText('Model');
});

test('selects, deletes, undoes and redoes with keyboard shortcuts', async ({ page }) => {
  await page.goto('/');
  await openSample(page);
  await page.keyboard.press('ControlOrMeta+A');
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');
  await expect(page.getByTestId('entity-info-heading')).toHaveText('Group');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('selection-count')).toHaveText('Nothing selected');
  expect(await modelState(page)).toMatchObject({ instances: 0, definitions: 1, dirty: true });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await modelState(page)).instances).toBe(1);
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect.poll(async () => (await modelState(page)).instances).toBe(0);
});

test('clicking and box-selecting in the viewport select the model', async ({ page }) => {
  await page.goto('/');
  await openSample(page);
  const viewport = page.getByRole('application', { name: '3D viewport' });
  const box = await viewport.boundingBox();
  if (!box) throw new Error('viewport not laid out');
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  await page.mouse.click(centerX, centerY);
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('selection-count')).toHaveText('Nothing selected');

  // Window: left to right around everything.
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');
  await page.keyboard.press('Escape');

  // Crossing: right to left through the middle only.
  await page.mouse.move(centerX + 20, centerY - 20);
  await page.mouse.down();
  await page.mouse.move(centerX - 20, centerY + 20, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');
});

test('saves a model to a file and opens it again', async ({ page }, testInfo) => {
  // Force the download and file-input fallback, which works in every browser and can be automated.
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target.showOpenFilePicker;
    delete target.showSaveFilePicker;
  });
  await page.goto('/');
  await openSample(page);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');

  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+S');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Sample House.planar');
  const path = testInfo.outputPath('Sample House.planar');
  await download.saveAs(path);
  await expect.poll(async () => (await modelState(page)).dirty).toBe(false);

  await page.evaluate(() => window.__planar?.editor.runCommand('file.openSample'));
  await expect.poll(async () => (await modelState(page)).instances).toBe(1);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+O');
  const chooser = await chooserPromise;
  await chooser.setFiles(path);
  await expect
    .poll(async () => modelState(page))
    .toMatchObject({ instances: 0, name: 'Sample House', dirty: false });
});

test('keeps working offline after the first visit', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Make sure the page is controlled by the service worker before going offline.
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await openSample(page);
  await page.keyboard.press('ControlOrMeta+A');
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');
  await context.setOffline(false);
});

test('offers to recover unsaved work after a session ends unexpectedly', async ({ page, context }) => {
  await page.clock.install();
  await page.goto('/');
  await openSample(page);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  expect((await modelState(page)).dirty).toBe(true);

  // Autosave runs every five minutes.
  await page.clock.runFor(5 * 60 * 1000 + 1000);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const request = indexedDB.open('planar');
            request.onsuccess = () => {
              const all = request.result.transaction('recovery', 'readonly').objectStore('recovery').count();
              all.onsuccess = () => {
                resolve(all.result);
              };
              all.onerror = () => {
                reject(new Error('count failed'));
              };
            };
            request.onerror = () => {
              reject(new Error('open failed'));
            };
          }),
      ),
    )
    .toBe(1);

  const second = await context.newPage();
  await second.goto('/');
  const dialog = second.getByRole('dialog', { name: 'Recover unsaved work' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Sample House');
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => modelState(second))
    .toMatchObject({
      instances: 0,
      name: 'Sample House (recovered)',
      dirty: true,
    });
});
