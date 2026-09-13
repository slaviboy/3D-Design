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

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { KernelError, KernelInvariantError } from '../../src/kernel/errors';
import { translation } from '../../src/kernel/math/mat4';
import { vec3 } from '../../src/kernel/math/vec3';
import { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { setInstanceTransform } from '../../src/kernel/model/mutations';
import { createSnapshot, hashDocument, restoreSnapshot } from '../../src/kernel/model/snapshot';
import { validateDocument } from '../../src/kernel/model/validate';
import { divideEdge } from '../../src/kernel/ops/curveEdit';
import { insertCurve } from '../../src/kernel/ops/curves';
import { deleteFaces, eraseEdges } from '../../src/kernel/ops/erase';
import { explodeInstance, makeGroup } from '../../src/kernel/ops/hierarchy';
import { insertSegments } from '../../src/kernel/ops/insertSegments';
import { offsetFace } from '../../src/kernel/ops/offset';
import { softenEdgesByAngle } from '../../src/kernel/ops/soften';
import { polygon, rectangle } from './helpers';

/**
 * Property-based fuzzing of the modeling kernel. Random operation sequences on a small integer grid produce many
 * coincident, collinear, crossing and coplanar situations. After every step the document must satisfy all
 * invariants. Undoing everything must return the empty document, redoing must return the final document, and a
 * snapshot round trip must preserve it exactly.
 *
 * `FUZZ_RUNS` and `FUZZ_SEED` environment variables select a deeper or different run.
 */
const RUNS = Number(process.env.FUZZ_RUNS ?? 40);
const SEED = Number(process.env.FUZZ_SEED ?? 20260913);
const MAX_OPERATIONS = 18;

type Point = readonly [number, number, number];
type Operation =
  | { readonly kind: 'line'; readonly a: Point; readonly b: Point }
  | {
      readonly kind: 'rectangle';
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly z: number;
    }
  | { readonly kind: 'wall'; readonly x: number; readonly y0: number; readonly y1: number }
  | {
      readonly kind: 'circle';
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly radius: number;
      readonly segments: number;
    }
  | { readonly kind: 'erase'; readonly pick: number }
  | { readonly kind: 'deleteFace'; readonly pick: number }
  | { readonly kind: 'group'; readonly pick: number }
  | { readonly kind: 'moveInstance'; readonly pick: number; readonly dx: number; readonly dy: number }
  | { readonly kind: 'explode'; readonly pick: number }
  | { readonly kind: 'offset'; readonly pick: number; readonly distance: number }
  | { readonly kind: 'divide'; readonly pick: number; readonly segments: number }
  | { readonly kind: 'soften'; readonly degrees: number }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' };

const coordinate = fc.integer({ min: 0, max: 4 });
const height = fc.constantFrom(0, 1);
const pick = fc.nat({ max: 1000 });

const operation: fc.Arbitrary<Operation> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('line' as const),
      a: fc.tuple(coordinate, coordinate, height),
      b: fc.tuple(coordinate, coordinate, height),
    }),
  },
  {
    weight: 4,
    arbitrary: fc
      .record({
        kind: fc.constant('rectangle' as const),
        x0: coordinate,
        y0: coordinate,
        x1: coordinate,
        y1: coordinate,
        z: height,
      })
      .filter((r) => r.x0 !== r.x1 && r.y0 !== r.y1),
  },
  {
    weight: 2,
    arbitrary: fc
      .record({ kind: fc.constant('wall' as const), x: coordinate, y0: coordinate, y1: coordinate })
      .filter((w) => w.y0 !== w.y1),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('circle' as const),
      x: coordinate,
      y: coordinate,
      z: height,
      radius: fc.constantFrom(0.5, 1, 1.5),
      segments: fc.constantFrom(5, 8),
    }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('erase' as const), pick }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('deleteFace' as const), pick }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('group' as const), pick }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('moveInstance' as const),
      pick,
      dx: fc.integer({ min: -2, max: 2 }),
      dy: fc.integer({ min: -2, max: 2 }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('explode' as const), pick }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('offset' as const),
      pick,
      distance: fc.constantFrom(-0.5, -0.25, 0.25, 0.5),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant('divide' as const), pick, segments: fc.constantFrom(2, 3) }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant('soften' as const), degrees: fc.constantFrom(0, 45, 100) }),
  },
  { weight: 2, arbitrary: fc.constant({ kind: 'undo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'redo' as const }) },
);

function nth<T>(items: readonly T[], index: number): T | undefined {
  return items.length === 0 ? undefined : items[index % items.length];
}

/** Runs an operation that may legitimately refuse. Refusals must still be clean: invariant violations fail the run. */
function refusable(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof KernelInvariantError || !(error instanceof KernelError)) throw error;
  }
}

