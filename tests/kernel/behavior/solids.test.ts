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
import type { FaceId } from '../../../src/kernel/ids';
import { scaling, translation } from '../../../src/kernel/math/mat4';
import { vec3 } from '../../../src/kernel/math/vec3';
import type { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import {
  addDefinition,
  addMaterial,
  reverseFace,
  setFaceAttributes,
} from '../../../src/kernel/model/mutations';
import { deleteFaces } from '../../../src/kernel/ops/erase';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { pushPull } from '../../../src/kernel/ops/pushPull';
import {
  faceProvenance,
  insertTriangleMesh,
  meshVolume,
  reverseMesh,
  toTriangleMesh,
} from '../../../src/kernel/ops/solids/mesh';
import { isSolid, solidVolume } from '../../../src/kernel/ops/solids/solid';
import { counts, draw, expectValid, faceIds, newDocument, rectangle } from '../helpers';

/** A closed box with outward faces, pulled up from a ground rectangle. */
function box(doc: ModelDocument, x0: number, y0: number, x1: number, y1: number, height: number): void {
  draw(doc, rectangle(x0, y0, x1, y1));
  const ground = faceIds(doc.rootStore).find((id) => {
    const plane = doc.rootStore.getFacePlane(id);
    return (
      Math.abs(plane.offset) < 1e-9 &&
      Math.abs(plane.normal.z) > 0.5 &&
      doc.rootStore.getFace(id).outer.length === 4
    );
  }) as FaceId;
  pushPull(doc, doc.rootDefinitionId, ground, -height);
}

/** Rows H8–H12 of docs/BEHAVIOR_MATRIX.md. */
describe('behavior matrix H: solid detection and the mesh round trip', () => {
  it('H8: a closed, consistently oriented box is a solid with its volume', () => {
    const doc = newDocument();
    box(doc, 0, 0, 2, 1, 3);
    expect(isSolid(doc.rootStore)).toBe(true);
    expect(solidVolume(doc.rootStore)).toBeCloseTo(6, 12);
  });

  it('H9: open boxes, fins, flipped faces and empty definitions are not solids', () => {
    expect(isSolid(newDocument().rootStore)).toBe(false);

    const open = newDocument();
    box(open, 0, 0, 1, 1, 1);
    const [anyFace] = faceIds(open.rootStore);
    deleteFaces(open, open.rootDefinitionId, anyFace === undefined ? [] : [anyFace]);
    expect(isSolid(open.rootStore)).toBe(false);

    const fin = newDocument();
    box(fin, 0, 0, 1, 1, 1);
    draw(fin, [{ a: vec3(0, 0, 1), b: vec3(0.5, 0.5, 2) }]);
    expect(isSolid(fin.rootStore)).toBe(false);

    const flipped = newDocument();
    box(flipped, 0, 0, 1, 1, 1);
    const [first] = faceIds(flipped.rootStore);
    flipped.transact('flip', () => {
      if (first !== undefined) reverseFace(flipped, flipped.rootDefinitionId, first);
    });
    expect(isSolid(flipped.rootStore)).toBe(false);
  });

  it('H10: box → mesh → faces gives the same topology, volume and materials', () => {
    const source = newDocument();
    box(source, 0, 0, 1, 2, 3);
    const red = source.transact('paint', () => {
      const material = addMaterial(source, { name: 'Red', color: { r: 1, g: 0, b: 0 }, opacity: 1 });
      const [first] = faceIds(source.rootStore);
      if (first !== undefined)
        setFaceAttributes(source, source.rootDefinitionId, first, { frontMaterialId: material });
      return material;
    });
    const transform = translation(vec3(5, 0, 0));
    const mesh = toTriangleMesh(source.rootStore, transform);
    expect(mesh.indices.length / 3).toBe(12);
    expect(mesh.faceIds).toHaveLength(12);
    expect(meshVolume(mesh)).toBeCloseTo(6, 12);
    expect(meshVolume(reverseMesh(mesh))).toBeCloseTo(-6, 12);

    const target = source.transact('definition', () =>
      addDefinition(source, { name: 'Copy', isGroup: true }),
    );
    const before = hashDocument(source);
    const inserted = insertTriangleMesh(source, target, mesh, faceProvenance(source.rootStore, transform));
    expect(counts(source, target)).toEqual({ v: 8, e: 12, f: 6 });
    expect(inserted.faces).toHaveLength(6);
    const rebuilt = source.store(target);
    expect(isSolid(rebuilt)).toBe(true);
    expect(solidVolume(rebuilt)).toBeCloseTo(6, 9);
    expect([...rebuilt.faces()].filter((face) => face.attributes.frontMaterialId === red)).toHaveLength(1);
    expectValid(source);
    source.undo();
    expect(hashDocument(source)).toBe(before);
  });

  it('H11: a mirrored transform keeps the rebuilt faces pointing outward', () => {
    const source = newDocument();
    box(source, 0, 0, 1, 1, 1);
    const mirror = scaling(vec3(-1, 1, 1));
    const mesh = toTriangleMesh(source.rootStore, mirror);
    expect(meshVolume(mesh)).toBeCloseTo(1, 12);
    const target = newDocument();
    insertTriangleMesh(target, target.rootDefinitionId, mesh, faceProvenance(source.rootStore, mirror));
    expect(counts(target)).toEqual({ v: 8, e: 12, f: 6 });
    expect(solidVolume(target.rootStore)).toBeCloseTo(1, 9);
  });

  it('H12: vertices a little off their planes (single precision) snap back onto them', () => {
    const source = newDocument();
    box(source, 0.1, 0.2, 1.3, 2.7, 1.9);
    const mesh = toTriangleMesh(source.rootStore);
    const noisy = { ...mesh, positions: Float64Array.from(Float32Array.from(mesh.positions)) };
    const target = newDocument();
    insertTriangleMesh(target, target.rootDefinitionId, noisy, faceProvenance(source.rootStore));
    expect(counts(target)).toEqual({ v: 8, e: 12, f: 6 });
    expect(solidVolume(target.rootStore)).toBeCloseTo(1.2 * 2.5 * 1.9, 9);
    expectValid(target);
  });
});
