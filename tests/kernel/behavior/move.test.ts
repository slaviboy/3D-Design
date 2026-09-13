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
import type { EdgeId, FaceId, VertexId } from '../../../src/kernel/ids';
import { translation } from '../../../src/kernel/math/mat4';
import { vec3 } from '../../../src/kernel/math/vec3';
import type { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { makeGroup } from '../../../src/kernel/ops/hierarchy';
import { pushPull } from '../../../src/kernel/ops/pushPull';
import { copyRepeatedly, transformEntities } from '../../../src/kernel/ops/transform';
import {
  boxEdges,
  counts,
  draw,
  expectValid,
  newDocument,
  orientationConsistent,
  rectangle,
} from '../helpers';

const root = (doc: ModelDocument) => doc.rootDefinitionId;
const allFaces = (doc: ModelDocument): FaceId[] => [...doc.rootStore.faces()].map((f) => f.id);
const allEdges = (doc: ModelDocument): EdgeId[] => [...doc.rootStore.edges()].map((e) => e.id);

function box(doc: ModelDocument): void {
  draw(doc, rectangle(0, 0, 1, 1));
  const [ground] = allFaces(doc);
  pushPull(doc, root(doc), ground as FaceId, -1);
}

function topFace(doc: ModelDocument): FaceId {
  const store = doc.rootStore;
  const top = [...store.faces()].find(
    (face) => face.plane && face.plane.normal.z > 0.5 && Math.abs(face.plane.offset - 1) < 1e-9,
  );
  if (!top) throw new Error('no top face');
  return top.id;
}

function minX(doc: ModelDocument): number {
  return Math.min(...[...doc.rootStore.vertices()].map((v) => v.position.x));
}

/** Rows C1–C10 of docs/BEHAVIOR_MATRIX.md. */
describe('behavior matrix C: move, stretch, autofold, copy', () => {
  it('C1: moving a whole detached box translates it', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const result = transformEntities(
      doc,
      root(doc),
      { faces: allFaces(doc), edges: allEdges(doc) },
      translation(vec3(1, 0, 0)),
    );
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expect(minX(doc)).toBeCloseTo(1);
    expect(result.faces).toHaveLength(6);
    expect(orientationConsistent(doc.rootStore)).toBe(true);
  });

  it('C2: moving the top face up stretches the box', () => {
    const doc = newDocument();
    box(doc);
    const top = topFace(doc);
    transformEntities(doc, root(doc), { faces: [top] }, translation(vec3(0, 0, 0.5)));
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expect(doc.rootStore.getFacePlane(top).offset).toBeCloseTo(1.5);
  });

  it('C3: moving a top edge sideways keeps every face planar', () => {
    const doc = newDocument();
    box(doc);
    const store = doc.rootStore;
    const edge = [...store.edges()].find((e) => {
      const a = store.position(e.v0);
      const b = store.position(e.v1);
      return a.y === 1 && b.y === 1 && a.z === 1 && b.z === 1;
    });
    transformEntities(doc, root(doc), { edges: edge ? [edge.id] : [] }, translation(vec3(0, 0.5, 0)));
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expectValid(doc);
  });

  function cornerVertex(doc: ModelDocument): VertexId {
    const vertex = [...doc.rootStore.vertices()].find(
      (v) => v.position.x === 1 && v.position.y === 1 && v.position.z === 1,
    );
    if (!vertex) throw new Error('corner not found');
    return vertex.id;
  }

  it('C4: raising one corner folds the top face into two triangles', () => {
    const doc = newDocument();
    box(doc);
    transformEntities(doc, root(doc), { vertices: [cornerVertex(doc)] }, translation(vec3(0, 0, 0.5)));
    expect(counts(doc)).toEqual({ v: 8, e: 13, f: 7 });
    expect(orientationConsistent(doc.rootStore)).toBe(true);
  });

  it('C5: without autofold the same move is refused', () => {
    const doc = newDocument();
    box(doc);
    const before = hashDocument(doc);
    expect(() =>
      transformEntities(doc, root(doc), { vertices: [cornerVertex(doc)] }, translation(vec3(0, 0, 0.5)), {
        autofold: false,
      }),
    ).toThrow(KernelError);
    expect(hashDocument(doc)).toBe(before);
  });

  it('C6: copying a rectangle leaves the original in place', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    transformEntities(doc, root(doc), { faces: allFaces(doc) }, translation(vec3(2, 0, 0)), { copy: true });
    expect(counts(doc)).toEqual({ v: 8, e: 8, f: 2 });
  });

  it('C7: an external array makes evenly spaced copies', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const result = copyRepeatedly(doc, root(doc), { faces: allFaces(doc) }, 3, (k) =>
      translation(vec3(2 * k, 0, 0)),
    );
    expect(counts(doc)).toEqual({ v: 16, e: 16, f: 4 });
    expect(result.faces).toHaveLength(3);
    expect(() =>
      copyRepeatedly(doc, root(doc), { faces: allFaces(doc) }, 0, () => translation(vec3(1, 0, 0))),
    ).toThrow(KernelError);
  });

  it('C8: an internal array divides the distance', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 0.25, 0.25));
    copyRepeatedly(doc, root(doc), { faces: allFaces(doc) }, 4, (k) => translation(vec3((2 / 4) * k, 0, 0)));
    expect(counts(doc)).toEqual({ v: 20, e: 20, f: 5 });
  });

  it('C9: a copy landing exactly on the original merges with it', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    transformEntities(doc, root(doc), { faces: allFaces(doc) }, translation(vec3(0, 0, 0)), { copy: true });
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
  });

  it('C10: moving a group onto loose geometry only changes its transform', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const { instance } = makeGroup(doc, root(doc), { faces: allFaces(doc) });
    draw(doc, rectangle(3, 0, 4, 1));
    transformEntities(doc, root(doc), { instances: [instance] }, translation(vec3(3, 0, 0)));
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
    expect(doc.rootStore.getInstance(instance).transform[12]).toBe(3);
    transformEntities(doc, root(doc), { instances: [instance] }, translation(vec3(1, 0, 0)), { copy: true });
    expect(doc.rootStore.instanceCount).toBe(2);
  });

  it('refuses a stretch that would make geometry touch', () => {
    const doc = newDocument();
    box(doc);
    const before = hashDocument(doc);
    expect(() =>
      transformEntities(doc, root(doc), { faces: [topFace(doc)] }, translation(vec3(0, 0, -1))),
    ).toThrow(KernelError);
    expect(hashDocument(doc)).toBe(before);
  });

  it('moves loose lines and merges them where they land', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 2));
    const loose = draw(doc, [{ a: vec3(5, 0, 0), b: vec3(5, 2, 0) }]).createdEdges;
    const result = transformEntities(doc, root(doc), { edges: loose }, translation(vec3(-4, 0, 0)));
    expect(counts(doc)).toEqual({ v: 6, e: 7, f: 2 });
    expect(result.edges).toHaveLength(1);
  });
});
