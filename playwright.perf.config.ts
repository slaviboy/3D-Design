import { defineConfig, devices } from '@playwright/test';

/** A different port from the E2E suite, so a benchmark run never collides with a concurrent `npm run e2e`. */
const PREVIEW_PORT = 4273;
const PREVIEW_URL = `http://localhost:${String(PREVIEW_PORT)}`;

/**
 * Rendering benchmarks (`npm run bench:render`). They run against the e2e-mode production build, one test at a
 * time so measurements don't compete for the GPU, and record results in `bench/results/`.
 */
export default defineConfig({
  testDir: 'tests/perf',
  testMatch: '**/*.perf.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: [['list']],
  use: {
    baseURL: PREVIEW_URL,
    viewport: { width: 1280, height: 800 },
    // Ask for hardware rendering; headless Chromium otherwise falls back to SwiftShader (software). Each result
    // records the renderer that was actually used.
    launchOptions: {
      args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: `npx vite preview --port ${String(PREVIEW_PORT)} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
});
