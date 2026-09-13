import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** These tests never use the mouse: everything happens through keys and focus. */

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  // Keys are handled only once the app has mounted.
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
}

async function rootInstances(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    return [...editor.session.doc.rootStore.instances()].map((instance) => ({
      locked: instance.attributes.locked,
    }));
  });
}

test('opens a menu with the keyboard and runs a command', async ({ page, browserName }) => {
  await openApp(page);
  const file = page.getByRole('menuitem', { name: 'File', exact: true });
  // Safari's Tab only visits form fields unless "Tab to all controls" is on; Option+Tab visits every control.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(file).toBeFocused();

  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'File' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Open Sample Model' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(menu).toBeHidden();
  await expect(file).toBeFocused();
  await expect.poll(async () => (await rootInstances(page)).length).toBe(1);
});

test('opens and uses a context menu with Shift+F10', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__planar?.editor.runCommand('file.openSample'));
  await expect.poll(async () => (await rootInstances(page)).length).toBe(1);
  await page.keyboard.press('ControlOrMeta+A');
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');

  const viewport = page.getByRole('application', { name: '3D viewport' });
  const menu = page.getByRole('menu', { name: 'Context menu' });
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Entity Info' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Unlock' })).toHaveCount(0);

  // A submenu opens with the right arrow and closes with the left arrow.
  await page.keyboard.press('s');
  const selectItem = menu.getByRole('menuitem', { name: 'Select', exact: true });
  await expect(selectItem).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const submenu = page.getByRole('menu', { name: 'Select' });
  await expect(submenu.getByRole('menuitem', { name: 'All on Same Tag' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(submenu).toBeHidden();
  await expect(selectItem).toBeFocused();

  // Escape closes the menu and returns focus.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(viewport).toBeFocused();

  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('l');
  await expect(menu.getByRole('menuitem', { name: 'Lock', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(viewport).toBeFocused();
  await expect.poll(async () => (await rootInstances(page))[0]?.locked).toBe(true);

  await page.keyboard.press('Shift+F10');
  await expect(menu.getByRole('menuitem', { name: 'Unlock' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Lock', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('resizes the dock with the splitter’s arrow keys and keeps the width', async ({ page }) => {
  await openApp(page);
  const splitter = page.getByRole('separator', { name: 'Resize panels' });
  const dock = page.getByRole('complementary', { name: 'Panels' });
  const dockWidth = async () => Math.round((await dock.boundingBox())?.width ?? 0);

  await splitter.focus();
  await expect(splitter).toHaveAttribute('aria-valuenow', '280');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await expect(splitter).toHaveAttribute('aria-valuenow', '310');
  await expect.poll(dockWidth).toBe(310);
  await page.keyboard.press('ArrowRight');
  await expect(splitter).toHaveAttribute('aria-valuenow', '300');

  await page.keyboard.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', '200');
  await expect.poll(dockWidth).toBe(200);
  const half = await page.evaluate(() => Math.floor(window.innerWidth / 2));
  await page.keyboard.press('End');
  await expect(splitter).toHaveAttribute('aria-valuenow', String(half));
  await expect.poll(dockWidth).toBe(half);

  await page.reload();
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await expect(splitter).toHaveAttribute('aria-valuenow', String(half));

  // Window > Reset Panels restores the default width.
  await page.getByRole('menuitem', { name: 'Window', exact: true }).focus();
  await page.keyboard.press('Enter');
  const windowMenu = page.getByRole('menu', { name: 'Window' });
  await page.keyboard.press('End');
  await expect(windowMenu.getByRole('menuitem', { name: 'Reset Panels' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(splitter).toHaveAttribute('aria-valuenow', '280');
  await expect.poll(dockWidth).toBe(280);
});

test('opens the Instructor panel, which follows the active tool', async ({ page }) => {
  await openApp(page);
  const trigger = page.getByRole('menuitem', { name: 'Window', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const windowMenu = page.getByRole('menu', { name: 'Window' });
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowUp');
  await expect(windowMenu.getByRole('menuitemradio', { name: 'Instructor' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toBeFocused();

  const instructor = page.getByRole('region', { name: 'Instructor' });
  await expect(instructor.getByRole('heading', { name: 'Select', exact: true })).toBeVisible();

  await page.keyboard.press('r');
  await expect(instructor.getByRole('heading', { name: 'Rectangle', exact: true })).toBeVisible();
  await expect(instructor).toContainText('2m,1m');

  await page.keyboard.press('m');
  await expect(instructor.getByRole('heading', { name: 'Move', exact: true })).toBeVisible();
  const toggleKey = await page.evaluate(() => (/mac/i.test(navigator.platform) ? 'Option' : 'Ctrl'));
  await expect(instructor.locator('kbd', { hasText: new RegExp(`^${toggleKey}$`) })).toBeVisible();

  // The panel can be moved and collapsed without the mouse.
  const moveUp = instructor.getByRole('button', { name: 'Move Instructor up' });
  await moveUp.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const order = window.__planar?.editor.dockLayout.order ?? [];
        return order.indexOf('instructor') < order.indexOf('shadows');
      }),
    )
    .toBe(true);
  // Panels are rendered in dock order, so Tab reaches them in the order the user arranged.
  await expect(async () => {
    const { inDom, expected } = await page.evaluate(() => {
      const editor = window.__planar?.editor;
      if (!editor) throw new Error('test hook missing: build with --mode e2e');
      return {
        inDom: [...document.querySelectorAll<HTMLElement>('.dock [data-panel]')].map(
          (panel) => panel.dataset.panel,
        ),
        expected: editor.dockLayout.order.filter((id) => editor.isPanelOpen(id)),
      };
    });
    expect(inDom).toEqual(expected);
  }).toPass();
  const header = instructor.getByRole('button', { name: 'Instructor', exact: true });
  await header.focus();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'false');
});
