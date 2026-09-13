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

import { vec3, type Vec3 } from '../../kernel/math/vec3';
import { ModelDocument } from '../../kernel/model/ModelDocument';
import { makeGroup } from '../../kernel/ops/hierarchy';
import { insertSegments, type SegmentInput } from '../../kernel/ops/insertSegments';

export const SAMPLE_MODEL_NAME = 'Sample House';

const WIDTH = 6;
const DEPTH = 4;
const WALL_HEIGHT = 3;
const RIDGE_HEIGHT = 4.5;
const DOOR = { x0: 2.5, x1: 3.5, height: 2.1 };
const WINDOW_HEIGHTS = { bottom: 1, top: 2 };
const WINDOW_SPANS: readonly (readonly [number, number])[] = [
  [0.8, 1.8],
  [4.2, 5.2],
];

function loop(points: readonly Vec3[]): SegmentInput[] {
  return points.map((a, i) => ({ a, b: points[(i + 1) % points.length] ?? a }));
}

function chain(points: readonly Vec3[]): SegmentInput[] {
  return points.slice(1).map((b, i) => ({ a: points[i] ?? b, b }));
}

/** A small gabled house with a door and two windows, grouped as one object. Built entirely with kernel operations. */
export function createSampleModel(): ModelDocument {
  const doc = new ModelDocument();
  const root = doc.rootDefinitionId;
  doc.transact('Build sample model', () => {
    const bottom = [vec3(0, 0, 0), vec3(WIDTH, 0, 0), vec3(WIDTH, DEPTH, 0), vec3(0, DEPTH, 0)];
    const top = bottom.map((p) => vec3(p.x, p.y, WALL_HEIGHT));
    const ridgeStart = vec3(0, DEPTH / 2, RIDGE_HEIGHT);
    const ridgeEnd = vec3(WIDTH, DEPTH / 2, RIDGE_HEIGHT);
    const segments: SegmentInput[] = [
      ...loop(bottom),
      ...loop(top),
      ...bottom.map((a, i) => ({ a, b: top[i] ?? a })),
      { a: ridgeStart, b: ridgeEnd },
      ...top.map((a) => ({ a, b: a.x === 0 ? ridgeStart : ridgeEnd })),
      ...chain([
        vec3(DOOR.x0, 0, 0),
        vec3(DOOR.x0, 0, DOOR.height),
        vec3(DOOR.x1, 0, DOOR.height),
        vec3(DOOR.x1, 0, 0),
      ]),
      ...WINDOW_SPANS.flatMap(([x0, x1]) =>
        loop([
          vec3(x0, 0, WINDOW_HEIGHTS.bottom),
          vec3(x1, 0, WINDOW_HEIGHTS.bottom),
          vec3(x1, 0, WINDOW_HEIGHTS.top),
          vec3(x0, 0, WINDOW_HEIGHTS.top),
        ]),
      ),
    ];
    insertSegments(doc, root, segments, { autoFace: true });
    const store = doc.store(root);
    makeGroup(doc, root, {
      faces: [...store.faces()].map((face) => face.id),
      edges: [...store.edges()].map((edge) => edge.id),
    });
  });
  doc.clearHistory();
  return doc;
}
