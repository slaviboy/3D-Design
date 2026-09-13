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
import type { EdgeId, FaceId } from '../../../src/kernel/ids';
import { vec3 } from '../../../src/kernel/math/vec3';
import { addMaterial, setFaceAttributes } from '../../../src/kernel/model/mutations';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import type { CurveParams } from '../../../src/kernel/model/types';
import { DEFAULT_CIRCLE_SEGMENTS, insertCurve } from '../../../src/kernel/ops/curves';
import { deleteFaces, eraseEdges } from '../../../src/kernel/ops/erase';
import { insertSegments } from '../../../src/kernel/ops/insertSegments';
import { faceArea } from '../../../src/kernel/ops/planar/regions';
import { EPS_LEN } from '../../../src/kernel/tolerance';
import {
  areas,
  counts,
  draw,
  expectValid,
  faceIds,
  newDocument,
  orientationConsistent,
  polygon,
  rectangle,
  segment,
} from '../helpers';

const CIRCLE_IN_RECTANGLE: CurveParams & { kind: 'circle' } = {
  kind: 'circle',
  center: vec3(1, 0.5, 0),
  normal: vec3(0, 0, 1),
  xAxis: vec3(1, 0, 0),
  radius: 0.25,
  segments: DEFAULT_CIRCLE_SEGMENTS,
};

