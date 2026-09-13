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
import type { CurveId, EdgeId, FaceId } from '../../../src/kernel/ids';
import { distance, vec3, AXIS_X, AXIS_Z } from '../../../src/kernel/math/vec3';
import type { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { divideEdge, explodeCurve, weldEdges } from '../../../src/kernel/ops/curveEdit';
import { insertCurve, MAX_CURVE_SEGMENTS } from '../../../src/kernel/ops/curves';
import { faceArea } from '../../../src/kernel/ops/planar/regions';
import { pushPull } from '../../../src/kernel/ops/pushPull';
import { counts, draw, expectValid, faceIds, newDocument, rectangle, segment } from '../helpers';

const root = (doc: ModelDocument) => doc.rootDefinitionId;
const allEdges = (doc: ModelDocument): EdgeId[] =>
  [...doc.rootStore.edges()].map((e) => e.id).sort((a, b) => a - b);

function circle(doc: ModelDocument, radius: number, segments: number) {
  return insertCurve(doc, root(doc), {
    kind: 'circle',
    center: vec3(0, 0, 0),
    normal: AXIS_Z,
    xAxis: AXIS_X,
    radius,
    segments,
  });
}

/** Rows K1–K10 of docs/BEHAVIOR_MATRIX.md. */
describe('behavior matrix K: divide, weld, explode curve', () => {
  it('K1: dividing a loose line makes equal, ordered parts', () => {
    const doc = newDocument();
    const [edge] = draw(doc, [segment([0, 0, 0], [3, 0, 0])]).createdEdges;
    const parts = divideEdge(doc, root(doc), edge as EdgeId, 3);
    expect(counts(doc)).toEqual({ v: 4, e: 3, f: 0 });
    const store = doc.rootStore;
    const xs = parts.map((id) => [
      store.position(store.getEdge(id).v0).x,
      store.position(store.getEdge(id).v1).x,
    ]);
    expect(xs).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expectValid(doc);
  });

  it('K2: dividing a face edge keeps the face and threads the parts into its loop', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    const bottom = allEdges(doc).find((id) => {
      const e = doc.rootStore.getEdge(id);
      return doc.rootStore.position(e.v0).y === 0 && doc.rootStore.position(e.v1).y === 0;
    });
    const before = hashDocument(doc);
    divideEdge(doc, root(doc), bottom as EdgeId, 4);
    expect(counts(doc)).toEqual({ v: 7, e: 7, f: 1 });
    const [face] = faceIds(doc.rootStore);
    expect(doc.rootStore.getFace(face as FaceId).outer).toHaveLength(7);
    expect(faceArea(doc.rootStore, face as FaceId)).toBeCloseTo(2);
    expectValid(doc);
    doc.undo();
    expect(hashDocument(doc)).toBe(before);
  });

  it('K3: invalid division counts are refused', () => {
    const doc = newDocument();
    const [edge] = draw(doc, [segment([0, 0, 0], [1, 0, 0])]).createdEdges;
    const id = edge as EdgeId;
    const before = hashDocument(doc);
    for (const n of [1, 0, -2, 2.5, Number.NaN, MAX_CURVE_SEGMENTS + 1]) {
      expect(() => divideEdge(doc, root(doc), id, n)).toThrow(KernelError);
    }
    const tiny = newDocument();
    const [short] = draw(tiny, [segment([0, 0, 0], [3e-6, 0, 0])]).createdEdges;
    expect(() => divideEdge(tiny, root(tiny), short as EdgeId, 3)).toThrow(KernelError);
    expect(hashDocument(doc)).toBe(before);
  });

  it('K4: dividing an arc edge re-divides the whole arc and keeps its parameters', () => {
    const doc = newDocument();
    const arc = insertCurve(doc, root(doc), {
      kind: 'arc',
      center: vec3(0, 0, 0),
      normal: AXIS_Z,
      xAxis: AXIS_X,
      radius: 1,
      startAngle: 0,
      endAngle: Math.PI / 2,
      segments: 12,
    });
    const store = doc.rootStore;
    const ends = [store.getEdge(arc.edges[0] as EdgeId).v0, store.getEdge(arc.edges[11] as EdgeId).v1];
    const parts = divideEdge(doc, root(doc), arc.edges[5] as EdgeId, 6);
    expect(counts(doc)).toEqual({ v: 7, e: 6, f: 0 });
    const curve = store.getCurve(arc.curve as CurveId);
    expect(curve.params).toMatchObject({ kind: 'arc', segments: 6 });
    expect(curve.edges).toEqual(parts);
    for (const v of store.vertices()) expect(Math.hypot(v.position.x, v.position.y)).toBeCloseTo(1, 12);
    for (const end of ends) expect(store.vertex(end)).toBeDefined();
    expectValid(doc);
  });

  it('K5: dividing a circle re-divides its face and the hole it cuts', () => {
    const doc = newDocument();
    draw(doc, rectangle(-2, -2, 2, 2));
    const drawn = circle(doc, 1, 24);
    divideEdge(doc, root(doc), drawn.edges[3] as EdgeId, 8);
    expect(counts(doc)).toEqual({ v: 12, e: 12, f: 2 });
    const store = doc.rootStore;
    const areas = faceIds(store)
      .map((id) => faceArea(store, id))
      .sort((a, b) => a - b);
    const octagon = 2 * Math.SQRT2;
    expect(areas).toEqual([expect.closeTo(octagon, 9), expect.closeTo(16 - octagon, 9)]);
    expect(store.getCurve(drawn.curve as CurveId).params).toMatchObject({ kind: 'circle', segments: 8 });
    expectValid(doc);
  });

  it('K6: a curve edge whose vertices carry other geometry is split straight and the curve becomes a polyline', () => {
    const doc = newDocument();
    const drawn = circle(doc, 1, 12);
    pushPull(doc, root(doc), faceIds(doc.rootStore)[0] as FaceId, -1);
    const store = doc.rootStore;
    const bottom = drawn.edges[0] as EdgeId;
    const curveId = store.getEdge(bottom).curve as CurveId;
    const edge = store.getEdge(bottom);
    const length = distance(store.position(edge.v0), store.position(edge.v1));
    const parts = divideEdge(doc, root(doc), bottom, 2);
    expect(counts(doc)).toEqual({ v: 25, e: 37, f: 14 });
    expect(store.getCurve(curveId).params.kind).toBe('polyline');
    expect(store.getCurve(curveId).edges).toHaveLength(13);
    for (const part of parts) {
      const e = store.getEdge(part);
      expect(distance(store.position(e.v0), store.position(e.v1))).toBeCloseTo(length / 2);
    }
    expectValid(doc);
  });

  it('K7: welding connected lines makes one ordered polyline curve', () => {
    const doc = newDocument();
    draw(doc, [segment([0, 0, 0], [1, 0, 0]), segment([2, 1, 0], [1, 0, 0]), segment([2, 1, 0], [2, 2, 1])]);
    const edges = allEdges(doc);
    const before = counts(doc);
    const curveId = weldEdges(doc, root(doc), [edges[1], edges[2], edges[0]] as EdgeId[]);
    const curve = doc.rootStore.getCurve(curveId);
    expect(curve.params.kind).toBe('polyline');
    // The chain is walked along the first listed edge, from its v0: here toward the raised end.
    expect(curve.edges).toEqual([...edges].reverse());
    expect(counts(doc)).toEqual(before);
    expectValid(doc);
  });

  it('K8: welding a closed chain, and merging fully selected curves', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const loop = allEdges(doc);
    const first = weldEdges(doc, root(doc), loop.slice(0, 2));
    const second = weldEdges(doc, root(doc), loop.slice(2));
    expect(doc.rootStore.curveCount).toBe(2);
    const merged = weldEdges(doc, root(doc), loop);
    expect(doc.rootStore.curveCount).toBe(1);
    expect([first, second]).not.toContain(merged);
    expect(doc.rootStore.getCurve(merged).edges).toHaveLength(4);
    expect(weldEdges(doc, root(doc), loop)).toBe(merged);
    expectValid(doc);
  });

  it('K9: welding refuses branches, gaps, single edges and partly selected curves', () => {
    const doc = newDocument();
    draw(doc, [segment([0, 0, 0], [1, 0, 0]), segment([1, 0, 0], [2, 0, 1]), segment([1, 0, 0], [1, 1, 0])]);
    draw(doc, [segment([5, 0, 0], [6, 0, 0])]);
    const drawn = circle(doc, 0.5, 8);
    const edges = allEdges(doc);
    const loose = edges.filter((id) => doc.rootStore.getEdge(id).curve === null);
    const before = hashDocument(doc);
    expect(() => weldEdges(doc, root(doc), loose.slice(0, 3))).toThrow(KernelError);
    expect(() => weldEdges(doc, root(doc), [loose[0], loose[3]] as EdgeId[])).toThrow(KernelError);
    expect(() => weldEdges(doc, root(doc), [loose[0]] as EdgeId[])).toThrow(KernelError);
    expect(() => weldEdges(doc, root(doc), drawn.edges.slice(0, 3))).toThrow(KernelError);
    expect(hashDocument(doc)).toBe(before);
  });

  it('K10: exploding a curve removes the curve entity and keeps its edges', () => {
    const doc = newDocument();
    const drawn = circle(doc, 1, 16);
    explodeCurve(doc, root(doc), drawn.curve as CurveId);
    expect(doc.rootStore.curveCount).toBe(0);
    expect(counts(doc)).toEqual({ v: 16, e: 16, f: 1 });
    expect(drawn.edges.every((id) => doc.rootStore.getEdge(id).curve === null)).toBe(true);
    expect(() => {
      explodeCurve(doc, root(doc), drawn.curve as CurveId);
    }).toThrow(KernelError);
    expectValid(doc);
  });
});
