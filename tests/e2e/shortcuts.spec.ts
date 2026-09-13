import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function chordsFor(page: Page, commandId: string) {
  return page.evaluate((id) => [...(window.__planar?.editor.shortcuts.chordsFor(id) ?? [])], commandId);
}

async function changeShortcut(page: Page, commandLabel: string, search: string, chord: string) {
  await page.keyboard.press('Shift+S');
  const palette = page.getByRole('dialog', { name: 'Search commands' });
  await expect(palette).toBeVisible();
  await page.keyboard.type(search);
  await palette.getByRole('button', { name: `Change shortcut for ${commandLabel}`, exact: true }).click();
  await expect(
    palette.getByRole('application', { name: `Press the new shortcut for ${commandLabel}` }),
  ).toBeFocused();
  await page.keyboard.press(chord);
  return palette;
}

test('changes shortcuts from the command palette, resolves conflicts, and keeps them after reloading', async ({
  page,
}) => {
  await page.goto('/');
  // Shortcuts are handled only once the app has mounted.
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  const viewport = page.getByRole('application', { name: '3D viewport' });

  const palette = await changeShortcut(page, 'Polygon', 'polygon', 'Shift+G');
  await expect.poll(() => chordsFor(page, 'tool.polygon')).toEqual(['Shift+G']);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await page.keyboard.press('Shift+G');
  await expect(viewport).toHaveAttribute('data-active-tool', 'tool.polygon');

  const conflicting = await changeShortcut(page, 'Rectangle', 'rectangle', 'l');
  await expect(conflicting.getByRole('group', { name: 'Shortcut conflict' })).toContainText('Line');
  await conflicting.getByRole('button', { name: 'Replace' }).click();
  await expect.poll(() => chordsFor(page, 'tool.rectangle')).toContain('L');
  await expect.poll(() => chordsFor(page, 'tool.line')).toEqual([]);
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await page.keyboard.press('Shift+G');
  await expect(viewport).toHaveAttribute('data-active-tool', 'tool.polygon');
  await page.keyboard.press('l');
  await expect(viewport).toHaveAttribute('data-active-tool', 'tool.rectangle');

  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Keyboard Shortcuts…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  await dialog.getByRole('button', { name: 'Reset All' }).click();
  await expect.poll(() => chordsFor(page, 'tool.line')).toEqual(['L']);
  await expect.poll(() => chordsFor(page, 'tool.polygon')).toEqual([]);
});
