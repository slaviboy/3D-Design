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
import type { FaceId, VertexId } from '../../../src/kernel/ids';
import {
  linearDeterminant,
  multiply,
  rotationAxisAngle,
  scaling,
  translation,
  type Mat4,
} from '../../../src/kernel/math/mat4';
import { dot, scale, sub, vec3, AXIS_X, AXIS_Z, type Vec3 } from '../../../src/kernel/math/vec3';
import type { EntityStore } from '../../../src/kernel/model/EntityStore';
import type { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { insertCurve } from '../../../src/kernel/ops/curves';
import { makeGroup } from '../../../src/kernel/ops/hierarchy';
import { pushPull } from '../../../src/kernel/ops/pushPull';
import {
  copyRepeatedly,
  transformEntities,
  type TransformSelection,
} from '../../../src/kernel/ops/transform';
import {
  counts,
  draw,
  expectValid,
  faceIds,
  newDocument,
  orientationConsistent,
  rectangle,
} from '../helpers';

const root = (doc: ModelDocument) => doc.rootDefinitionId;

/** `m` applied about `pivot` instead of the origin. */
const about = (pivot: Vec3, m: Mat4): Mat4 =>
  multiply(translation(pivot), multiply(m, translation(scale(pivot, -1))));

function everything(store: EntityStore): TransformSelection {
  return { faces: faceIds(store), edges: [...store.edges()].map((e) => e.id) };
}

/** Unit box pulled up from a ground rectangle at `(x, y)`, with outward faces. */
function box(doc: ModelDocument, x = 0, y = 0): void {
  draw(doc, rectangle(x, y, x + 1, y + 1));
  const ground = faceIds(doc.rootStore).find((id) => {
    const face = doc.rootStore.getFace(id);
    return (
      doc.rootStore.getEdge(face.outer[0]?.edge as never).faces.length === 1 &&
      doc.rootStore.loopPoints(face.outer).every((p) => p.z === 0 && p.x >= x && p.x <= x + 1)
    );
  });
  pushPull(doc, root(doc), ground as FaceId, -1);
}

function centroid(points: readonly Vec3[]): Vec3 {
  const sum = points.reduce((s, p) => vec3(s.x + p.x, s.y + p.y, s.z + p.z), vec3(0, 0, 0));
  return scale(sum, 1 / points.length);
}

/** True when every face's normal points away from `center`. */
function outwardFrom(store: EntityStore, center: Vec3): boolean {
  return faceIds(store).every((id) => {
    const face = store.getFace(id);
    return dot(store.getFacePlane(id).normal, sub(centroid(store.loopPoints(face.outer)), center)) > 0;
  });
}

function bounds(store: EntityStore): { min: Vec3; max: Vec3 } {
  const points = [...store.vertices()].map((v) => v.position);
  return {
    min: vec3(
      Math.min(...points.map((p) => p.x)),
      Math.min(...points.map((p) => p.y)),
      Math.min(...points.map((p) => p.z)),
    ),
    max: vec3(
      Math.max(...points.map((p) => p.x)),
      Math.max(...points.map((p) => p.y)),
      Math.max(...points.map((p) => p.z)),
    ),
  };
}

function topFace(doc: ModelDocument): FaceId {
  const top = faceIds(doc.rootStore).find((id) => {
    const plane = doc.rootStore.getFacePlane(id);
    return plane.normal.z > 0.5 && Math.abs(plane.offset - 1) < 1e-9;
  });
  if (top === undefined) throw new Error('no top face');
  return top;
}

function vertexAt(store: EntityStore, x: number, y: number, z: number): VertexId {
  const vertex = [...store.vertices()].find(
    (v) => v.position.x === x && v.position.y === y && v.position.z === z,
  );
  if (!vertex) throw new Error('vertex not found');
  return vertex.id;
}

/** Rows D1–D12 of docs/BEHAVIOR_MATRIX.md. */
describe('behavior matrix D: rotate, scale, flip', () => {
  it('D1: rotating a detached box 90° about Z around a corner keeps it valid with outward faces', () => {
    const doc = newDocument();
    box(doc);
    const before = hashDocument(doc);
    transformEntities(
      doc,
      root(doc),
      everything(doc.rootStore),
      about(vec3(1, 0, 0), rotationAxisAngle(AXIS_Z, Math.PI / 2)),
    );
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    const { min, max } = bounds(doc.rootStore);
    expect([min.x, min.y, max.x, max.y]).toEqual([
      expect.closeTo(0, 9),
      expect.closeTo(-1, 9),
      expect.closeTo(1, 9),
      expect.closeTo(0, 9),
    ]);
    expect(outwardFrom(doc.rootStore, vec3(0.5, -0.5, 0.5))).toBe(true);
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    expectValid(doc);
    doc.undo();
    expect(hashDocument(doc)).toBe(before);
  });

  it('D2: rotating the top face about one of its edges tilts it; the side faces stay planar', () => {
    const doc = newDocument();
    box(doc);
    const hinge = about(vec3(0, 0, 1), rotationAxisAngle(AXIS_X, Math.PI / 6));
    transformEntities(doc, root(doc), { faces: [topFace(doc)] }, hinge, { autofold: false });
    // Every side face keeps its hinge-parallel edges parallel, so nothing bends and nothing needs folding.
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expect(bounds(doc.rootStore).max.z).toBeCloseTo(1.5);
    expect(outwardFrom(doc.rootStore, vec3(0.5, 0.5, 0.6))).toBe(true);
    expectValid(doc);
  });

  it('D3: twisting the top face 30° about a vertical axis folds the four side quads', () => {
    const doc = newDocument();
    box(doc);
    const twist = about(vec3(0, 0, 1), rotationAxisAngle(AXIS_Z, Math.PI / 6));
    const before = hashDocument(doc);
    expect(() =>
      transformEntities(doc, root(doc), { faces: [topFace(doc)] }, twist, { autofold: false }),
    ).toThrow(KernelError);
    expect(hashDocument(doc)).toBe(before);
    transformEntities(doc, root(doc), { faces: [topFace(doc)] }, twist);
    expect(counts(doc)).toEqual({ v: 8, e: 16, f: 10 });
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    expectValid(doc);
  });

  it('D4: a rotated copy repeated 5 times makes a radial array of 6 boxes', () => {
    const doc = newDocument();
    box(doc, 2, -0.5);
    const selection = everything(doc.rootStore);
    const result = copyRepeatedly(doc, root(doc), selection, 5, (k) =>
      rotationAxisAngle(AXIS_Z, (k * Math.PI) / 3),
    );
    expect(counts(doc)).toEqual({ v: 48, e: 72, f: 36 });
    expect(result.faces).toHaveLength(30);
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    expectValid(doc);
  });

  it('D4: a sixth rotated copy lands on the original and merges with it', () => {
    const doc = newDocument();
    box(doc, 2, -0.5);
    copyRepeatedly(doc, root(doc), everything(doc.rootStore), 6, (k) =>
      rotationAxisAngle(AXIS_Z, (k * Math.PI) / 3),
    );
    expect(counts(doc)).toEqual({ v: 48, e: 72, f: 36 });
    expectValid(doc);
  });

  it('D5: non-uniform scaling of a detached box keeps its faces planar and outward', () => {
    const doc = newDocument();
    box(doc);
    transformEntities(doc, root(doc), everything(doc.rootStore), scaling(vec3(2, 0.5, 3)));
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expect(bounds(doc.rootStore).max).toEqual(vec3(2, 0.5, 3));
    expect(outwardFrom(doc.rootStore, vec3(1, 0.25, 1.5))).toBe(true);
    expectValid(doc);
  });

  it('D6: non-uniform scaling of a cylinder turns its circles into polylines', () => {
    const doc = newDocument();
    insertCurve(doc, root(doc), {
      kind: 'circle',
      center: vec3(0, 0, 0),
      normal: AXIS_Z,
      xAxis: AXIS_X,
      radius: 1,
      segments: 12,
    });
    const [disc] = faceIds(doc.rootStore);
    pushPull(doc, root(doc), disc as FaceId, -1);
    transformEntities(doc, root(doc), everything(doc.rootStore), scaling(vec3(2, 1, 1)));
    expect(counts(doc)).toEqual({ v: 24, e: 36, f: 14 });
    expect([...doc.rootStore.curves()].map((c) => c.params.kind)).toEqual(['polyline', 'polyline']);
    expect(outwardFrom(doc.rootStore, vec3(0, 0, 0.5))).toBe(true);
    expectValid(doc);
  });

  it('D7: mirroring a detached box keeps every face outward-facing', () => {
    const doc = newDocument();
    box(doc);
    const mirror = about(vec3(2, 0, 0), scaling(vec3(-1, 1, 1)));
    expect(linearDeterminant(mirror)).toBeLessThan(0);
    transformEntities(doc, root(doc), everything(doc.rootStore), mirror);
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expect(bounds(doc.rootStore).min.x).toBeCloseTo(3);
    expect(outwardFrom(doc.rootStore, vec3(3.5, 0.5, 0.5))).toBe(true);
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    expectValid(doc);
  });

  it('D7: a mirrored copy faces outward too', () => {
    const doc = newDocument();
    box(doc);
    transformEntities(
      doc,
      root(doc),
      everything(doc.rootStore),
      about(vec3(0, 2, 0), scaling(vec3(1, -1, 1))),
      { copy: true },
    );
    expect(counts(doc)).toEqual({ v: 16, e: 24, f: 12 });
    const store = doc.rootStore;
    const upper = faceIds(store).filter((id) =>
      store.loopPoints(store.getFace(id).outer).every((p) => p.y >= 4 - 1e-9),
    );
    expect(upper).toHaveLength(1);
    expect(store.getFacePlane(upper[0] as FaceId).normal.y).toBeCloseTo(1);
    expect(orientationConsistent(store)).toBe(true);
    expectValid(doc);
  });

  it('D8: mirroring geometry connected to other geometry keeps the carried faces outward', () => {
    const doc = newDocument();
    box(doc);
    draw(doc, rectangle(0.25, 0.25, 0.75, 0.6, 1));
    const inner = faceIds(doc.rootStore).find((id) => {
      const plane = doc.rootStore.getFacePlane(id);
      return (
        plane.normal.z > 0.5 &&
        doc.rootStore.getFace(id).inners.length === 0 &&
        Math.abs(plane.offset - 1) < 1e-9
      );
    }) as FaceId;
    const { face: cap } = pushPull(doc, root(doc), inner, 0.5);
    const store = doc.rootStore;
    // The prism: its cap and the four walls standing on the box's top ring.
    const prism = faceIds(store).filter(
      (id) =>
        store.loopPoints(store.getFace(id).outer).every((p) => p.z >= 1 - 1e-9) &&
        store.getFace(id).inners.length === 0,
    );
    expect(prism).toContain(cap);
    // Mirror across y = 0.5: the prism's footprint moves from y ∈ [0.25, 0.6] to y ∈ [0.4, 0.75], and the hole in
    // the box's top ring follows it.
    const mirror = about(vec3(0, 0.5, 0), scaling(vec3(1, -1, 1)));
    transformEntities(doc, root(doc), { faces: prism }, mirror);
    expect(counts(doc)).toEqual({ v: 16, e: 24, f: 11 });
    expect(store.getFacePlane(cap as FaceId).normal.z).toBeCloseTo(1);
    expect(orientationConsistent(store)).toBe(true);
    expectValid(doc);

    // A symmetric prism maps onto its own footprint, so the in-place mirror is valid and must not turn it inside out.
    const sym = newDocument();
    box(sym);
    draw(sym, rectangle(0.25, 0.25, 0.75, 0.75, 1));
    const symInner = faceIds(sym.rootStore).find((id) => {
      const plane = sym.rootStore.getFacePlane(id);
      return (
        plane.normal.z > 0.5 &&
        sym.rootStore.getFace(id).inners.length === 0 &&
        Math.abs(plane.offset - 1) < 1e-9
      );
    }) as FaceId;
    pushPull(sym, root(sym), symInner, 0.5);
    const s = sym.rootStore;
    const symPrism = faceIds(s).filter(
      (id) =>
        s.loopPoints(s.getFace(id).outer).every((p) => p.z >= 1 - 1e-9) && s.getFace(id).inners.length === 0,
    );
    transformEntities(sym, root(sym), { faces: symPrism }, mirror);
    expect(counts(sym)).toEqual({ v: 16, e: 24, f: 11 });
    expect(orientationConsistent(s)).toBe(true);
    expect(outwardFrom(s, vec3(0.5, 0.5, 0.9))).toBe(true);
    expectValid(sym);
  });

  it('D9: flipping a group only gives its instance a mirroring transform', () => {
    const doc = newDocument();
    box(doc);
    const { definition, instance } = makeGroup(doc, root(doc), everything(doc.rootStore));
    const inside = hashDocument(doc);
    transformEntities(
      doc,
      root(doc),
      { instances: [instance] },
      about(vec3(0.5, 0, 0), scaling(vec3(-1, 1, 1))),
    );
    expect(linearDeterminant(doc.rootStore.getInstance(instance).transform)).toBeCloseTo(-1);
    expect(counts(doc, definition)).toEqual({ v: 8, e: 12, f: 6 });
    expect(counts(doc)).toEqual({ v: 0, e: 0, f: 0 });
    expect(hashDocument(doc)).not.toBe(inside);
    expectValid(doc);
  });

  it('D10: scaling by 0 on any axis is refused and changes nothing', () => {
    const doc = newDocument();
    box(doc);
    const { instance } = makeGroup(doc, root(doc), everything(doc.rootStore));
    box(doc, 3, 0);
    const before = hashDocument(doc);
    const flatten = scaling(vec3(1, 0, 1));
    expect(() => transformEntities(doc, root(doc), everything(doc.rootStore), flatten)).toThrow(KernelError);
    expect(() =>
      transformEntities(doc, root(doc), { faces: [topFace(doc)] }, scaling(vec3(1, 1, 0))),
    ).toThrow(KernelError);
    expect(() =>
      transformEntities(doc, root(doc), { instances: [instance] }, scaling(vec3(0, 1, 1))),
    ).toThrow(KernelError);
    expect(() =>
      copyRepeatedly(doc, root(doc), everything(doc.rootStore), 2, (k) => scaling(vec3(1, 1, k - 1))),
    ).toThrow(KernelError);
    expect(hashDocument(doc)).toBe(before);
  });

  it('D11: stretching a box top with a non-uniform scale keeps every face planar', () => {
    const doc = newDocument();
    box(doc);
    transformEntities(
      doc,
      root(doc),
      { faces: [topFace(doc)] },
      about(vec3(0.5, 0.5, 1), scaling(vec3(2, 0.5, 1))),
    );
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expect(bounds(doc.rootStore).max.x).toBeCloseTo(1.5);
    expectValid(doc);
  });

  it('D12: scaling two opposite top corners up folds the top face; without autofold it is refused', () => {
    const doc = newDocument();
    box(doc);
    const corners = [vertexAt(doc.rootStore, 0, 0, 1), vertexAt(doc.rootStore, 1, 1, 1)];
    const lift = scaling(vec3(1, 1, 1.5));
    const before = hashDocument(doc);
    expect(() => transformEntities(doc, root(doc), { vertices: corners }, lift, { autofold: false })).toThrow(
      KernelError,
    );
    expect(hashDocument(doc)).toBe(before);
    transformEntities(doc, root(doc), { vertices: corners }, lift);
    expect(counts(doc)).toEqual({ v: 8, e: 13, f: 7 });
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    expectValid(doc);
  });
});
