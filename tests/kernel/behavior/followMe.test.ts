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
import { addCurve } from '../../../src/kernel/model/mutations';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { curvePoints } from '../../../src/kernel/ops/curves';
import { followMe } from '../../../src/kernel/ops/followMe';
import { insertSegments } from '../../../src/kernel/ops/insertSegments';
import { isSolid, solidVolume } from '../../../src/kernel/ops/solids/solid';
import { counts, draw, expectValid, faceIds, newDocument, orientationConsistent, polygon } from '../helpers';

/** Draws loose edges through the points (no faces), optionally as one curve. Returns the edges in order. */
function path(doc: ModelDocument, points: readonly Vec3[], closed: boolean, curve = false): EdgeId[] {
  const root = doc.rootDefinitionId;
  return doc.transact('path', () => {
    const segments = closed
      ? polygon(points)
      : points.slice(0, -1).map((a, i) => ({ a, b: points[i + 1] ?? a }));
    const result = insertSegments(doc, root, segments, { autoFace: false });
    const edges = result.segmentEdges.flat();
    if (curve) addCurve(doc, root, { kind: 'polyline' }, edges);
    return edges;
  });
}

function onlyFace(doc: ModelDocument): FaceId {
  const [face] = faceIds(doc.rootStore);
  if (face === undefined) throw new Error('no face');
  return face;
}

const circle = (center: Vec3, normal: Vec3, xAxis: Vec3, radius: number, segments: number): Vec3[] =>
  curvePoints({ kind: 'circle', center, normal, xAxis, radius, segments }).points;

/** Rows L1–L6 of docs/BEHAVIOR_MATRIX.md. */
describe('behavior matrix L: Follow Me', () => {
  it('L1: a square profile along an L-shaped path makes a mitred bar with caps', () => {
    const doc = newDocument();
    draw(doc, polygon([vec3(0, -0.5, 0.5), vec3(0, 0.5, 0.5), vec3(0, 0.5, 1.5), vec3(0, -0.5, 1.5)]));
    const profile = onlyFace(doc);
    const edges = path(doc, [vec3(0, 0, 0), vec3(5, 0, 0), vec3(5, 5, 0)], false);
    const result = followMe(doc, doc.rootDefinitionId, profile, [...edges].reverse());
    expect(counts(doc)).toEqual({ v: 15, e: 22, f: 10 });
    expect(result.faces).toHaveLength(10);
    expect(result.faces).toContain(profile);
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    expect(solidVolume(doc.rootStore)).toBeCloseTo(10, 9);
    expectValid(doc);
  });

  it('L2: a circle profile along a closed rectangle makes a closed ring', () => {
    const doc = newDocument();
    const root = doc.rootDefinitionId;
    draw(doc, polygon(circle(vec3(2, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), 0.25, 24)));
    const profile = onlyFace(doc);
    // The path passes through the profile's center, where the profile sits on a straight run of the path.
    const corners = [vec3(0, 0, 0), vec3(2, 0, 0), vec3(4, 0, 0), vec3(4, 3, 0), vec3(0, 3, 0)];
    const edges = path(doc, corners, true);
    followMe(doc, root, profile, edges);
    expect(counts(doc)).toEqual({ v: 125, e: 245, f: 120 });
    expect(doc.rootStore.face(profile)).toBeUndefined();
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    const area = 0.5 * 24 * 0.25 * 0.25 * Math.sin((2 * Math.PI) / 24);
    expect(solidVolume(doc.rootStore)).toBeCloseTo(area * 14, 9);
    expectValid(doc);
  });

  it('L3: a rectangle swept around a circle is a closed, valid lathe with soft rings', () => {
    const doc = newDocument();
    const root = doc.rootDefinitionId;
    draw(doc, polygon([vec3(1, 0, 0), vec3(2, 0, 0), vec3(2, 0, 1), vec3(1, 0, 1)]));
    const profile = onlyFace(doc);
    const edges = path(doc, circle(vec3(0, 0, 0), vec3(0, 0, 1), vec3(1, 0, 0), 1, 24), true, true);
    followMe(doc, root, profile, edges);
    expect(counts(doc)).toEqual({ v: 96, e: 192, f: 96 });
    expect(isSolid(doc.rootStore)).toBe(true);
    expect(Math.abs(solidVolume(doc.rootStore))).toBeGreaterThan(0);
    expect(solidVolume(doc.rootStore)).toBeGreaterThan(0);
    const softEdges = [...doc.rootStore.edges()].filter(
      (edge) => edge.attributes.soft && edge.attributes.smooth,
    );
    expect(softEdges).toHaveLength(96);
    expectValid(doc);
  });

  it('L4: undo restores the model exactly', () => {
    const doc = newDocument();
    draw(doc, polygon([vec3(0, -0.5, 0.5), vec3(0, 0.5, 0.5), vec3(0, 0.5, 1.5), vec3(0, -0.5, 1.5)]));
    const profile = onlyFace(doc);
    const edges = path(doc, [vec3(0, 0, 0), vec3(5, 0, 0)], false);
    const before = hashDocument(doc);
    followMe(doc, doc.rootDefinitionId, profile, edges);
    expect(counts(doc)).toEqual({ v: 10, e: 13, f: 6 });
    doc.undo();
    expect(hashDocument(doc)).toBe(before);
  });

  it('L5: refuses a disconnected or branching path and leaves the model unchanged', () => {
    const doc = newDocument();
    const root = doc.rootDefinitionId;
    draw(doc, polygon([vec3(0, -0.5, 0.5), vec3(0, 0.5, 0.5), vec3(0, 0.5, 1.5), vec3(0, -0.5, 1.5)]));
    const profile = onlyFace(doc);
    const first = path(doc, [vec3(0, 0, 0), vec3(5, 0, 0)], false);
    const second = path(doc, [vec3(7, 0, 0), vec3(9, 0, 0)], false);
    const branch = path(doc, [vec3(5, 0, 0), vec3(5, 3, 0)], false);
    const tail = path(doc, [vec3(5, 0, 0), vec3(5, -3, 0)], false);
    const before = hashDocument(doc);
    const depth = doc.undoDepth;
    expect(() => followMe(doc, root, profile, [...first, ...second])).toThrow(KernelError);
    expect(() => followMe(doc, root, profile, [...first, ...branch, ...tail])).toThrow(/branches/);
    expect(hashDocument(doc)).toBe(before);
    expect(doc.undoDepth).toBe(depth);
  });

  it('L6: refuses a profile whose plane is parallel to the path at the start', () => {
    const doc = newDocument();
    const root = doc.rootDefinitionId;
    draw(doc, polygon([vec3(0, 0, 1), vec3(1, 0, 1), vec3(1, 1, 1), vec3(0, 1, 1)]));
    const profile = onlyFace(doc);
    const edges = path(doc, [vec3(0, 0, 0), vec3(5, 0, 0)], false);
    const before = hashDocument(doc);
    expect(() => followMe(doc, root, profile, edges)).toThrow(/parallel/);
    expect(() => followMe(doc, root, profile, [])).toThrow(KernelError);
    expect(hashDocument(doc)).toBe(before);
  });
});
