import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { vec3, type Vec3 } from '../../src/kernel/math/vec3';
import { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { insertSegments, type SegmentInput } from '../../src/kernel/ops/insertSegments';
import { encodePlanarFile } from '../../src/io/format/planarFile';

/** Each 1 m box is 8 vertices, 12 edges and 6 faces. */
const ENTITIES_PER_BOX = 26;
const BOX_SPACING = 2;
const ORBIT_FRAMES = 120;
const WARMUP_FRAMES = 10;
const RESULTS_DIRECTORY = 'bench/results';

function loop(points: readonly Vec3[]): SegmentInput[] {
  return points.map((a, i) => ({ a, b: points[(i + 1) % points.length] ?? a }));
}

function boxEdges(x: number, y: number): SegmentInput[] {
  const bottom = [vec3(x, y, 0), vec3(x + 1, y, 0), vec3(x + 1, y + 1, 0), vec3(x, y + 1, 0)];
  const top = bottom.map((p) => vec3(p.x, p.y, 1));
  return [...loop(bottom), ...loop(top), ...bottom.map((a, i) => ({ a, b: top[i] ?? a }))];
}

/** A square grid of separate boxes with about `entityCount` entities. */
function boxGrid(entityCount: number): { bytes: Uint8Array; boxes: number } {
  const doc = new ModelDocument();
  const boxes = Math.ceil(entityCount / ENTITIES_PER_BOX);
  const columns = Math.ceil(Math.sqrt(boxes));
  for (let i = 0; i < boxes; i++) {
    const x = (i % columns) * BOX_SPACING;
    const y = Math.floor(i / columns) * BOX_SPACING;
    insertSegments(doc, doc.rootDefinitionId, boxEdges(x, y), { autoFace: true });
  }
  return { bytes: encodePlanarFile(doc, { appVersion: 'bench', now: new Date(0) }), boxes };
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? Number.NaN;
}

for (const entities of [1_000, 10_000, 100_000]) {
  test(`orbits a ${String(entities)}-entity model`, async ({ page }) => {
    const { bytes, boxes } = boxGrid(entities);
    await page.addInitScript(() => {
      window.localStorage.setItem('planar.startScreen', 'hidden');
    });
    await page.goto('/');
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

    const gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });

    const result = await page.evaluate(
      async ({ file, frames, warmup }) => {
        const editor = window.__planar?.editor;
        if (!editor) throw new Error('test hook missing: build with --mode e2e');
        const nextFrame = () =>
          new Promise<number>((resolve) => {
            requestAnimationFrame(resolve);
          });

        const loadStart = performance.now();
        if (!editor.loadFile(new Uint8Array(file), 'bench.planar')) throw new Error('the model did not load');
        editor.zoomExtents();
        await nextFrame();
        await nextFrame();
        const loadMs = performance.now() - loadStart;

        for (let i = 0; i < warmup; i++) {
          editor.orbitBy(6, 0);
          await nextFrame();
        }
        const intervals: number[] = [];
        let last = await nextFrame();
        for (let i = 0; i < frames; i++) {
          // The camera change schedules the viewport's render for the next frame; this callback runs after it.
          editor.orbitBy(6, i % 2 === 0 ? 1 : -1);
          const now = await nextFrame();
          intervals.push(now - last);
          last = now;
        }
        return { loadMs, intervals };
      },
      { file: [...bytes], frames: ORBIT_FRAMES, warmup: WARMUP_FRAMES },
    );

    const sorted = [...result.intervals].sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const summary = {
      benchmark: `render-orbit-${String(entities)}`,
      entities: boxes * ENTITIES_PER_BOX,
      boxes,
      fileBytes: bytes.byteLength,
      gpu,
      loadMs: Math.round(result.loadMs),
      frames: ORBIT_FRAMES,
      medianFrameMs: Number(median.toFixed(2)),
      p95FrameMs: Number(p95.toFixed(2)),
      medianFps: Number((1000 / median).toFixed(1)),
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    await mkdir(RESULTS_DIRECTORY, { recursive: true });
    await writeFile(
      `${RESULTS_DIRECTORY}/${summary.benchmark}.json`,
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    expect(result.intervals).toHaveLength(ORBIT_FRAMES);
  });
}
