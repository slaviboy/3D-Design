import { defineConfig, devices } from '@playwright/test';

const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://localhost:${String(PREVIEW_PORT)}`;

/** E2E tests run against the production build (`vite build`), served by `vite preview`. */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: PREVIEW_URL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite preview --port ${String(PREVIEW_PORT)} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
