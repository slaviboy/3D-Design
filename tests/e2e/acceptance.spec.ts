import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/*
 * The product's final acceptance journey, in one run: every step a user must be able to do, with the network
 * disabled after the first visit. Numbers in comments refer to the acceptance list.
 */

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const fixture = (name: string): string => resolve('tests/fixtures/import', name);

async function useFileFallbacks(page: Page): Promise<void> {
  // The file input and download fallbacks work in every browser and can be automated.
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target.showOpenFilePicker;
    delete target.showSaveFilePicker;
  });
}

/** Model state read through the e2e-only test hook. Extents cover the root context. */
async function model(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const { doc } = editor.session;
    let faces = 0;
    for (const definition of doc.definitions()) faces += definition.store.faceCount;
    const points = [...doc.rootStore.vertices()].map((vertex) => vertex.position);
    const round = (value: number) => Math.round(value * 1e6) / 1e6;
    const bound = (axis: 'x' | 'y' | 'z', pick: (...values: number[]) => number) =>
      points.length === 0 ? 0 : round(pick(...points.map((p) => p[axis])));
    const instances = [...doc.rootStore.instances()];
    return {
      faces,
      rootFaces: doc.rootStore.faceCount,
      instances: instances.length,
      instanceNames: instances.map((instance) => instance.attributes.name),
      instanceTags: instances.map((instance) => instance.attributes.tagId),
      instanceMaterials: instances.map((instance) => instance.attributes.materialId),
      components: [...doc.definitions()].filter(
        (definition) => definition.id !== doc.rootDefinitionId && !definition.attributes.isGroup,
      ).length,
      materials: [...doc.materials()].map((material) => material.id),
      tags: [...doc.tags()].map((tag) => tag.name),
      scenes: doc.scenes.map((scene) => scene.name),
      sections: doc.rootStore.sectionPlaneCount,
      min: { x: bound('x', Math.min), y: bound('y', Math.min), z: bound('z', Math.min) },
      max: { x: bound('x', Math.max), y: bound('y', Math.max), z: bound('z', Math.max) },
      name: editor.session.documentName,
      dirty: editor.session.isDirty,
    };
  });
}

async function size(page: Page) {
  const { min, max } = await model(page);
  return { x: Math.round((max.x - min.x) * 1e6) / 1e6, y: Math.round((max.y - min.y) * 1e6) / 1e6 };
}

async function onScreen(page: Page, point: Point) {
  const viewport = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  const screen = await page.evaluate((target) => window.__planar?.screenOf(target) ?? null, point);
  if (!viewport || !screen) throw new Error('point is not visible');
  return { x: viewport.x + screen.x, y: viewport.y + screen.y };
}

async function clickAt(page: Page, point: Point): Promise<void> {
  const target = await onScreen(page, point);
  await page.mouse.move(target.x, target.y, { steps: 3 });
  await page.mouse.click(target.x, target.y);
}

async function openMenuItem(
  page: Page,
  menu: string,
  item: string,
  role: 'menuitem' | 'menuitemradio' = 'menuitem',
) {
  await page.getByRole('menuitem', { name: menu, exact: true }).click();
  // Menu item names also include their shortcut, so match the label at the start of the name.
  const label = new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
  await page.getByRole(role, { name: label }).click();
}

