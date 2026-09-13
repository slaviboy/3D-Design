import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Top-level instances, read through the e2e-only test hook. */
async function rootInstances(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    return [...editor.session.doc.rootStore.instances()].map((instance) => ({
      name: instance.attributes.name,
      tagId: instance.attributes.tagId,
    }));
  });
}

async function openSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => window.__planar?.editor.runCommand('file.openSample'));
  await expect.poll(async () => (await rootInstances(page)).length).toBe(1);
}

async function viewportCenter(page: Page) {
  const box = await page.getByRole('application', { name: '3D viewport' }).boundingBox();
  if (!box) throw new Error('viewport not laid out');
  return { box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('a hidden tag hides its group so clicking no longer selects it', async ({ page }) => {
  await openSample(page);
  const center = await viewportCenter(page);
  const selectionCount = page.getByTestId('selection-count');
  const tags = page.getByRole('region', { name: 'Tags' });

  await tags.getByRole('button', { name: 'Add Tag' }).click();
  await expect(tags.getByRole('textbox', { name: 'Name of Tag 1' })).toHaveValue('Tag 1');

  await page.mouse.click(center.x, center.y);
  await expect(selectionCount).toHaveText('1 selected');
  await page
    .getByRole('region', { name: 'Entity Info' })
    .getByRole('combobox', { name: 'Tag' })
    .selectOption({ label: 'Tag 1' });
  await expect.poll(async () => (await rootInstances(page))[0]?.tagId).not.toBeNull();

  await tags.getByRole('checkbox', { name: 'Show Tag 1' }).uncheck();
  await expect(selectionCount).toHaveText('Nothing selected');
  await page.mouse.click(center.x, center.y);
  await expect(selectionCount).toHaveText('Nothing selected');

  await tags.getByRole('checkbox', { name: 'Show Tag 1' }).check();
  await page.mouse.click(center.x, center.y);
  await expect(selectionCount).toHaveText('1 selected');
});

test('renames a group in the Outliner with the keyboard', async ({ page }) => {
  await openSample(page);
  const outliner = page.getByRole('region', { name: 'Outliner' });
  const item = outliner.getByRole('treeitem', { name: 'Group' });
  await item.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');

  await page.keyboard.press('F2');
  const input = outliner.getByRole('textbox', { name: 'New name' });
  await expect(input).toBeFocused();
  await page.keyboard.type('House');
  await page.keyboard.press('Enter');

  await expect(outliner.getByRole('treeitem', { name: 'House' })).toBeFocused();
  await expect.poll(async () => (await rootInstances(page))[0]?.name).toBe('House');
});

test('places a component instance from the Components panel', async ({ page }) => {
  await openSample(page);
  const viewport = page.getByRole('application', { name: '3D viewport' });
  const { box } = await viewportCenter(page);

  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('g');
  const components = page.getByRole('region', { name: 'Components' });
  await expect(components.getByRole('textbox', { name: 'Name of Component#1' })).toBeVisible();

  await components.getByRole('button', { name: 'Place Component#1' }).click();
  await expect(viewport).toHaveAttribute('data-active-tool', 'tool.placeComponent');
  const target = { x: box.x + 60, y: box.y + box.height - 60 };
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.mouse.click(target.x, target.y);

  await expect.poll(async () => (await rootInstances(page)).length).toBe(2);
  await expect(components.getByLabel('2 instances')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-active-tool', 'tool.select');
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');
});
