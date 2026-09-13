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

import { describe, expect, it } from 'vitest';
import { KernelError } from '../../../src/kernel/errors';
import type { EdgeId, FaceId } from '../../../src/kernel/ids';
import { vec3, type Vec3 } from '../../../src/kernel/math/vec3';
import type { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { insertCurve } from '../../../src/kernel/ops/curves';
import { offsetEdges, offsetFace } from '../../../src/kernel/ops/offset';
import { faceArea } from '../../../src/kernel/ops/planar/regions';
import {
  areas,
  counts,
  draw,
  expectValid,
  faceIds,
  newDocument,
  polygon,
  rectangle,
  segment,
} from '../helpers';

const root = (doc: ModelDocument) => doc.rootDefinitionId;
const UP = vec3(0, 0, 1);
const DOWN = vec3(0, 0, -1);

function onlyFace(doc: ModelDocument): FaceId {
  const [face, ...rest] = faceIds(doc.rootStore);
  if (face === undefined || rest.length > 0) throw new Error('expected exactly one face');
  return face;
}

function hasVertexAt(doc: ModelDocument, p: Vec3, tolerance = 1e-9): boolean {
  return [...doc.rootStore.vertices()].some(
    (v) => Math.hypot(v.position.x - p.x, v.position.y - p.y, v.position.z - p.z) < tolerance,
  );
}

function edgeBetween(doc: ModelDocument, a: Vec3, b: Vec3): EdgeId {
  const store = doc.rootStore;
  const near = (p: Vec3, q: Vec3) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-9;
  const edge = [...store.edges()].find((e) => {
    const p = store.position(e.v0);
    const q = store.position(e.v1);
    return (near(p, a) && near(q, b)) || (near(p, b) && near(q, a));
  });
  if (!edge) throw new Error('edge not found');
  return edge.id;
}

function circleFace(doc: ModelDocument, radius: number, segments = 24): FaceId {
  insertCurve(doc, root(doc), {
    kind: 'circle',
    center: vec3(0, 0, 0),
    normal: UP,
    xAxis: vec3(1, 0, 0),
    radius,
    segments,
  });
  return onlyFace(doc);
}

/** Rows E1–E10 of docs/BEHAVIOR_MATRIX.md. */
describe('behavior matrix E: Offset', () => {
  it('E1: an inward offset splits a rectangle into a ring and an inner face', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 2));
    const face = onlyFace(doc);
    const before = hashDocument(doc);
    const result = offsetFace(doc, root(doc), face, 0.25);
    expect(counts(doc)).toEqual({ v: 8, e: 8, f: 2 });
    expect(areas(doc.rootStore)).toEqual([expect.closeTo(1.75, 9), expect.closeTo(2.25, 9)]);
    expect(result.edges).toHaveLength(4);
    expect(result.faces).toHaveLength(1);
    expect(hasVertexAt(doc, vec3(0.25, 0.25, 0))).toBe(true);
    for (const id of faceIds(doc.rootStore)) expect(doc.rootStore.getFacePlane(id).normal.z).toBeCloseTo(-1);
    expectValid(doc);
    const after = hashDocument(doc);
    doc.undo();
    expect(hashDocument(doc)).toBe(before);
    doc.redo();
    expect(hashDocument(doc)).toBe(after);
  });

  it('E2: an outward offset adds a ring face around the original', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 2));
    const face = onlyFace(doc);
    const result = offsetFace(doc, root(doc), face, -0.25);
    expect(counts(doc)).toEqual({ v: 8, e: 8, f: 2 });
    expect(areas(doc.rootStore)).toEqual([expect.closeTo(2.25, 9), expect.closeTo(4, 9)]);
    const [ring] = result.faces;
    expect(doc.rootStore.getFace(ring as FaceId).inners).toHaveLength(1);
    expect(doc.rootStore.getFacePlane(ring as FaceId).normal.z).toBeCloseTo(-1);
    expect(hasVertexAt(doc, vec3(-0.25, 2.25, 0))).toBe(true);
    expectValid(doc);
  });

  /** A 3×3 body with a 3×1 arm: an inward offset of 0.75 swallows the arm (half-width 0.5). */
  const lShape = () =>
    polygon([vec3(0, 0, 0), vec3(6, 0, 0), vec3(6, 1, 0), vec3(3, 1, 0), vec3(3, 3, 0), vec3(0, 3, 0)]);

  it('E3: overlaps of an inward offset past a narrow arm are removed', () => {
    const doc = newDocument();
    draw(doc, lShape());
    offsetFace(doc, root(doc), onlyFace(doc), 0.75);
    expect(counts(doc)).toEqual({ v: 10, e: 10, f: 2 });
    expect(areas(doc.rootStore)).toEqual([expect.closeTo(2.25, 9), expect.closeTo(9.75, 9)]);
    expect(hasVertexAt(doc, vec3(2.25, 2.25, 0))).toBe(true);
    expect(hasVertexAt(doc, vec3(5.25, 0.25, 0))).toBe(false);
    expectValid(doc);
  });

  it('E3 (Alt): keeping overlaps inserts the self-crossing loop as drawn', () => {
    const doc = newDocument();
    draw(doc, lShape());
    offsetFace(doc, root(doc), onlyFace(doc), 0.75, { keepOverlaps: true });
    // 6 offset corners + 1 crossing; the crossing splits two offset segments; the loop cuts off a tail region.
    expect(counts(doc)).toEqual({ v: 13, e: 14, f: 3 });
    expect(hasVertexAt(doc, vec3(5.25, 0.25, 0))).toBe(true);
    expectValid(doc);
  });

  it('E4: offsetting a circle face keeps a circle curve with the smaller radius', () => {
    const doc = newDocument();
    const disc = circleFace(doc, 1);
    const result = offsetFace(doc, root(doc), disc, 0.1);
    expect(counts(doc)).toEqual({ v: 48, e: 48, f: 2 });
    expect(doc.rootStore.curveCount).toBe(2);
    const curve = doc.rootStore.getCurve(doc.rootStore.getEdge(result.edges[0] as EdgeId).curve as never);
    expect(curve.params).toMatchObject({ kind: 'circle', radius: expect.closeTo(0.9, 12), segments: 24 });
    expect(curve.edges).toHaveLength(24);
    for (const vertex of doc.rootStore.vertices()) {
      expect(
        [1, 0.9].some((r) => Math.abs(Math.hypot(vertex.position.x, vertex.position.y) - r) < 1e-9),
      ).toBe(true);
    }
    expectValid(doc);
  });

  it('E5: holes grow with an inward offset, and their circles stay circles', () => {
    const doc = newDocument();
    draw(doc, rectangle(-1, -1, 1, 1));
    insertCurve(doc, root(doc), {
      kind: 'circle',
      center: vec3(0, 0, 0),
      normal: UP,
      xAxis: vec3(1, 0, 0),
      radius: 0.25,
      segments: 12,
    });
    const ring = faceIds(doc.rootStore).find((id) => doc.rootStore.getFace(id).inners.length === 1) as FaceId;
    offsetFace(doc, root(doc), ring, 0.1);
    // Outer square 4 + 4, hole circle 12 + 12 → 4 faces: outer ring, middle ring, hole ring, disc.
    expect(counts(doc)).toEqual({ v: 32, e: 32, f: 4 });
    const radii = [...doc.rootStore.curves()]
      .map((c) => (c.params.kind === 'circle' ? c.params.radius : 0))
      .sort();
    expect(radii).toEqual([expect.closeTo(0.25, 12), expect.closeTo(0.35, 12)]);
    expectValid(doc);
  });

  it('E6: an arc meeting a straight edge at a corner is mitered and becomes a polyline', () => {
    const doc = newDocument();
    insertCurve(doc, root(doc), {
      kind: 'arc',
      center: vec3(0, 0, 0),
      normal: UP,
      xAxis: vec3(1, 0, 0),
      radius: 1,
      startAngle: 0,
      endAngle: Math.PI,
      segments: 12,
    });
    draw(doc, [segment([-1, 0, 0], [1, 0, 0])]);
    offsetFace(doc, root(doc), onlyFace(doc), 0.1);
    expect(counts(doc)).toEqual({ v: 26, e: 26, f: 2 });
    const kinds = [...doc.rootStore.curves()].map((c) => c.params.kind).sort();
    expect(kinds).toEqual(['arc', 'polyline']);
    expectValid(doc);
  });

  it('E7: an inward offset larger than the inradius is refused and changes nothing', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 2));
    const face = onlyFace(doc);
    const before = hashDocument(doc);
    const depth = doc.undoDepth;
    // Past the center a convex loop is point-reflected: it keeps its winding, so clearance must catch it.
    expect(() => offsetFace(doc, root(doc), face, 1.5)).toThrow(KernelError);
    expect(() => offsetFace(doc, root(doc), face, 1.5, { keepOverlaps: true })).toThrow(KernelError);
    expect(() => offsetFace(doc, root(doc), face, 1)).toThrow(KernelError);
    expect(() => offsetFace(doc, root(doc), face, 0)).toThrow(KernelError);
    expect(() => offsetFace(doc, root(doc), face, Number.NaN)).toThrow(KernelError);
    const disc = newDocument();
    const circle = circleFace(disc, 0.5);
    expect(() => offsetFace(disc, root(disc), circle, 0.6)).toThrow(KernelError);
    expect(hashDocument(doc)).toBe(before);
    expect(doc.undoDepth).toBe(depth);
  });

  it('E7: a hole growing past the shrinking outline leaves nothing and is refused', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 2));
    draw(doc, rectangle(0.8, 0.8, 1.2, 1.2));
    const ring = faceIds(doc.rootStore).find((id) => doc.rootStore.getFace(id).inners.length === 1) as FaceId;
    const before = hashDocument(doc);
    expect(() => offsetFace(doc, root(doc), ring, 0.5)).toThrow(KernelError);
    expect(hashDocument(doc)).toBe(before);
  });

  it('E8: an open chain offsets to the left of its direction, looking against the normal', () => {
    const doc = newDocument();
    draw(doc, [segment([0, 0, 0], [2, 0, 0]), segment([2, 0, 0], [2, 2, 0])]);
    const first = edgeBetween(doc, vec3(0, 0, 0), vec3(2, 0, 0));
    const second = edgeBetween(doc, vec3(2, 0, 0), vec3(2, 2, 0));
    const result = offsetEdges(doc, root(doc), [first, second], 0.5, UP);
    expect(counts(doc)).toEqual({ v: 6, e: 4, f: 0 });
    expect(result.edges).toHaveLength(2);
    expect(hasVertexAt(doc, vec3(1.5, 0.5, 0))).toBe(true);
    expect(hasVertexAt(doc, vec3(0, 0.5, 0))).toBe(true);
    doc.undo();
    offsetEdges(doc, root(doc), [second, first], 0.5, DOWN);
    // Walking the second edge first reverses nothing about its direction (it still runs from its v0), and the
    // flipped normal mirrors "left": the offset lands on the other side.
    expect(hasVertexAt(doc, vec3(2.5, -0.5, 0))).toBe(true);
    expectValid(doc);
  });

  it('E9: open-chain overlaps are trimmed where the offset comes too close to the chain', () => {
    const doc = newDocument();
    // A hook: the offset of the long edge would pass within 0.4 of the short return edge.
    draw(doc, [segment([0, 0, 0], [4, 0, 0]), segment([4, 0, 0], [4, 1, 0]), segment([4, 1, 0], [3, 1, 0])]);
    const edges = [
      edgeBetween(doc, vec3(0, 0, 0), vec3(4, 0, 0)),
      edgeBetween(doc, vec3(4, 0, 0), vec3(4, 1, 0)),
      edgeBetween(doc, vec3(4, 1, 0), vec3(3, 1, 0)),
    ];
    offsetEdges(doc, root(doc), edges, 0.6, UP);
    expect(counts(doc)).toEqual({ v: 6, e: 4, f: 0 });
    expect(hasVertexAt(doc, vec3(0, 0.6, 0))).toBe(true);
    // Trimmed where it enters the 0.6 band around the return edge's end (3, 1); cuts sit EPS_LEN inside the band.
    expect(hasVertexAt(doc, vec3(3 - Math.sqrt(0.6 * 0.6 - 0.4 * 0.4), 0.6, 0), 1e-5)).toBe(true);
    expectValid(doc);

    const u = newDocument();
    draw(u, [segment([0, 2, 0], [0, 0, 0]), segment([0, 0, 0], [1, 0, 0]), segment([1, 0, 0], [1, 2, 0])]);
    const uEdges = [...u.rootStore.edges()].map((e) => e.id);
    const before = hashDocument(u);
    expect(() => offsetEdges(u, root(u), uEdges, 0.8, UP)).toThrow(KernelError);
    expect(hashDocument(u)).toBe(before);
  });

  it('E10: a closed chain offsets inward or outward depending on the normal', () => {
    const inward = newDocument();
    draw(inward, rectangle(0, 0, 2, 2));
    const loop = [...inward.rootStore.edges()].map((e) => e.id).sort((a, b) => a - b);
    offsetEdges(inward, root(inward), loop, 0.25, UP);
    expect(areas(inward.rootStore)).toEqual([expect.closeTo(1.75, 9), expect.closeTo(2.25, 9)]);

    const outward = newDocument();
    draw(outward, rectangle(0, 0, 2, 2));
    const loop2 = [...outward.rootStore.edges()].map((e) => e.id).sort((a, b) => a - b);
    offsetEdges(outward, root(outward), loop2, 0.25, DOWN);
    expect(areas(outward.rootStore)).toEqual([expect.closeTo(2.25, 9), expect.closeTo(4, 9)]);
    expectValid(inward);
    expectValid(outward);
  });

  it('refuses non-coplanar, branching and disconnected edges', () => {
    const doc = newDocument();
    draw(doc, [segment([0, 0, 0], [1, 0, 0]), segment([1, 0, 0], [1, 0, 1])]);
    draw(doc, [segment([5, 0, 0], [6, 0, 0])]);
    draw(doc, [segment([1, 0, 0], [1, 1, 0])]);
    const bent = [
      edgeBetween(doc, vec3(0, 0, 0), vec3(1, 0, 0)),
      edgeBetween(doc, vec3(1, 0, 0), vec3(1, 0, 1)),
    ];
    const apart = [
      edgeBetween(doc, vec3(0, 0, 0), vec3(1, 0, 0)),
      edgeBetween(doc, vec3(5, 0, 0), vec3(6, 0, 0)),
    ];
    const branching = [...bent, edgeBetween(doc, vec3(1, 0, 0), vec3(1, 1, 0))];
    const before = hashDocument(doc);
    expect(() => offsetEdges(doc, root(doc), bent, 0.1, UP)).toThrow(KernelError);
    expect(() => offsetEdges(doc, root(doc), apart, 0.1, UP)).toThrow(KernelError);
    expect(() => offsetEdges(doc, root(doc), branching, 0.1, UP)).toThrow(KernelError);
    expect(() => offsetEdges(doc, root(doc), [], 0.1, UP)).toThrow(KernelError);
    expect(() => offsetEdges(doc, root(doc), apart.slice(0, 1), 0.1, vec3(0, 0, 0))).toThrow(KernelError);
    expect(hashDocument(doc)).toBe(before);
  });

  it('offsets a face that lies on a tilted plane', () => {
    const doc = newDocument();
    draw(doc, polygon([vec3(0, 0, 0), vec3(2, 0, 0), vec3(2, 2, 2), vec3(0, 2, 2)]));
    const face = onlyFace(doc);
    const area = faceArea(doc.rootStore, face);
    offsetFace(doc, root(doc), face, 0.2);
    expect(counts(doc)).toEqual({ v: 8, e: 8, f: 2 });
    const total = faceIds(doc.rootStore).reduce((sum, id) => sum + faceArea(doc.rootStore, id), 0);
    expect(total).toBeCloseTo(area, 9);
    expectValid(doc);
  });
});
