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

import { test as base, expect } from '@playwright/test';

interface PlanarOptions {
  /** Show the start screen as a first-time visitor sees it. Off by default, so tests start in the workspace. */
  startScreen: boolean;
}

interface PlanarFixtures {
  /** Requests made to origins other than the preview server. Must be empty when the test ends. */
  externalRequests: string[];
  /** Uncaught page errors and console errors seen during the test. Must be empty when the test ends. */
  pageErrors: string[];
  hideStartScreen: undefined;
}

/**
 * Every E2E test runs with two automatic guards:
 * - the offline guard fails the test if the app contacts any other origin, since Planar must never use the network at runtime;
 * - the error guard fails the test on uncaught exceptions or console errors.
 */
export const test = base.extend<PlanarFixtures & PlanarOptions>({
  startScreen: [false, { option: true }],
  hideStartScreen: [
    async ({ context, startScreen }, use) => {
      // Applies to every page in the context, including pages a test opens itself.
      if (!startScreen) {
        await context.addInitScript(() => {
          window.localStorage.setItem('planar.startScreen', 'hidden');
        });
      }
      await use(undefined);
    },
    { auto: true },
  ],
  externalRequests: [
    async ({ page, baseURL }, use) => {
      if (!baseURL) throw new Error('Playwright baseURL must be configured');
      const allowedOrigin = new URL(baseURL).origin;
      const external: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol === 'data:' || url.protocol === 'blob:') return;
        if (url.origin !== allowedOrigin) external.push(request.url());
      });
      await use(external);
      expect(external, 'runtime requests to external origins').toEqual([]);
    },
    { auto: true },
  ],
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await use(errors);
      expect(errors, 'page errors and console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
