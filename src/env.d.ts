/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Application version from package.json, injected at build time. */
declare const __APP_VERSION__: string;
/** True only in `--mode e2e` builds, which expose `window.__planar` for end-to-end tests. */
declare const __PLANAR_TEST_HOOKS__: boolean;
