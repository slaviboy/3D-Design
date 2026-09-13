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
import type { SectionPlaneId } from '../../../src/kernel/ids';
import { vec3 } from '../../../src/kernel/math/vec3';
import {
  addSectionPlane,
  removeSectionPlane,
  setActiveSectionPlane,
  updateSectionPlane,
} from '../../../src/kernel/model/mutations';
import { createSnapshot, hashDocument, restoreSnapshot } from '../../../src/kernel/model/snapshot';
import { validateDocument } from '../../../src/kernel/model/validate';
import { deleteInstances, makeGroup } from '../../../src/kernel/ops/hierarchy';
import { boxEdges, draw, expectValid, newDocument } from '../helpers';

function activeIds(doc: ReturnType<typeof newDocument>): SectionPlaneId[] {
  return [...doc.rootStore.sectionPlanes()].filter((plane) => plane.active).map((plane) => plane.id);
}

describe('section planes', () => {
  it('are left out of snapshots of contexts without them', () => {
    const doc = newDocument();
    expect(createSnapshot(doc).definitions[0]?.sectionPlanes).toBeUndefined();
    expect(doc.rootStore.isEmpty).toBe(true);
  });

  it('are added with a normalized normal, and undo and redo restore the exact document', () => {
    const doc = newDocument();
    const empty = hashDocument(doc);
    const id = doc.transact('Place Section', () =>
      addSectionPlane(doc, doc.rootDefinitionId, {
        name: 'Section 1',
        point: vec3(1, 2, 3),
        normal: vec3(0, 0, 5),
      }),
    );
    const plane = doc.rootStore.getSectionPlane(id);
    expect(plane.normal).toEqual(vec3(0, 0, 1));
    expect(plane.active).toBe(false);
    expect(doc.rootStore.isEmpty).toBe(false);
    const placed = hashDocument(doc);
    expect(placed).not.toBe(empty);

    doc.undo();
    expect(hashDocument(doc)).toBe(empty);
    doc.redo();
    expect(hashDocument(doc)).toBe(placed);
  });

  it('keep at most one active plane per context', () => {
    const doc = newDocument();
    const context = doc.rootDefinitionId;
    const [a, b] = doc.transact('Place', () => [
      addSectionPlane(doc, context, { name: 'A', point: vec3(0, 0, 1), normal: vec3(0, 0, 1), active: true }),
      addSectionPlane(doc, context, { name: 'B', point: vec3(0, 0, 2), normal: vec3(0, 0, 1), active: true }),
    ]);
    expect(activeIds(doc)).toEqual([b]);
    const beforeSwitch = hashDocument(doc);

    doc.transact('Activate', () => {
      updateSectionPlane(doc, context, a, { active: true });
    });
    expect(activeIds(doc)).toEqual([a]);
    expectValid(doc);
    doc.undo();
    expect(hashDocument(doc)).toBe(beforeSwitch);

    doc.transact('Deactivate', () => {
      setActiveSectionPlane(doc, context, null);
    });
    expect(activeIds(doc)).toEqual([]);
  });

  it('reverse, rename and delete undoably, and refuse invalid geometry', () => {
    const doc = newDocument();
    const context = doc.rootDefinitionId;
    const id = doc.transact('Place', () =>
      addSectionPlane(doc, context, { name: 'A', point: vec3(0, 0, 0), normal: vec3(1, 0, 0) }),
    );
    doc.transact('Reverse', () => {
      updateSectionPlane(doc, context, id, { normal: vec3(-1, 0, 0), name: 'Flipped' });
    });
    expect(doc.rootStore.getSectionPlane(id)).toMatchObject({ name: 'Flipped', normal: vec3(-1, 0, 0) });
    const depth = doc.undoDepth;
    doc.transact('Nothing', () => {
      updateSectionPlane(doc, context, id, { name: 'Flipped' });
    });
    expect(doc.undoDepth).toBe(depth);

    expect(() => {
      doc.transact('Bad', () => {
        updateSectionPlane(doc, context, id, { normal: vec3(0, 0, 0) });
      });
    }).toThrow(KernelError);
    expect(() =>
      doc.transact('Bad', () =>
        addSectionPlane(doc, context, { name: 'X', point: vec3(Number.NaN, 0, 0), normal: vec3(1, 0, 0) }),
      ),
    ).toThrow(KernelError);

    doc.transact('Delete', () => {
      removeSectionPlane(doc, context, id);
    });
    expect(doc.rootStore.sectionPlaneCount).toBe(0);
    doc.undo();
    expect(doc.rootStore.getSectionPlane(id).name).toBe('Flipped');
  });

  it('are deleted with the group that contains them', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const faces = [...doc.rootStore.faces()].map((face) => face.id);
    const { definition, instance } = makeGroup(doc, doc.rootDefinitionId, { faces });
    doc.transact('Place', () =>
      addSectionPlane(doc, definition, {
        name: 'Inner',
        point: vec3(0, 0, 0.5),
        normal: vec3(0, 0, 1),
        active: true,
      }),
    );
    deleteInstances(doc, doc.rootDefinitionId, [instance]);
    expect(doc.definition(definition)).toBeUndefined();
    expectValid(doc);
  });

  it('survive a snapshot round trip, and corrupt planes are rejected', () => {
    const doc = newDocument();
    doc.transact('Place', () => {
      addSectionPlane(doc, doc.rootDefinitionId, {
        name: 'Cut',
        point: vec3(1, 1, 1),
        normal: vec3(1, 1, 0),
        active: true,
      });
    });
    const snapshot = createSnapshot(doc);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(hashDocument(restored.value)).toBe(hashDocument(doc));

    const [root] = snapshot.definitions;
    const plane = root?.sectionPlanes?.[0];
    if (!root || !plane) throw new Error('expected a section plane');
    const withNormal = (normal: { x: number; y: number; z: number }) => ({
      ...snapshot,
      definitions: [{ ...root, sectionPlanes: [{ ...plane, normal }] }],
    });
    expect(restoreSnapshot(JSON.parse(JSON.stringify(withNormal({ x: 0, y: 0, z: 2 })))).ok).toBe(false);

    const twoActive = {
      ...snapshot,
      nextId: snapshot.nextId + 1,
      definitions: [{ ...root, sectionPlanes: [plane, { ...plane, id: snapshot.nextId }] }],
    };
    const result = restoreSnapshot(JSON.parse(JSON.stringify(twoActive)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/multiple-active-sections/);
    expect(validateDocument(doc).ok).toBe(true);
  });
});
