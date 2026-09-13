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

test('the dark theme has no serious contrast violations', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
