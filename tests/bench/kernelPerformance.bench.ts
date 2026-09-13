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

import { describe, test } from 'vitest';
import { vec3 } from '../../src/kernel/math/vec3';
import { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { createSnapshot, restoreSnapshot } from '../../src/kernel/model/snapshot';
import { validateDocument } from '../../src/kernel/model/validate';
import { insertSegments } from '../../src/kernel/ops/insertSegments';
import { rectangle } from '../kernel/helpers';

/** Each rectangle contributes 4 vertices, 4 edges and 1 face: 9 entities. */
const ENTITIES_PER_RECTANGLE = 9;
const RECTANGLE_SPACING = 2;
const LINE_GRID_SIZE = 30;
/** Workloads that take seconds are timed once; repeating them adds run time without adding insight. */
const SINGLE_RUN = { iterations: 1, time: 0 } as const;
const RESULTS_DIRECTORY = 'bench/results';

function rectangleGrid(entityCount: number): ModelDocument {
  const doc = new ModelDocument();
  const rectangles = Math.ceil(entityCount / ENTITIES_PER_RECTANGLE);
  const columns = Math.ceil(Math.sqrt(rectangles));
  for (let i = 0; i < rectangles; i++) {
    const x = (i % columns) * RECTANGLE_SPACING;
    const y = Math.floor(i / columns) * RECTANGLE_SPACING;
    insertSegments(doc, doc.rootDefinitionId, rectangle(x, y, x + 1, y + 1), { autoFace: true });
  }
  return doc;
}

/** Crossing lines drawn one at a time: every line splits the lines it crosses and closes new faces. */
function lineGrid(size: number): ModelDocument {
  const doc = new ModelDocument();
  for (let i = 0; i <= size; i++) {
    insertSegments(doc, doc.rootDefinitionId, [{ a: vec3(i, 0, 0), b: vec3(i, size, 0) }], {
      autoFace: true,
    });
  }
  for (let j = 0; j <= size; j++) {
    insertSegments(doc, doc.rootDefinitionId, [{ a: vec3(0, j, 0), b: vec3(size, j, 0) }], {
      autoFace: true,
    });
  }
  return doc;
}

describe('kernel performance', () => {
  for (const entities of [1_000, 10_000, 100_000]) {
    test(`draw ${String(entities)} entities as separate rectangles`, async ({ bench }) => {
      await bench(
        `draw-rectangles-${String(entities)}`,
        { writeResult: `${RESULTS_DIRECTORY}/draw-rectangles-${String(entities)}.json` },
        () => {
          rectangleGrid(entities);
        },
      ).run(SINGLE_RUN);
    });
  }

  test(`draw a ${String(LINE_GRID_SIZE)}×${String(LINE_GRID_SIZE)} grid of crossing lines`, async ({
    bench,
  }) => {
    await bench('draw-line-grid', { writeResult: `${RESULTS_DIRECTORY}/draw-line-grid.json` }, () => {
      lineGrid(LINE_GRID_SIZE);
    }).run(SINGLE_RUN);
  });

  test('validate a 10k-entity model', async ({ bench }) => {
    const doc = rectangleGrid(10_000);
    await bench('validate-10000', { writeResult: `${RESULTS_DIRECTORY}/validate-10000.json` }, () => {
      validateDocument(doc);
    }).run();
  });

  test('snapshot and restore a 10k-entity model', async ({ bench }) => {
    const doc = rectangleGrid(10_000);
    await bench(
      'snapshot-restore-10000',
      { writeResult: `${RESULTS_DIRECTORY}/snapshot-restore-10000.json` },
      () => {
        const result = restoreSnapshot(JSON.parse(JSON.stringify(createSnapshot(doc))));
        if (!result.ok) throw new Error(result.error);
      },
    ).run(SINGLE_RUN);
  });
});
