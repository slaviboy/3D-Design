import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { encodePlanarFile } from '../../src/io/format/planarFile';
import { boxGrid, paintAllFaces } from '../bench/models';
import { checkerPng } from '../bench/pngImage';

const ORBIT_FRAMES = 120;
const WARMUP_FRAMES = 10;
const FLIP_REPEATS = 3;
const RESULTS_DIRECTORY = 'bench/results';
const MB = 1024 * 1024;

declare global {
  interface Window {
    /** When the most recent createImageBitmap call resolved (performance.now()), recorded by the benchmark. */
    __benchBitmapReadyAt?: number | undefined;
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? Number.NaN;
}

const round = (value: number, digits = 1): number => Number(value.toFixed(digits));

async function writeResult(summary: { benchmark: string } & Record<string, unknown>): Promise<void> {
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  await mkdir(RESULTS_DIRECTORY, { recursive: true });
  await writeFile(`${RESULTS_DIRECTORY}/${summary.benchmark}.json`, `${JSON.stringify(summary, null, 2)}\n`);
}

async function openApp(page: Page): Promise<string> {
  await page.addInitScript(() => {
    window.localStorage.setItem('planar.startScreen', 'hidden');
    // Texture decoding is asynchronous; record when it finishes so texture load time can be measured.
    const original = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((...args: Parameters<typeof original>) =>
      original(...args).then((bitmap) => {
        window.__benchBitmapReadyAt = performance.now();
        return bitmap;
      })) as typeof window.createImageBitmap;
  });
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
}

/** JS heap in use after a forced garbage collection, in MB. Chromium only (Chrome DevTools Protocol). */
async function heapMb(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const used = metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? Number.NaN;
  return round(used / MB);
}

interface LoadResult {
  /** From loadFile until the model has been rendered twice. */
  readonly loadMs: number;
  /** From loadFile until the texture was decoded and the model rendered twice more; null without a texture. */
  readonly textureReadyMs: number | null;
}

async function loadModel(page: Page, bytes: Uint8Array, textured: boolean): Promise<LoadResult> {
  return page.evaluate(
    async ({ file, waitForTexture }) => {
      const editor = window.__planar?.editor;
      if (!editor) throw new Error('test hook missing: build with --mode e2e');
      const nextFrame = () =>
        new Promise<number>((resolve) => {
          requestAnimationFrame(resolve);
        });
      window.__benchBitmapReadyAt = undefined;
      const loadStart = performance.now();
      if (!editor.loadFile(new Uint8Array(file), 'bench.planar')) throw new Error('the model did not load');
      editor.zoomExtents();
      await nextFrame();
      await nextFrame();
      const loadMs = performance.now() - loadStart;
      if (!waitForTexture) return { loadMs, textureReadyMs: null };
      const deadline = loadStart + 60_000;
      const decoded = (): boolean => window.__benchBitmapReadyAt !== undefined;
      while (!decoded()) {
        if (performance.now() > deadline) throw new Error('the texture was not decoded');
        await nextFrame();
      }
      await nextFrame();
      await nextFrame();
      return { loadMs, textureReadyMs: performance.now() - loadStart };
    },
    { file: [...bytes], waitForTexture: textured },
  );
}

interface OrbitResult {
  readonly frames: number;
  readonly medianFrameMs: number;
  readonly p95FrameMs: number;
  readonly medianFps: number;
}

async function orbit(page: Page): Promise<OrbitResult> {
  const intervals = await page.evaluate(
    async ({ frames, warmup }) => {
      const editor = window.__planar?.editor;
      if (!editor) throw new Error('test hook missing: build with --mode e2e');
      const nextFrame = () =>
        new Promise<number>((resolve) => {
          requestAnimationFrame(resolve);
        });
      for (let i = 0; i < warmup; i++) {
        editor.orbitBy(6, 0);
        await nextFrame();
      }
      const result: number[] = [];
      let last = await nextFrame();
      for (let i = 0; i < frames; i++) {
        // The camera change schedules the viewport's render for the next frame; this callback runs after it.
        editor.orbitBy(6, i % 2 === 0 ? 1 : -1);
        const now = await nextFrame();
        result.push(now - last);
        last = now;
      }
      return result;
    },
    { frames: ORBIT_FRAMES, warmup: WARMUP_FRAMES },
  );
  expect(intervals).toHaveLength(ORBIT_FRAMES);
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  return {
    frames: ORBIT_FRAMES,
    medianFrameMs: round(median, 2),
    p95FrameMs: round(percentile(sorted, 0.95), 2),
    medianFps: round(1000 / median),
  };
}

for (const entities of [1_000, 10_000, 100_000]) {
  test(`orbits and edits a ${String(entities)}-entity model`, async ({ page }) => {
    const grid = boxGrid(entities);
    const bytes = encodePlanarFile(grid.doc, { appVersion: 'bench', now: new Date(0) });
    const gpu = await openApp(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const heapBeforeLoadMb = await heapMb(cdp);

    const { loadMs } = await loadModel(page, bytes, false);
    const heapAfterLoadMb = await heapMb(cdp);
    const orbitResult = await orbit(page);
    const heapAfterOrbitMb = await heapMb(cdp);

    await writeResult({
      benchmark: `render-orbit-${String(entities)}`,
      entities: grid.entities,
      boxes: grid.boxes,
      fileBytes: bytes.byteLength,
      gpu,
      loadMs: Math.round(loadMs),
      ...orbitResult,
      jsHeapUsedMb: {
        beforeLoad: heapBeforeLoadMb,
        afterLoad: heapAfterLoadMb,
        afterOrbit: heapAfterOrbitMb,
      },
    });

    // Geometry update: flip everything along X through the editor, timed until the next rendered frame.
    const flips = await page.evaluate(async (repeats) => {
      const editor = window.__planar?.editor;
      if (!editor) throw new Error('test hook missing: build with --mode e2e');
      const nextFrame = () =>
        new Promise<number>((resolve) => {
          requestAnimationFrame(resolve);
        });
      editor.selectAll();
      await nextFrame();
      await nextFrame();
      const result: { editMs: number; frameMs: number }[] = [];
      for (let i = 0; i < repeats; i++) {
        const start = performance.now();
        editor.flipSelection('x');
        const edited = performance.now();
        // The document change scheduled the viewport's render; this callback runs after that render, so the clock
        // is read in it (the callback's timestamp is the frame's start).
        const rendered = await new Promise<number>((resolve) => {
          requestAnimationFrame(() => {
            resolve(performance.now());
          });
        });
        result.push({ editMs: edited - start, frameMs: rendered - start });
        await nextFrame();
      }
      return { flips: result, selected: editor.session.selection.size };
    }, FLIP_REPEATS);
    const heapAfterEditsMb = await heapMb(cdp);
    const median = (values: number[]): number =>
      round(
        percentile(
          [...values].sort((a, b) => a - b),
          0.5,
        ),
      );
    await writeResult({
      benchmark: `render-update-${String(entities)}`,
      entities: grid.entities,
      gpu,
      operation: 'select all, then Flip Along X (editor.flipSelection), repeated',
      selectedEntities: flips.selected,
      repeats: FLIP_REPEATS,
      medianEditMs: median(flips.flips.map((flip) => flip.editMs)),
      medianUntilRenderedMs: median(flips.flips.map((flip) => flip.frameMs)),
      runs: flips.flips.map((flip) => ({ editMs: round(flip.editMs), untilRenderedMs: round(flip.frameMs) })),
      jsHeapUsedMbAfterEdits: heapAfterEditsMb,
    });
    expect(flips.flips).toHaveLength(FLIP_REPEATS);
  });
}

for (const textureSize of [4096, 8192]) {
  test(`orbits a 10k-entity model painted with a ${String(textureSize)}px texture`, async ({ page }) => {
    const image = checkerPng(textureSize);
    const grid = boxGrid(10_000);
    paintAllFaces(grid.doc, image);
    const bytes = encodePlanarFile(grid.doc, { appVersion: 'bench', now: new Date(0) });
    const gpu = await openApp(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const heapBeforeLoadMb = await heapMb(cdp);

    const load = await loadModel(page, bytes, true);
    const heapAfterLoadMb = await heapMb(cdp);
    const orbitResult = await orbit(page);
    const heapAfterOrbitMb = await heapMb(cdp);

    await writeResult({
      benchmark: `render-textured-${String(textureSize)}`,
      entities: grid.entities,
      boxes: grid.boxes,
      texture: `${String(textureSize)}x${String(textureSize)} RGB PNG, every face painted on both sides`,
      textureFileBytes: image.byteLength,
      fileBytes: bytes.byteLength,
      gpu,
      loadMs: Math.round(load.loadMs),
      textureReadyMs: load.textureReadyMs === null ? null : Math.round(load.textureReadyMs),
      ...orbitResult,
      jsHeapUsedMb: {
        beforeLoad: heapBeforeLoadMb,
        afterLoad: heapAfterLoadMb,
        afterOrbit: heapAfterOrbitMb,
      },
    });
  });
}
