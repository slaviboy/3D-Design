import { expect, test } from './fixtures';

test('the workspace shows menus, tools, the 3D view and panels', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Untitled — Planar');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Main toolbar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('application', { name: '3D viewport' }).locator('canvas')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Entity Info' })).toBeVisible();
  await expect(page.getByTestId('selection-count')).toHaveText('Nothing selected');
});

test('the production build sets a restrictive Content-Security-Policy', async ({ page }) => {
  await page.goto('/');
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("style-src 'self'");
  expect(policy).toContain("object-src 'none'");
});
