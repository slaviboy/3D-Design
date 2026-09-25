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
import { add, vec3 } from '../../../src/kernel/math/vec3';
import { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import { moveVertex, reverseFace } from '../../../src/kernel/model/mutations';
import { restoreSnapshotWithRepair } from '../../../src/kernel/model/repair';
import { createSnapshot, hashDocument, restoreSnapshot } from '../../../src/kernel/model/snapshot';
import { DEFAULT_MODEL_AXES } from '../../../src/kernel/model/types';
import { validateDocument } from '../../../src/kernel/model/validate';
import { pushPull } from '../../../src/kernel/ops/pushPull';
import { boxEdges, draw, expectValid, newDocument, rectangle } from '../helpers';

type Json = Record<string, unknown>;
interface MutableSnapshot extends Json {
  nextId: number;
  definitions: (Json & { vertices: Json[]; edges: Json[]; faces: (Json & { attributes: Json })[] })[];
}

function twoRectangles(): ModelDocument {
  const doc = newDocument();
  draw(doc, rectangle(0, 0, 2, 1));
  draw(doc, rectangle(5, 0, 7, 1));
  return doc;
}

function mutable(doc: ModelDocument): MutableSnapshot {
  return JSON.parse(JSON.stringify(createSnapshot(doc))) as MutableSnapshot;
}

function root(snapshot: MutableSnapshot) {
  const definition = snapshot.definitions[0];
  if (!definition) throw new Error('snapshot has no definitions');
  return definition;
}

const faceCount = (doc: ModelDocument): number => [...doc.rootStore.faces()].length;

describe('repair on open', () => {
  it('leaves a valid snapshot unchanged', () => {
    const doc = twoRectangles();
    const result = restoreSnapshotWithRepair(mutable(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repairs).toEqual([]);
    expect(hashDocument(result.value.doc)).toBe(hashDocument(doc));
  });

  it('clears references to missing materials and keeps the face', () => {
    const snapshot = mutable(twoRectangles());
    const face = root(snapshot).faces[0];
    if (!face) throw new Error('no face');
    face.attributes.frontMaterialId = snapshot.nextId + 50;
    expect(restoreSnapshot(snapshot).ok).toBe(false);

    const result = restoreSnapshotWithRepair(snapshot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(faceCount(result.value.doc)).toBe(2);
    expect(result.value.repairs).toHaveLength(1);
    expect(result.value.repairs[0]).toMatch(/Cleared references/);
    expectValid(result.value.doc);
  });

  it('leaves out a face whose edge is missing, and keeps the rest of the model', () => {
    const snapshot = mutable(twoRectangles());
    const definition = root(snapshot);
    const face = definition.faces[0] as unknown as { outer: { edge: number }[] };
    const missingEdge = face.outer[0]?.edge;
    definition.edges = definition.edges.filter((edge) => edge.id !== missingEdge);
    expect(restoreSnapshot(snapshot).ok).toBe(false);

    const result = restoreSnapshotWithRepair(snapshot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(faceCount(result.value.doc)).toBe(1);
    expect(result.value.repairs.some((repair) => repair.startsWith('Removed face'))).toBe(true);
    expectValid(result.value.doc);
  });

  it('resets invalid drawing axes to the default', () => {
    const snapshot = mutable(twoRectangles());
    snapshot.axes = {
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 2, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
    };
    expect(restoreSnapshot(snapshot).ok).toBe(false);

    const result = restoreSnapshotWithRepair(snapshot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc.axes).toEqual(DEFAULT_MODEL_AXES);
    expect(result.value.repairs).toEqual([expect.stringMatching(/^Reset the drawing axes/)]);
  });

  it('still refuses problems only topology operations could fix', () => {
    const snapshot = mutable(twoRectangles());
    const definition = root(snapshot);
    const vertex = definition.vertices[0];
    if (!vertex) throw new Error('no vertex');
    definition.vertices.push({ id: snapshot.nextId, position: vertex.position });
    snapshot.nextId += 1;

    const result = restoreSnapshotWithRepair(snapshot);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/can't be repaired/);
  });

  /**
   * What Push/Pull used to leave when a pocket's floor was pushed down to the bottom: the floor lying on the bottom
   * face, the two facing opposite ways. The document doesn't validate its transactions, as in the app.
   */
  function doubleBottom(): { doc: ModelDocument; floor: FaceId; bottom: FaceId } {
    const doc = new ModelDocument();
    const context = doc.rootDefinitionId;
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    draw(doc, rectangle(0.25, 0.25, 0.75, 0.75, 1));
    const store = doc.rootStore;
    const faceAt = (z: number, inner: boolean) =>
      [...store.faces()].find(
        (face) =>
          face.plane !== null &&
          Math.abs(face.plane.normal.z) > 0.5 &&
          store.loopPoints(face.outer).every((p) => Math.abs(p.z - z) < 1e-9 && (!inner || p.x > 0.1)),
      )?.id;
    const square = faceAt(1, true);
    if (square === undefined) throw new Error('no inner square');
    const floor = pushPull(doc, context, square, -0.3).face;
    const bottom = faceAt(0, false);
    if (floor === null || bottom === undefined) throw new Error('no pocket');
    doc.transact('The old stretch', () => {
      for (const vertex of new Set(store.faceLoops(floor).flatMap((loop) => store.loopVertices(loop)))) {
        moveVertex(doc, context, vertex, add(store.position(vertex), vec3(0, 0, -0.7)));
      }
    });
    expect(validateDocument(doc).problems.map((problem) => problem.code)).toEqual(['overlapping-faces']);
    return { doc, floor, bottom };
  }

  it('cuts through where a pushed face was left lying on the far side, as Push/Pull does now', () => {
    const { doc, floor, bottom } = doubleBottom();
    const snapshot = mutable(doc);
    expect(restoreSnapshot(snapshot).ok).toBe(false);

    const result = restoreSnapshotWithRepair(snapshot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repairs).toEqual([
      `Cut a hole where face ${String(floor)} lay on face ${String(bottom)}, which faces the other way (a push that reached the far side)`,
    ]);
    const repaired = result.value.doc;
    expectValid(repaired);
    expect(repaired.undoDepth).toBe(0);
    const bottoms = [...repaired.rootStore.faces()].filter((face) =>
      repaired.rootStore.loopPoints(face.outer).every((p) => Math.abs(p.z) < 1e-9),
    );
    expect(bottoms).toHaveLength(1);
    expect(bottoms[0]?.inners).toHaveLength(1);
  });

  it('still refuses coplanar faces that overlap facing the same way', () => {
    const { doc, bottom } = doubleBottom();
    doc.transact('Flip the bottom', () => {
      reverseFace(doc, doc.rootDefinitionId, bottom);
    });
    const result = restoreSnapshotWithRepair(mutable(doc));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/can't be repaired: overlapping-faces/);
  });

  it('still refuses structurally broken snapshots', () => {
    const snapshot = mutable(twoRectangles());
    root(snapshot).edges = 'not a list' as unknown as Json[];
    expect(restoreSnapshotWithRepair(snapshot).ok).toBe(false);
  });
});