function run(doc: ModelDocument, op: Operation): void {
  const root = doc.rootDefinitionId;
  const store = doc.rootStore;
  switch (op.kind) {
    case 'line':
      insertSegments(doc, root, [{ a: vec3(...op.a), b: vec3(...op.b) }], { autoFace: true });
      return;
    case 'rectangle':
      insertSegments(doc, root, rectangle(op.x0, op.y0, op.x1, op.y1, op.z), { autoFace: true });
      return;
    case 'wall':
      insertSegments(
        doc,
        root,
        polygon([vec3(op.x, op.y0, 0), vec3(op.x, op.y1, 0), vec3(op.x, op.y1, 1), vec3(op.x, op.y0, 1)]),
        { autoFace: true },
      );
      return;
    case 'circle':
      insertCurve(doc, root, {
        kind: 'circle',
        center: vec3(op.x, op.y, op.z),
        normal: vec3(0, 0, 1),
        xAxis: vec3(1, 0, 0),
        radius: op.radius,
        segments: op.segments,
      });
      return;
    case 'erase': {
      const edge = nth(
        [...store.edges()].map((e) => e.id).sort((a, b) => a - b),
        op.pick,
      );
      if (edge !== undefined) eraseEdges(doc, root, [edge]);
      return;
    }
    case 'deleteFace': {
      const face = nth(
        [...store.faces()].map((f) => f.id).sort((a, b) => a - b),
        op.pick,
      );
      if (face !== undefined) deleteFaces(doc, root, [face]);
      return;
    }
    case 'group': {
      const face = nth(
        [...store.faces()].map((f) => f.id).sort((a, b) => a - b),
        op.pick,
      );
      if (face !== undefined) makeGroup(doc, root, { faces: [face] });
      return;
    }
    case 'moveInstance': {
      const instance = nth(
        [...store.instances()].map((i) => i.id).sort((a, b) => a - b),
        op.pick,
      );
      if (instance === undefined) return;
      doc.transact('Move', () => {
        setInstanceTransform(doc, root, instance, translation(vec3(op.dx, op.dy, 0)));
      });
      return;
    }
    case 'explode': {
      const instance = nth(
        [...store.instances()].map((i) => i.id).sort((a, b) => a - b),
        op.pick,
      );
      if (instance !== undefined) explodeInstance(doc, root, instance);
      return;
    }
    case 'offset': {
      const face = nth(
        [...store.faces()].map((f) => f.id).sort((a, b) => a - b),
        op.pick,
      );
      if (face !== undefined) refusable(() => offsetFace(doc, root, face, op.distance));
      return;
    }
    case 'divide': {
      const edge = nth(
        [...store.edges()].map((e) => e.id).sort((a, b) => a - b),
        op.pick,
      );
      if (edge !== undefined) refusable(() => divideEdge(doc, root, edge, op.segments));
      return;
    }
    case 'soften':
      softenEdgesByAngle(
        doc,
        root,
        [...store.edges()].map((e) => e.id),
        { maxAngleRadians: (op.degrees * Math.PI) / 180, softenCoplanar: false, smooth: true },
      );
      return;
    case 'undo':
      doc.undo();
      return;
    case 'redo':
      doc.redo();
      return;
  }
}

describe('kernel fuzzing', () => {
  it('keeps invariants, undo/redo identity and snapshot fidelity for random operation sequences', () => {
    fc.assert(
      fc.property(fc.array(operation, { maxLength: MAX_OPERATIONS }), (operations) => {
        const doc = new ModelDocument({ validateOnCommit: true });
        const emptyHash = hashDocument(doc);
        for (const op of operations) {
          run(doc, op);
          if (op.kind === 'undo' || op.kind === 'redo') {
            expect(validateDocument(doc).problems).toEqual([]);
          }
        }
        const finalHash = hashDocument(doc);
        const depth = doc.undoDepth;

        const restored = restoreSnapshot(createSnapshot(doc));
        expect(restored.ok ? hashDocument(restored.value) : restored.error).toBe(finalHash);

        while (doc.undo()) {
          /* undo everything */
        }
        expect(hashDocument(doc)).toBe(emptyHash);
        for (let i = 0; i < depth; i++) doc.redo();
        expect(hashDocument(doc)).toBe(finalHash);
        expect(validateDocument(doc).problems).toEqual([]);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  }, 120_000);
});
