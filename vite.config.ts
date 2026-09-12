import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import packageJson from './package.json' with { type: 'json' };

/**
 * Content-Security-Policy for production builds.
 *
 * `connect-src 'self'` makes any runtime request to another origin fail, which backs up the offline guarantee.
 * `'wasm-unsafe-eval'` is required to instantiate the bundled WebAssembly boolean kernel. Not applied to the dev
 * server, because Vite's hot module reloading uses inline scripts and a WebSocket.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/** Service worker precache limit; large enough for the WebAssembly kernel and bundled environment maps. */
const MAX_PRECACHE_FILE_BYTES = 20 * 1024 * 1024;

function contentSecurityPolicy(): Plugin {
  return {
    name: 'planar-content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Planar',
        short_name: 'Planar',
        description: 'Offline 3D modeling in your browser',
        theme_color: '#1f66d6',
        background_color: '#e9ecef',
        display: 'standalone',
        start_url: '.',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,hdr,exr,woff2,json}'],
        maximumFileSizeToCacheInBytes: MAX_PRECACHE_FILE_BYTES,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __PLANAR_TEST_HOOKS__: JSON.stringify(mode === 'e2e'),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
}));
