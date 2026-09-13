import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Runs axe against WCAG 2.x A and AA rules and returns the serious and critical violations, one line per node. */
async function seriousViolations(page: Page, include?: string): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id}: ${violation.help} — ${node.target.join(' ')}`),
    );
}

test('the workspace has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('menus have no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('dialogs have no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

  await page.keyboard.press('Shift+S');
  await expect(page.getByRole('dialog', { name: 'Search commands' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Preferences…' }).click();
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Keyboard Shortcuts…' }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test.describe('with the start screen', () => {
  test.use({ startScreen: true });

  test('the start screen has no serious accessibility violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: 'Start' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`an open context menu has no serious accessibility violations (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
    await page.evaluate(() => window.__planar?.editor.runCommand('file.openSample'));
    await expect
      .poll(() => page.evaluate(() => window.__planar?.editor.session.doc.rootStore.instanceCount))
      .toBe(1);
    await page.keyboard.press('ControlOrMeta+A');
    await expect(page.getByTestId('selection-count')).toHaveText('1 selected');

    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu', { name: 'Context menu' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('s');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menu', { name: 'Select' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test(`the Instructor panel has no serious accessibility violations (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
    await page.evaluate(() => window.__planar?.editor.runCommand('window.instructor'));
    const instructor = page.getByRole('region', { name: 'Instructor' });
    await expect(instructor.getByRole('heading', { name: 'Select', exact: true })).toBeVisible();
    await page.getByRole('separator', { name: 'Resize panels' }).focus();
    expect(await seriousViolations(page)).toEqual([]);
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the Styles, Fog and Environment panels have no serious violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
    await page.evaluate(() => {
      const editor = window.__planar?.editor;
      if (!editor) throw new Error('test hook missing: build with --mode e2e');
      for (const panel of ['entityInfo', 'outliner', 'components', 'tags', 'materials'] as const) {
        if (editor.isPanelOpen(panel)) editor.togglePanel(panel);
      }
      for (const panel of ['styles', 'fog', 'environment'] as const) editor.togglePanel(panel);
      editor.saveInModelStyle('Study');
    });
    await expect(page.getByRole('region', { name: 'Environment', exact: true })).toBeVisible();
    expect(await seriousViolations(page, '.dock')).toEqual([]);
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`pressed toggles in the Shadows, Scenes and Components panels meet contrast in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
    await page.evaluate(() => {
      const editor = window.__planar?.editor;
      if (!editor) throw new Error('test hook missing: build with --mode e2e');
      for (const panel of ['entityInfo', 'outliner', 'tags', 'materials'] as const) {
        if (editor.isPanelOpen(panel)) editor.togglePanel(panel);
      }
      for (const panel of ['shadows', 'scenes', 'components'] as const) {
        if (!editor.isPanelOpen(panel)) editor.togglePanel(panel);
      }
    });
    const shadows = page.getByRole('region', { name: 'Shadows', exact: true });
    const toggle = shadows.locator('button[aria-pressed]').first();
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await seriousViolations(page, '.dock')).toEqual([]);
  });
}

test('the dark theme has no serious contrast violations', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
