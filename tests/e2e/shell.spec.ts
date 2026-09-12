import { expect, test } from './fixtures';

test('the application shell loads from the production build', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Planar');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Planar' })).toBeVisible();
});

test('the production build sets a restrictive Content-Security-Policy', async ({ page }) => {
  await page.goto('/');
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("object-src 'none'");
});