test('the whole modeling journey works offline, from a new model to import and export', async ({
  page,
  context,
  browserName,
}, testInfo) => {
  test.setTimeout(180_000);
  await useFileFallbacks(page);

  // 1. Open the application, then go offline once the service worker controls the page.
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  // Playwright's offline emulation breaks service-worker navigations in WebKit, so WebKit runs the journey online;
  // the fixtures still fail the test on any request to another origin.
  const offline = browserName !== 'webkit';
  if (offline) {
    await context.setOffline(true);
    await page.reload();
  }
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  if (offline) expect(await page.evaluate(() => navigator.onLine)).toBe(false);

  // 2. Start a new model.
  await openMenuItem(page, 'File', 'New');
  await expect.poll(async () => (await model(page)).faces).toBe(0);

  // 3–5. Draw a rectangle, snapping its first corner to the origin, and give it exact dimensions.
  const viewportBox = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  if (!viewportBox) throw new Error('viewport not laid out');
  const origin = await onScreen(page, { x: 0, y: 0, z: 0 });
  await page.keyboard.press('r');
  await page.mouse.move(origin.x + 2, origin.y - 2, { steps: 3 });
  await expect(page.getByTestId('inference-label')).toHaveText('Origin');
  await page.mouse.click(origin.x + 2, origin.y - 2);
  await page.mouse.move(origin.x + 100, origin.y - 50, { steps: 4 });
  await page.mouse.click(origin.x + 100, origin.y - 50);
  await expect.poll(async () => (await model(page)).faces).toBe(1);
  await page.keyboard.type('2m,1m');
  await page.keyboard.press('Enter');
  await expect.poll(() => size(page)).toEqual({ x: 2, y: 1 });
  expect((await model(page)).min).toEqual({ x: 0, y: 0, z: 0 });

  // 7. Rotate by a typed angle and scale by a typed factor.
  await page.evaluate(() => window.__planar?.editor.runCommand('camera.view.top'));
  await page.keyboard.press('Shift+Z');
  let { min, max } = await model(page);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('q');
  await clickAt(page, { x: min.x, y: min.y, z: 0 });
  await clickAt(page, { x: max.x, y: min.y, z: 0 });
  await page.keyboard.type('90');
  await page.keyboard.press('Enter');
  await expect.poll(() => size(page)).toEqual({ x: 1, y: 2 });
  await page.keyboard.press('Shift+Z');
  await page.keyboard.press('s');
  ({ max } = await model(page));
  await clickAt(page, { x: max.x, y: max.y, z: 0 });
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await expect.poll(() => size(page)).toEqual({ x: 2, y: 4 });

  // 6. Push/Pull the face up by a typed distance.
  await page.keyboard.press('Space');
  await page.keyboard.press('Shift+Z');
  ({ min, max } = await model(page));
  await page.keyboard.press('p');
  await clickAt(page, { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: 0 });
  await page.keyboard.type('1m');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await model(page)).faces).toBe(6);
  await expect.poll(async () => (await model(page)).max.z).toBe(1);

  // 7. Move the box by a typed distance.
  const beforeMove = await model(page);
  await page.keyboard.press('Space');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('m');
  const start = { x: beforeMove.min.x, y: beforeMove.min.y, z: 0 };
  await clickAt(page, start);
  const startScreen = await onScreen(page, start);
  await page.mouse.move(startScreen.x + 80, startScreen.y, { steps: 5 });
  await page.mouse.click(startScreen.x + 80, startScreen.y);
  await page.keyboard.type('3m');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await model(page)).min.x).toBeCloseTo(beforeMove.min.x + 3, 5);
  expect((await model(page)).faces).toBe(6);

  // 14. Measure the box's width with the Tape Measure.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Z');
  const box = await model(page);
  await openMenuItem(page, 'Tools', 'Tape Measure', 'menuitemradio');
  await clickAt(page, { x: box.min.x, y: box.min.y, z: 0 });
  const end = await onScreen(page, { x: box.max.x, y: box.min.y, z: 0 });
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await expect(page.getByTestId('measurements')).toHaveValue('2000mm');
  await page.keyboard.press('Escape');

  // 13. Place a section plane on the top of the box.
  await openMenuItem(page, 'Tools', 'Section Plane', 'menuitemradio');
  await clickAt(page, {
    x: (box.min.x + box.max.x) / 2 + 0.3,
    y: (box.min.y + box.max.y) / 2 + 0.2,
    z: box.max.z,
  });
  await expect.poll(async () => (await model(page)).sections).toBe(1);
  await page.keyboard.press('Space');

  // 12. Create a scene.
  await openMenuItem(page, 'Window', 'Scenes', 'menuitemradio');
  await page
    .getByRole('region', { name: 'Scenes' })
    .getByRole('button', { name: 'Add', exact: true })
    .click();
  await expect(page.getByRole('tab', { name: 'Scene 1' })).toBeVisible();

  // 8. Group the geometry, and 15. undo and redo it.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+G');
  await expect.poll(async () => (await model(page)).instances).toBe(1);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => model(page)).toMatchObject({ instances: 0, rootFaces: 6 });
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect.poll(() => model(page)).toMatchObject({ instances: 1, rootFaces: 0, faces: 6 });

  // 9. Turn the group into a component.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('g');
  await expect.poll(async () => (await model(page)).components).toBe(1);

  // 10. Create a material and paint the component with it.
  const materials = page.locator('[data-panel="materials"]');
  await materials.getByRole('button', { name: 'New Material' }).click();
  const hex = materials.getByRole('textbox', { name: 'Material color hex' });
  await hex.fill('#3366cc');
  await hex.press('Enter');
  await expect.poll(async () => (await model(page)).materials.length).toBe(1);
  await page.getByRole('button', { name: 'Paint Bucket' }).click();
  await clickAt(page, { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: box.max.z });
  await expect
    .poll(async () => {
      const state = await model(page);
      return state.instanceMaterials[0] === state.materials[0];
    })
    .toBe(true);

  // 11. Organize: tag the component and rename it in the Outliner.
  await page.keyboard.press('Space');
  await page.keyboard.press('ControlOrMeta+A');
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');
  const tags = page.getByRole('region', { name: 'Tags' });
  await tags.getByRole('button', { name: 'Add Tag' }).click();
  await expect(tags.getByRole('textbox', { name: 'Name of Tag 1' })).toHaveValue('Tag 1');
  await page
    .getByRole('region', { name: 'Entity Info' })
    .getByRole('combobox', { name: 'Tag' })
    .selectOption({ label: 'Tag 1' });
  await expect.poll(async () => (await model(page)).instanceTags[0]).not.toBeNull();
  const outliner = page.getByRole('region', { name: 'Outliner' });
  await outliner.getByRole('treeitem').first().focus();
  await page.keyboard.press('F2');
  await expect(outliner.getByRole('textbox', { name: 'New name' })).toBeFocused();
  await page.keyboard.type('Planar Box');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await model(page)).instanceNames).toEqual(['Planar Box']);

  // 16. Save the project locally.
  const saved = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+S');
  const download = await saved;
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  await expect.poll(async () => (await model(page)).dirty).toBe(false);
  const before = await model(page);

  // 17. Close the browser window (still offline), and open Planar again.
  await page.close();
  const reopened = await context.newPage();
  const errors: string[] = [];
  reopened.on('pageerror', (error) => errors.push(error.message));
  reopened.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await useFileFallbacks(reopened);
  await reopened.goto('/');
  await expect(reopened.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

  // 18. Reopen the project from the saved file.
  const chooser = reopened.waitForEvent('filechooser');
  await reopened.keyboard.press('ControlOrMeta+O');
  await (await chooser).setFiles(path);
  await expect
    .poll(() => model(reopened))
    .toMatchObject({
      faces: before.faces,
      instances: 1,
      instanceNames: ['Planar Box'],
      components: 1,
      materials: before.materials,
      tags: ['Tag 1'],
      scenes: ['Scene 1'],
      sections: 1,
      dirty: false,
    });

  // 19. Continue editing: draw another rectangle beside the box.
  await reopened.evaluate(() => window.__planar?.editor.runCommand('camera.view.top'));
  await reopened.keyboard.press('Shift+Z');
  const corner = { x: box.max.x + 3, y: box.min.y, z: 0 };
  await reopened.keyboard.press('r');
  await clickAt(reopened, corner);
  const cornerScreen = await onScreen(reopened, corner);
  await reopened.mouse.move(cornerScreen.x + 40, cornerScreen.y - 30, { steps: 3 });
  await reopened.mouse.click(cornerScreen.x + 40, cornerScreen.y - 30);
  await reopened.keyboard.type('1m,1m');
  await reopened.keyboard.press('Enter');
  await expect.poll(() => model(reopened)).toMatchObject({ rootFaces: 1, dirty: true });

  // 20. Import a supported 3D file.
  await reopened.keyboard.press('Escape');
  const importChooser = reopened.waitForEvent('filechooser');
  await openMenuItem(reopened, 'File', 'Import…');
  await (await importChooser).setFiles([fixture('cube.obj'), fixture('cube.mtl')]);
  const options = reopened.getByRole('dialog', { name: 'Import Options' });
  await options.getByRole('button', { name: 'Import' }).click();
  await expect(options).toBeHidden();
  await expect.poll(async () => (await model(reopened)).instances).toBe(2);

  // 21. Export a supported format.
  await openMenuItem(reopened, 'File', 'Export 3D Model…');
  const exportDialog = reopened.getByRole('dialog', { name: 'Export 3D Model' });
  await exportDialog.getByLabel('Format').selectOption('stl');
  await exportDialog.getByLabel('File name').fill('journey');
  const exported = reopened.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Export' }).click();
  const stl = await exported;
  expect(stl.suggestedFilename()).toBe('journey.stl');
  const stlPath = testInfo.outputPath('journey.stl');
  await stl.saveAs(stlPath);
  expect(statSync(stlPath).size).toBeGreaterThan(84);

  // 22. Everything above ran with the network disabled (except in WebKit, see above).
  if (offline) expect(await reopened.evaluate(() => navigator.onLine)).toBe(false);
  expect(errors, 'page errors and console errors after reopening').toEqual([]);
  await context.setOffline(false);
});
