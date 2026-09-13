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
import { translation } from '../../../src/kernel/math/mat4';
import { vec3 } from '../../../src/kernel/math/vec3';
import type { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import {
  addGuideLine,
  addGuidePoint,
  addInstance,
  addMaterial,
  addTag,
  setFaceAttributes,
  setInstanceAttributes,
} from '../../../src/kernel/model/mutations';
import {
  createSnapshot,
  hashDocument,
  restoreSnapshot,
  SNAPSHOT_FORMAT,
} from '../../../src/kernel/model/snapshot';
import { insertCurve } from '../../../src/kernel/ops/curves';
import { makeComponent, makeGroup } from '../../../src/kernel/ops/hierarchy';
import { boxEdges, counts, draw, expectValid, newDocument, rectangle, segment } from '../helpers';

function richDocument(): ModelDocument {
  const doc = newDocument();
  draw(doc, rectangle(0, 0, 2, 1));
  insertCurve(doc, doc.rootDefinitionId, {
    kind: 'circle',
    center: vec3(1, 0.5, 0),
    normal: vec3(0, 0, 1),
    xAxis: vec3(1, 0, 0),
    radius: 0.25,
    segments: 12,
  });
  draw(doc, boxEdges(5, 0, 0, 6, 1, 1));
  const boxFaces = [...doc.rootStore.faces()].filter((face) => doc.rootStore.faceBounds(face.id).minX >= 5);
  const group = makeGroup(doc, doc.rootDefinitionId, { faces: boxFaces.map((face) => face.id) });
  const component = makeComponent(doc, doc.rootDefinitionId, { instances: [group.instance] }, 'Crate');
  doc.transact('Decorate', () => {
    const material = addMaterial(doc, { name: 'Oak', color: { r: 0.5, g: 0.35, b: 0.2 }, opacity: 1 });
    const tag = addTag(doc, { name: 'Furniture', visible: true, color: { r: 1, g: 0, b: 0 } });
    const firstFace = [...doc.rootStore.faces()][0];
    if (firstFace) setFaceAttributes(doc, doc.rootDefinitionId, firstFace.id, { frontMaterialId: material });
    setInstanceAttributes(doc, doc.rootDefinitionId, component.instance, { tagId: tag, name: 'Crate A' });
    addInstance(doc, doc.rootDefinitionId, component.definition, translation(vec3(0, 3, 0)));
    addGuideLine(doc, doc.rootDefinitionId, vec3(0, 0, 0), vec3(1, 1, 0), { hidden: false, tagId: tag });
    addGuidePoint(doc, component.definition, vec3(5, 0, 1));
  });
  return doc;
}

function roundTrip(doc: ModelDocument): ModelDocument {
  const result = restoreSnapshot(JSON.parse(JSON.stringify(createSnapshot(doc))));
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function mutableSnapshot(
  doc: ModelDocument,
): Record<string, unknown> & { definitions: Record<string, unknown>[] } {
  return JSON.parse(JSON.stringify(createSnapshot(doc))) as Record<string, unknown> & {
    definitions: Record<string, unknown>[];
  };
}

describe('document snapshots', () => {
  it('round-trips a document with curves, holes, groups, components, materials and tags', () => {
    const doc = richDocument();
    const restored = roundTrip(doc);
    expect(hashDocument(restored)).toBe(hashDocument(doc));
    expect(restored.ids.next).toBe(doc.ids.next);
    expect(restored.canUndo).toBe(false);
    expectValid(restored);
  });

  it('round-trips guides in their definitions', () => {
    const doc = richDocument();
    const restored = roundTrip(doc);
    const guideCounts = (d: ModelDocument): number[] =>
      [...d.definitions()].sort((a, b) => a.id - b.id).map((definition) => definition.store.guideCount);
    expect(guideCounts(restored)).toEqual(guideCounts(doc));
    expect(guideCounts(restored).reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(createSnapshot(restored)).toEqual(createSnapshot(doc));
  });

  it('restores snapshots saved before guides existed', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const snapshot = mutableSnapshot(doc);
    for (const definition of snapshot.definitions) delete definition.guides;
    const result = restoreSnapshot(snapshot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(hashDocument(result.value)).toBe(hashDocument(doc));
      expect(result.value.rootStore.guideCount).toBe(0);
    }
  });

  it('rejects malformed guides and guide ids that collide', () => {
    const doc = newDocument();
    doc.transact('Guides', () => {
      addGuideLine(doc, doc.rootDefinitionId, vec3(0, 0, 0), vec3(0, 0, 1));
    });
    const badKind = mutableSnapshot(doc) as unknown as { definitions: { guides: { geometry: object }[] }[] };
    const guide = badKind.definitions[0]?.guides[0];
    if (!guide) throw new Error('expected a guide');
    guide.geometry = { kind: 'ray', point: { x: 0, y: 0, z: 0 } };
    expect(restoreSnapshot(badKind)).toMatchObject({
      ok: false,
      error: expect.stringContaining('$.definitions[0].guides[0].geometry.kind'),
    });

    const notUnit = mutableSnapshot(doc) as unknown as {
      definitions: { guides: { geometry: { direction: object } }[] }[];
    };
    const line = notUnit.definitions[0]?.guides[0];
    if (!line) throw new Error('expected a guide');
    line.geometry.direction = { x: 0, y: 0, z: 2 };
    expect(restoreSnapshot(notUnit)).toMatchObject({
      ok: false,
      error: expect.stringContaining('invalid-guide'),
    });

    const collision = mutableSnapshot(doc) as unknown as {
      tags: { id: number; name: string; visible: boolean; color: { r: number; g: number; b: number } }[];
      definitions: { guides: { id: number }[] }[];
    };
    const collidingGuide = collision.definitions[0]?.guides[0];
    if (!collidingGuide) throw new Error('expected a guide');
    collision.tags.push({ id: collidingGuide.id, name: 'Clash', visible: true, color: { r: 1, g: 0, b: 0 } });
    expect(restoreSnapshot(collision)).toMatchObject({
      ok: false,
      error: expect.stringContaining('more than once'),
    });
  });

  it('keeps allocating ids above every restored id', () => {
    const restored = roundTrip(richDocument());
    const nextBefore = restored.ids.next;
    const { createdEdges } = draw(restored, [segment([20, 0, 0], [21, 0, 0])]);
    expect(createdEdges[0]).toBeGreaterThanOrEqual(nextBefore);
  });

  it('changes the hash on edits and restores it on undo', () => {
    const doc = richDocument();
    const before = hashDocument(doc);
    draw(doc, [segment([30, 0, 0], [31, 0, 0])]);
    expect(hashDocument(doc)).not.toBe(before);
    doc.undo();
    expect(hashDocument(doc)).toBe(before);
  });

  it('rejects input that is not a Planar snapshot', () => {
    expect(restoreSnapshot(null)).toMatchObject({ ok: false });
    expect(restoreSnapshot({ format: 'other', version: 1 })).toMatchObject({
      ok: false,
      error: 'This is not a Planar document',
    });
    expect(restoreSnapshot({ format: SNAPSHOT_FORMAT, version: 99 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('Unsupported document version'),
    });
  });

  it('reports structural errors with paths', () => {
    const snapshot = mutableSnapshot(richDocument());
    const [root] = snapshot.definitions;
    if (!root) throw new Error('expected a definition');
    (root.vertices as Record<string, unknown>[])[0] = { id: -4, position: { x: 'a', y: 0, z: 0 } };
    const result = restoreSnapshot(snapshot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('$.definitions[0].vertices[0].id');
      expect(result.error).toContain('$.definitions[0].vertices[0].position.x');
    }
  });

  it('rejects duplicate ids, ids at or above nextId, and a missing root', () => {
    const doc = richDocument();
    const duplicate = mutableSnapshot(doc);
    const tags = duplicate.tags as { id: number }[];
    const materials = duplicate.materials as { id: number }[];
    if (tags[0] && materials[0]) tags[0].id = materials[0].id;
    expect(restoreSnapshot(duplicate)).toMatchObject({
      ok: false,
      error: expect.stringContaining('more than once'),
    });

    const tooHigh = mutableSnapshot(doc);
    tooHigh.nextId = 2;
    expect(restoreSnapshot(tooHigh)).toMatchObject({
      ok: false,
      error: expect.stringContaining('not below nextId'),
    });

    const noRoot = mutableSnapshot(doc);
    noRoot.rootDefinitionId = 999_999;
    expect(restoreSnapshot(noRoot)).toMatchObject({
      ok: false,
      error: expect.stringContaining('root definition'),
    });
  });

  it('rejects snapshots whose geometry breaks kernel invariants', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const snapshot = mutableSnapshot(doc) as Record<string, unknown> & {
      definitions: { faces: Record<string, unknown>[] }[];
    };
    const root = snapshot.definitions[0];
    const face = root?.faces[0];
    if (!root || !face) throw new Error('expected a face');
    const nextId = snapshot.nextId as number;
    root.faces.push({ ...face, id: nextId });
    snapshot.nextId = nextId + 1;
    const result = restoreSnapshot(snapshot);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('overlapping-faces') });
  });

  it('rejects references to entities that do not exist', () => {
    const doc = newDocument();
    draw(doc, [segment([0, 0, 0], [1, 0, 0])]);
    const snapshot = mutableSnapshot(doc) as unknown as { definitions: { edges: { v1: number }[] }[] };
    const edge = snapshot.definitions[0]?.edges[0];
    if (edge) edge.v1 = 12345;
    expect(restoreSnapshot(snapshot)).toMatchObject({
      ok: false,
      error: expect.stringContaining('does not exist'),
    });
  });

  it('restores an empty document', () => {
    const restored = roundTrip(newDocument());
    expect(counts(restored)).toEqual({ v: 0, e: 0, f: 0 });
  });
});
