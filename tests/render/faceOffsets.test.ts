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

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { FaceId } from '../../src/kernel/ids';
import { IDENTITY } from '../../src/kernel/math/mat4';
import { AXIS_Z, vec3 } from '../../src/kernel/math/vec3';
import type { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { addMaterial, setFaceAttributes, setStyleSettings } from '../../src/kernel/model/mutations';
import { paintSidePatch } from '../../src/kernel/ops/materials';
import { pushPull } from '../../src/kernel/ops/pushPull';
import { BACK_FACE_OFFSET, FRONT_FACE_OFFSET, GROUND_RECEIVER_OFFSET } from '../../src/render/faceOffsets';
import { ModelRenderer } from '../../src/render/ModelRenderer';
import { ShadowController } from '../../src/render/shadows/ShadowController';
import { draw, newDocument, rectangle } from '../kernel/helpers';

/** A 2 × 1 × 1 box pulled up from the ground. Returns its faces. */
function box(doc: ModelDocument): FaceId[] {
  draw(doc, rectangle(0, 0, 2, 1));
  const [ground] = [...doc.rootStore.faces()];
  if (!ground) throw new Error('no ground rectangle');
  pushPull(doc, doc.rootDefinitionId, ground.id, -1);
  return [...doc.rootStore.faces()].map((face) => face.id);
}

/** The materials the renderer draws the document's faces with. */
function faceMaterials(doc: ModelDocument): THREE.Material[] {
  const renderer = new ModelRenderer({
    doc,
    camera: {
      eye: vec3(7, -8, 6),
      target: vec3(1, 0.5, 0.5),
      up: AXIS_Z,
      fovDegrees: 35,
      projection: 'perspective',
      orthoHalfHeight: 5,
    },
    selection: { refs: () => [] },
    activeContext: doc.rootDefinitionId,
    activeContextTransform: IDENTITY,
    editPath: [],
    preview: null,
    showSectionPlanes: false,
    showSectionCuts: false,
    subscribe: () => () => undefined,
  });
  renderer.update();
  const materials = new Set<THREE.Material>();
  renderer.root.traverse((object) => {
    if (object instanceof THREE.Mesh) materials.add(object.material as THREE.Material);
  });
  return [...materials];
}

function expectOffsetsBySide(materials: readonly THREE.Material[]): void {
  const front = materials.filter((material) => material.side === THREE.FrontSide);
  const back = materials.filter((material) => material.side === THREE.BackSide);
  expect(front.length).toBeGreaterThan(0);
  expect(back.length).toBeGreaterThan(0);
  for (const material of front) expect(material).toMatchObject(FRONT_FACE_OFFSET);
  for (const material of back) expect(material).toMatchObject(BACK_FACE_OFFSET);
}

describe('face depth offsets', () => {
  it('put back sides a few depth steps behind front sides, by a constant only, and the shadow ground behind both', () => {
    expect(BACK_FACE_OFFSET.polygonOffsetFactor).toBe(FRONT_FACE_OFFSET.polygonOffsetFactor);
    expect(BACK_FACE_OFFSET.polygonOffsetUnits - FRONT_FACE_OFFSET.polygonOffsetUnits).toBeGreaterThanOrEqual(
      4,
    );
    expect(GROUND_RECEIVER_OFFSET.polygonOffsetUnits).toBeGreaterThan(BACK_FACE_OFFSET.polygonOffsetUnits);
    const shadows = new ShadowController({ shadowMap: {} } as THREE.WebGLRenderer);
    expect(shadows.ground.material).toMatchObject(GROUND_RECEIVER_OFFSET);
  });

  it('apply to both sides of plain faces', () => {
    const doc = newDocument();
    box(doc);
    expectOffsetsBySide(faceMaterials(doc));
  });

  it('apply to painted faces and in hidden line', () => {
    const doc = newDocument();
    const [first, second] = box(doc);
    if (first === undefined || second === undefined) throw new Error('no faces');
    doc.transact('Paint', () => {
      const brick = addMaterial(doc, { name: 'Brick', color: { r: 0.6, g: 0.2, b: 0.1 }, opacity: 1 });
      setFaceAttributes(doc, doc.rootDefinitionId, first, paintSidePatch('front', brick));
      setFaceAttributes(doc, doc.rootDefinitionId, second, paintSidePatch('back', brick));
    });
    const painted = faceMaterials(doc);
    expect(painted.some((material) => material instanceof THREE.MeshStandardMaterial)).toBe(true);
    expectOffsetsBySide(painted);

    doc.transact('Hidden line', () => {
      setStyleSettings(doc, { faceStyle: 'hiddenLine' });
    });
    expectOffsetsBySide(faceMaterials(doc));
  });
});
