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

/** Style, fog and environment settings read through the e2e-only test hook. */
async function presentation(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const { doc } = editor.session;
    return {
      faceStyle: doc.style.faceStyle,
      xRay: doc.style.xRay,
      profiles: doc.style.profiles,
      extensions: doc.style.extensions,
      sky: doc.style.sky,
      fog: doc.fog.enabled,
      fogStart: doc.fog.start,
      fogEnd: doc.fog.end,
      environment: doc.environment.enabled,
      instances: doc.rootStore.instanceCount,
      name: editor.session.documentName,
      dirty: editor.session.isDirty,
    };
  });
}

/** Waits until the browser has painted two more frames. */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

async function openPanel(page: Page, name: string) {
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  const panel = page.getByRole('region', { name, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

async function blurFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

test('a style preset, x-ray, fog and an environment survive saving and reopening', async ({
  page,
}, testInfo) => {
  // Force the download and file-input fallback, which works in every browser and can be automated.
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target.showOpenFilePicker;
    delete target.showSaveFilePicker;
  });
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await page.evaluate(() => window.__planar?.editor.runCommand('file.openSample'));
  await expect.poll(async () => (await presentation(page)).instances).toBe(1);

  // Choose a preset in the Styles panel.
  const styles = await openPanel(page, 'Styles');
  await styles.getByRole('button', { name: 'Sketch Lines' }).click();
  await expect(styles.getByRole('button', { name: 'Sketch Lines' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await presentation(page)).extensions).toBe(true);
  await nextFrames(page);

  // Exercise every edge and background effect once; the fixtures fail the test on shader errors.
  await page.evaluate(() =>
    window.__planar?.editor.updateStyleSettings({
      backEdges: true,
      depthCue: true,
      endpoints: true,
      edgeColorMode: 'byAxis',
      sky: true,
      ground: true,
    }),
  );
  await nextFrames(page);
  const environment = await openPanel(page, 'Environment');
  await environment.getByRole('checkbox', { name: 'Show environment' }).check();
  await expect.poll(async () => (await presentation(page)).environment).toBe(true);
  await nextFrames(page);
  await page.evaluate(() => window.__planar?.editor.runCommand('camera.parallel'));
  await nextFrames(page);
  await page.evaluate(() => window.__planar?.editor.runCommand('camera.perspective'));

  // X-ray from the View menu.
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'X-Ray' }).click();
  await expect.poll(async () => (await presentation(page)).xRay).toBe(true);
  await nextFrames(page);

  // Fog from the Fog panel.
  const fog = await openPanel(page, 'Fog');
  await fog.getByRole('checkbox', { name: 'Show fog' }).check();
  const start = fog.getByRole('textbox', { name: 'Start (m)' });
  await start.fill('3');
  await start.press('Enter');
  const end = fog.getByRole('textbox', { name: 'End (m)' });
  await end.fill('60');
  await end.press('Enter');
  await expect.poll(async () => presentation(page)).toMatchObject({ fog: true, fogStart: 3, fogEnd: 60 });
  await nextFrames(page);

  // Save to a file.
  await blurFocus(page);
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+S');
  const download = await downloadPromise;
  const path = testInfo.outputPath('Styled House.planar');
  await download.saveAs(path);
  await expect.poll(async () => (await presentation(page)).dirty).toBe(false);

  // Another model resets the settings; reopening the file brings them back.
  await page.evaluate(() => window.__planar?.editor.runCommand('file.openSample'));
  await expect
    .poll(async () => presentation(page))
    .toMatchObject({ faceStyle: 'shadedWithTextures', xRay: false, fog: false, environment: false });
  await blurFocus(page);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+O');
  const chooser = await chooserPromise;
  await chooser.setFiles(path);
  await expect
    .poll(async () => presentation(page))
    .toMatchObject({
      faceStyle: 'shadedWithTextures',
      xRay: true,
      profiles: true,
      extensions: true,
      sky: true,
      fog: true,
      fogStart: 3,
      fogEnd: 60,
      environment: true,
      dirty: false,
    });
  await nextFrames(page);
});
