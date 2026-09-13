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
import { vec3, AXIS_X, AXIS_Z } from '../../../src/kernel/math/vec3';
import type { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import { reverseFace } from '../../../src/kernel/model/mutations';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { insertCurve } from '../../../src/kernel/ops/curves';
import { pushPull } from '../../../src/kernel/ops/pushPull';
import { edgeFaceAngle, softenEdgesByAngle } from '../../../src/kernel/ops/soften';
import { draw, expectValid, faceIds, newDocument, polygon, rectangle, segment } from '../helpers';

const root = (doc: ModelDocument) => doc.rootDefinitionId;
const allEdges = (doc: ModelDocument): EdgeId[] => [...doc.rootStore.edges()].map((e) => e.id);
const softCount = (doc: ModelDocument) => [...doc.rootStore.edges()].filter((e) => e.attributes.soft).length;
const degrees = (d: number) => (d * Math.PI) / 180;

function unitBox(doc: ModelDocument): void {
  draw(doc, rectangle(0, 0, 1, 1));
  pushPull(doc, root(doc), faceIds(doc.rootStore)[0] as FaceId, -1);
}

/** Rows L1–L6 of docs/BEHAVIOR_MATRIX.md. */
describe('behavior matrix L: soften by angle', () => {
  it('L1: box edges (90°) soften only when the threshold reaches them', () => {
    const doc = newDocument();
    unitBox(doc);
    const options = { softenCoplanar: false, smooth: true };
    const depth = doc.undoDepth;
    expect(
      softenEdgesByAngle(doc, root(doc), allEdges(doc), { ...options, maxAngleRadians: degrees(30) }),
    ).toBe(0);
    expect(doc.undoDepth).toBe(depth);
    const before = hashDocument(doc);
    expect(
      softenEdgesByAngle(doc, root(doc), allEdges(doc), { ...options, maxAngleRadians: degrees(91) }),
    ).toBe(12);
    expect([...doc.rootStore.edges()].every((e) => e.attributes.soft && e.attributes.smooth)).toBe(true);
    expectValid(doc);
    doc.undo();
    expect(hashDocument(doc)).toBe(before);
  });

  it('L2: a cylinder keeps its side edges soft and its rims hard; a lower threshold unsoftens the sides', () => {
    const doc = newDocument();
    insertCurve(doc, root(doc), {
      kind: 'circle',
      center: vec3(0, 0, 0),
      normal: AXIS_Z,
      xAxis: AXIS_X,
      radius: 1,
      segments: 24,
    });
    pushPull(doc, root(doc), faceIds(doc.rootStore)[0] as FaceId, -1);
    expect(softCount(doc)).toBe(24);
    const edges = allEdges(doc);
    expect(
      softenEdgesByAngle(doc, root(doc), edges, {
        maxAngleRadians: degrees(20),
        softenCoplanar: false,
        smooth: true,
      }),
    ).toBe(0);
    expect(
      softenEdgesByAngle(doc, root(doc), edges, {
        maxAngleRadians: degrees(20),
        softenCoplanar: false,
        smooth: false,
      }),
    ).toBe(24);
    expect([...doc.rootStore.edges()].some((e) => e.attributes.smooth)).toBe(false);
    expect(
      softenEdgesByAngle(doc, root(doc), edges, {
        maxAngleRadians: degrees(10),
        softenCoplanar: false,
        smooth: true,
      }),
    ).toBe(24);
    expect(softCount(doc)).toBe(0);
  });

  it('L3: coplanar faces are softened only with softenCoplanar', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    draw(doc, [segment([1, 0, 0], [1, 1, 0])]);
    const divider = allEdges(doc).find((id) => doc.rootStore.getEdge(id).faces.length === 2) as EdgeId;
    expect(edgeFaceAngle(doc.rootStore, divider)).toEqual({ angle: expect.closeTo(0, 12), coplanar: true });
    const options = { maxAngleRadians: degrees(45), smooth: true };
    expect(softenEdgesByAngle(doc, root(doc), [divider], { ...options, softenCoplanar: false })).toBe(0);
    expect(softenEdgesByAngle(doc, root(doc), [divider], { ...options, softenCoplanar: true })).toBe(1);
    expect(doc.rootStore.getEdge(divider).attributes).toMatchObject({ soft: true, smooth: true });
    expect(softenEdgesByAngle(doc, root(doc), [divider], { ...options, softenCoplanar: false })).toBe(1);
    expect(doc.rootStore.getEdge(divider).attributes.soft).toBe(false);
  });

  it('L4: edges without exactly two faces are left unsoftened', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    draw(doc, [segment([3, 0, 0], [4, 0, 0])]);
    const edges = allEdges(doc);
    expect(edges.every((id) => edgeFaceAngle(doc.rootStore, id) === null)).toBe(true);
    expect(
      softenEdgesByAngle(doc, root(doc), edges, {
        maxAngleRadians: Math.PI,
        softenCoplanar: true,
        smooth: true,
      }),
    ).toBe(0);
    expect(softCount(doc)).toBe(0);
  });

  it('L5: the fold angle ignores whether the two faces are consistently oriented', () => {
    const doc = newDocument();
    draw(doc, polygon([vec3(0, 0, 0), vec3(0, 1, 0), vec3(0, 0.5, 1)]));
    pushPull(doc, root(doc), faceIds(doc.rootStore)[0] as FaceId, 1);
    const store = doc.rootStore;
    // A ridge edge along x at the top of the prism: its two sloped faces meet with normals 126.87° apart.
    const ridge = allEdges(doc).find((id) => {
      const e = store.getEdge(id);
      return store.position(e.v0).z === 1 && store.position(e.v1).z === 1;
    }) as EdgeId;
    const consistent = edgeFaceAngle(store, ridge);
    const expected = Math.PI - 2 * Math.atan(0.5);
    expect(consistent?.angle).toBeCloseTo(expected, 12);
    doc.transact('Flip', () => {
      reverseFace(doc, root(doc), store.getEdge(ridge).faces[0] as FaceId);
    });
    expect(edgeFaceAngle(store, ridge)?.angle).toBeCloseTo(expected, 12);
    expect(
      softenEdgesByAngle(doc, root(doc), [ridge], {
        maxAngleRadians: degrees(90),
        softenCoplanar: false,
        smooth: true,
      }),
    ).toBe(0);
    expect(
      softenEdgesByAngle(doc, root(doc), [ridge], {
        maxAngleRadians: degrees(130),
        softenCoplanar: false,
        smooth: true,
      }),
    ).toBe(1);
  });

  it('L6: invalid thresholds are refused', () => {
    const doc = newDocument();
    unitBox(doc);
    for (const maxAngleRadians of [-0.1, Number.NaN, 4]) {
      expect(() =>
        softenEdgesByAngle(doc, root(doc), allEdges(doc), {
          maxAngleRadians,
          softenCoplanar: false,
          smooth: true,
        }),
      ).toThrow(KernelError);
    }
  });
});
