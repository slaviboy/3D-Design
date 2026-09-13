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

/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Application version from package.json, injected at build time. */
declare const __APP_VERSION__: string;
/** True only in `--mode e2e` builds, which expose `window.__planar` for end-to-end tests. */
declare const __PLANAR_TEST_HOOKS__: boolean;