/** Rows A1–A22 of docs/BEHAVIOR_MATRIX.md (A20 is in hierarchy.test.ts). */
describe('behavior matrix A: edge insertion, auto-split, auto-face', () => {
  it('A1: a single line creates two vertices and one edge', () => {
    const doc = newDocument();
    draw(doc, [segment([0, 0, 0], [1, 0, 0])]);
    expect(counts(doc)).toEqual({ v: 2, e: 1, f: 0 });
  });

  it('A2: closing a square with four separate lines creates a back-side-up ground face', () => {
    const doc = newDocument();
    draw(doc, [segment([0, 0, 0], [1, 0, 0])]);
    draw(doc, [segment([1, 0, 0], [1, 1, 0])]);
    draw(doc, [segment([1, 1, 0], [0, 1, 0])]);
    expect(counts(doc).f).toBe(0);
    draw(doc, [segment([0, 1, 0], [0, 0, 0])]);
    const store = doc.rootStore;
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
    const faceId = faceIds(store)[0] as FaceId;
    expect(store.getFacePlane(faceId).normal.z).toBeCloseTo(-1);
    expect(faceArea(store, faceId)).toBeCloseTo(1);
  });

  it('A3: a rectangle creates four vertices, four edges and one face', () => {
    const doc = newDocument();
    const result = draw(doc, rectangle(0, 0, 2, 1));
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
    expect(result.createdFaces).toHaveLength(1);
    expect(result.segmentEdges.map((edges) => edges.length)).toEqual([1, 1, 1, 1]);
  });

  it('A4: a line between midpoints splits the face and keeps the original id and material', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    const original = faceIds(doc.rootStore)[0] as FaceId;
    const brick = doc.transact('Paint', () => {
      const id = addMaterial(doc, { name: 'Brick', color: { r: 0.6, g: 0.2, b: 0.1 }, opacity: 1 });
      setFaceAttributes(doc, doc.rootDefinitionId, original, { frontMaterialId: id });
      return id;
    });
    const result = draw(doc, [segment([1, 0, 0], [1, 1, 0])]);
    expect(counts(doc)).toEqual({ v: 6, e: 7, f: 2 });
    expect(result.splitFaces).toEqual([original]);
    expect(areas(doc.rootStore)).toEqual([expect.closeTo(1), expect.closeTo(1)]);
    for (const face of doc.rootStore.faces()) expect(face.attributes.frontMaterialId).toBe(brick);
  });

  it('A5: erasing the dividing line heals the faces but leaves the boundary edges split', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    const divider = draw(doc, [segment([1, 0, 0], [1, 1, 0])]).createdEdges;
    eraseEdges(doc, doc.rootDefinitionId, divider);
    expect(counts(doc)).toEqual({ v: 6, e: 6, f: 1 });
    expect(areas(doc.rootStore)).toEqual([expect.closeTo(2)]);
  });

  it('A6: erasing a boundary edge deletes the face', () => {
    const doc = newDocument();
    const { segmentEdges } = draw(doc, rectangle(0, 0, 2, 1));
    eraseEdges(doc, doc.rootDefinitionId, segmentEdges[0] ?? []);
    expect(counts(doc)).toEqual({ v: 4, e: 3, f: 0 });
  });

  it('A7: redrawing the erased edge re-creates the face', () => {
    const doc = newDocument();
    const { segmentEdges } = draw(doc, rectangle(0, 0, 2, 1));
    eraseEdges(doc, doc.rootDefinitionId, segmentEdges[0] ?? []);
    draw(doc, [segment([0, 0, 0], [2, 0, 0])]);
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
  });

  it('A8: a dangling line on a face stays loose and does not split the face', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    draw(doc, [segment([1, 0, 0], [1, 0.5, 0])]);
    expect(counts(doc)).toEqual({ v: 6, e: 6, f: 1 });
  });

  it('A9: a circle inside a face creates a hole plus an inner disc face', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    const circle = insertCurve(doc, doc.rootDefinitionId, CIRCLE_IN_RECTANGLE);
    expect(counts(doc)).toEqual({ v: 28, e: 28, f: 2 });
    expect(circle.curve).not.toBeNull();
    const store = doc.rootStore;
    expect([...store.faces()].map((face) => face.inners.length).sort()).toEqual([0, 1]);
    for (const face of store.faces()) expect(store.getFacePlane(face.id).normal.z).toBeCloseTo(-1);
  });

  it('A10: deleting the disc face leaves the hole', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    insertCurve(doc, doc.rootDefinitionId, CIRCLE_IN_RECTANGLE);
    const disc = [...doc.rootStore.faces()].find((face) => face.inners.length === 0);
    deleteFaces(doc, doc.rootDefinitionId, disc ? [disc.id] : []);
    expect(counts(doc)).toEqual({ v: 28, e: 28, f: 1 });
    expect([...doc.rootStore.faces()][0]?.inners).toHaveLength(1);
  });

  it('erasing one circle edge heals ring and disc and turns the circle into a polyline', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    const { curve, edges } = insertCurve(doc, doc.rootDefinitionId, CIRCLE_IN_RECTANGLE);
    eraseEdges(doc, doc.rootDefinitionId, [edges[5] as EdgeId]);
    expect(counts(doc)).toEqual({ v: 28, e: 27, f: 1 });
    expect(curve).not.toBeNull();
    const remaining = doc.rootStore.getCurve(curve as NonNullable<typeof curve>);
    expect(remaining.params.kind).toBe('polyline');
    expect(remaining.edges).toHaveLength(23);
  });

  it('A11: crossing lines split each other at the intersection', () => {
    const doc = newDocument();
    draw(doc, [segment([-1, 0, 0], [1, 0, 0])]);
    const result = draw(doc, [segment([0, -1, 0], [0, 1, 0])]);
    expect(counts(doc)).toEqual({ v: 5, e: 4, f: 0 });
    expect(result.segmentEdges[0]).toHaveLength(2);
  });

  it('A12: a collinear overlapping line merges with the existing edge', () => {
    const doc = newDocument();
    draw(doc, [segment([0, 0, 0], [2, 0, 0])]);
    const result = draw(doc, [segment([1, 0, 0], [3, 0, 0])]);
    expect(counts(doc)).toEqual({ v: 4, e: 3, f: 0 });
    expect(result.segmentEdges[0]).toHaveLength(2);
  });

  it('A13: a line identical to an existing edge is a no-op with no history entry', () => {
    const doc = newDocument();
    draw(doc, [segment([0, 0, 0], [2, 0, 0])]);
    const before = hashDocument(doc);
    const depth = doc.undoDepth;
    draw(doc, [segment([2, 0, 0], [0, 0, 0])]);
    expect(hashDocument(doc)).toBe(before);
    expect(doc.undoDepth).toBe(depth);
  });

  it('A14: a line shorter than the tolerance changes nothing', () => {
    const doc = newDocument();
    const result = draw(doc, [segment([0, 0, 0], [EPS_LEN / 10, 0, 0])]);
    expect(counts(doc)).toEqual({ v: 0, e: 0, f: 0 });
    expect(result.segmentEdges).toEqual([[]]);
    expect(doc.undoDepth).toBe(0);
  });

  it('A15: an endpoint within the tolerance of a vertex welds to it', () => {
    const doc = newDocument();
    draw(doc, [segment([0, 0, 0], [1, 0, 0])]);
    draw(doc, [segment([1 + EPS_LEN / 2, 0, 0], [1, 1, 0])]);
    expect(counts(doc)).toEqual({ v: 3, e: 2, f: 0 });
  });

  it('A16: a line ending on an edge interior splits that edge', () => {
    const doc = newDocument();
    draw(doc, [segment([0, 0, 0], [2, 0, 0])]);
    draw(doc, [segment([1, 1, 0], [1, 0, 0])]);
    expect(counts(doc)).toEqual({ v: 4, e: 3, f: 0 });
  });

  it('A17: adjacent rectangles share their common edge', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    draw(doc, rectangle(1, 0, 2, 1));
    expect(counts(doc)).toEqual({ v: 6, e: 7, f: 2 });
    expect([...doc.rootStore.edges()].filter((edge) => edge.faces.length === 2)).toHaveLength(1);
    expect(orientationConsistent(doc.rootStore)).toBe(true);
  });

  it('A18: a rectangle drawn around an existing face creates a ring face with a hole', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 2));
    const inner = faceIds(doc.rootStore)[0] as FaceId;
    draw(doc, rectangle(-1, -1, 3, 3));
    expect(counts(doc)).toEqual({ v: 8, e: 8, f: 2 });
    const ring = [...doc.rootStore.faces()].find((face) => face.id !== inner);
    expect(ring?.inners).toHaveLength(1);
    expect(doc.rootStore.getFace(inner).inners).toHaveLength(0);
    expect(areas(doc.rootStore)).toEqual([expect.closeTo(4), expect.closeTo(12)]);
  });

  it('A19: a vertical rectangle sharing a ground edge is oriented consistently', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    draw(doc, polygon([vec3(0, 0, 0), vec3(0, 1, 0), vec3(0, 1, 1), vec3(0, 0, 1)]));
    expect(counts(doc)).toEqual({ v: 6, e: 7, f: 2 });
    expect(orientationConsistent(doc.rootStore)).toBe(true);
  });

  it('A21: geometry 10 km from the origin behaves identically', () => {
    const doc = newDocument();
    const far = 10_000;
    draw(doc, rectangle(far, far, far + 2, far + 1));
    draw(doc, [segment([far + 1, far, 0], [far + 1, far + 1, 0])]);
    expect(counts(doc)).toEqual({ v: 6, e: 7, f: 2 });
    expectValid(doc);
  });

  it('A22: a 10 micron square still forms a face', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1e-5, 1e-5));
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
  });

  it('uses the orientation hint for a new face off the ground plane', () => {
    const doc = newDocument();
    const wall = polygon([vec3(0, 0, 1), vec3(1, 0, 1), vec3(1, 0, 2), vec3(0, 0, 2)]);
    insertSegments(doc, doc.rootDefinitionId, wall, { autoFace: true, orientationHint: vec3(0, -1, 0) });
    expect([...doc.rootStore.faces()][0]?.plane?.normal.y).toBeCloseTo(-1);
  });

  it('closing a loop in a tilted plane creates a planar face', () => {
    const doc = newDocument();
    draw(doc, polygon([vec3(0, 0, 0), vec3(2, 0, 1), vec3(2, 2, 1), vec3(0, 2, 0)]));
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
    expectValid(doc);
  });

  it('a line piercing a face out of plane does not split the face', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 2));
    draw(doc, [segment([1, 1, -1], [1, 1, 1])]);
    expect(counts(doc)).toEqual({ v: 6, e: 5, f: 1 });
  });

  it('two crossing lines on a face split it into four faces', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 2));
    draw(doc, [segment([1, 0, 0], [1, 2, 0]), segment([0, 1, 0], [2, 1, 0])]);
    expect(counts(doc)).toEqual({ v: 9, e: 12, f: 4 });
    expect(areas(doc.rootStore)).toEqual([
      expect.closeTo(1),
      expect.closeTo(1),
      expect.closeTo(1),
      expect.closeTo(1),
    ]);
  });
});
