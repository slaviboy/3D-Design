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
import type { DefinitionId, InstanceId } from '../../../src/kernel/ids';
import { scaling, transformPoint, translation } from '../../../src/kernel/math/mat4';
import { vec3, ZERO } from '../../../src/kernel/math/vec3';
import type { EntityStore } from '../../../src/kernel/model/EntityStore';
import type { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import { addInstance, setInstanceTransform } from '../../../src/kernel/model/mutations';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import {
  explodeInstance,
  makeComponent,
  makeGroup,
  makeUnique,
  type EntitySelection,
} from '../../../src/kernel/ops/hierarchy';
import {
  boxEdges,
  counts,
  draw,
  expectValid,
  newDocument,
  orientationConsistent,
  rectangle,
  segment,
} from '../helpers';

function everything(store: EntityStore): EntitySelection {
  return {
    faces: [...store.faces()].map((face) => face.id),
    edges: [...store.edges()].map((edge) => edge.id),
    instances: [...store.instances()].map((instance) => instance.id),
  };
}

function onlyInstance(store: EntityStore): InstanceId {
  const [instance] = [...store.instances()];
  if (!instance) throw new Error('expected an instance');
  return instance.id;
}

function componentWithThreeInstances(doc: ModelDocument): {
  definition: DefinitionId;
  instances: InstanceId[];
} {
  draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
  const { definition, instance } = makeComponent(doc, doc.rootDefinitionId, everything(doc.rootStore));
  const copies = doc.transact('Copy', () => [
    addInstance(doc, doc.rootDefinitionId, definition, translation(vec3(3, 0, 0))),
    addInstance(doc, doc.rootDefinitionId, definition, translation(vec3(6, 0, 0))),
  ]);
  return { definition, instances: [instance, ...copies] };
}

/** Rows G1–G7 and A20 of docs/BEHAVIOR_MATRIX.md. */
describe('behavior matrix G: groups and components', () => {
  it('drawing the twelve edges of a box creates six consistently oriented faces', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expect(orientationConsistent(doc.rootStore)).toBe(true);
  });

  it('G1: Make Group moves the selected geometry into a new group definition', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const { definition } = makeGroup(doc, doc.rootDefinitionId, everything(doc.rootStore));
    expect(counts(doc)).toEqual({ v: 0, e: 0, f: 0 });
    expect(counts(doc, definition)).toEqual({ v: 8, e: 12, f: 6 });
    expect(doc.rootStore.instanceCount).toBe(1);
    expect(doc.getDefinition(definition).attributes).toEqual({ name: 'Group', isGroup: true });
  });

  it('grouping one face leaves behind an edge that still bounds another face', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const [first] = [...doc.rootStore.faces()];
    draw(doc, rectangle(1, 0, 2, 1));
    const { definition } = makeGroup(doc, doc.rootDefinitionId, { faces: first ? [first.id] : [] });
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
    expect(counts(doc, definition)).toEqual({ v: 4, e: 4, f: 1 });
  });

  it('G2: exploding a group merges its geometry back and deletes the group definition', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const { definition, instance } = makeGroup(doc, doc.rootDefinitionId, everything(doc.rootStore));
    explodeInstance(doc, doc.rootDefinitionId, instance);
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expect(doc.definition(definition)).toBeUndefined();
    expect(orientationConsistent(doc.rootStore)).toBe(true);
  });

  it('exploding a moved group merges it with the geometry it now touches', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    draw(doc, rectangle(10, 0, 11, 1));
    const loose = [...doc.rootStore.faces()].find((face) => doc.rootStore.faceBounds(face.id).minX >= 10);
    const moved = makeGroup(doc, doc.rootDefinitionId, { faces: loose ? [loose.id] : [] });
    doc.transact('Move', () => {
      setInstanceTransform(doc, doc.rootDefinitionId, moved.instance, translation(vec3(-9, 0, 0)));
    });
    explodeInstance(doc, doc.rootDefinitionId, moved.instance);
    expect(counts(doc)).toEqual({ v: 6, e: 7, f: 2 });
    expect(orientationConsistent(doc.rootStore)).toBe(true);
  });

  it('exploding a mirrored group keeps faces pointing outward', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const bottomNormalZ = [...doc.rootStore.faces()]
      .map((face) => face.plane)
      .find((plane) => plane !== null && Math.abs(plane.offset) < 1e-9 && Math.abs(plane.normal.z) > 0.5)
      ?.normal.z;
    const { instance } = makeGroup(doc, doc.rootDefinitionId, everything(doc.rootStore));
    doc.transact('Mirror', () => {
      setInstanceTransform(doc, doc.rootDefinitionId, instance, scaling(vec3(-1, 1, 1)));
    });
    explodeInstance(doc, doc.rootDefinitionId, instance);
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    const mirroredBottom = [...doc.rootStore.faces()]
      .map((face) => face.plane)
      .find((plane) => plane !== null && Math.abs(plane.offset) < 1e-9 && Math.abs(plane.normal.z) > 0.5);
    expect(Math.sign(mirroredBottom?.normal.z ?? 0)).toBe(Math.sign(bottomNormalZ ?? 0));
  });

  it('G3: component instances share one definition', () => {
    const doc = newDocument();
    const { definition } = componentWithThreeInstances(doc);
    expect(doc.instancesOf(definition)).toHaveLength(3);
    expect(doc.getDefinition(definition).attributes).toEqual({ name: 'Component#1', isGroup: false });
  });

  it('G4: editing the definition changes every instance', () => {
    const doc = newDocument();
    const { definition } = componentWithThreeInstances(doc);
    draw(doc, [segment([0, 0, 1], [1, 1, 1])], definition);
    expect(counts(doc, definition)).toEqual({ v: 8, e: 13, f: 7 });
    expect(doc.instancesOf(definition).every(({ instance }) => instance.definitionId === definition)).toBe(
      true,
    );
  });

  it('G5: Make Unique gives one instance its own definition', () => {
    const doc = newDocument();
    const { definition, instances } = componentWithThreeInstances(doc);
    const unique = makeUnique(doc, doc.rootDefinitionId, instances[1] as InstanceId);
    expect(unique).not.toBe(definition);
    expect(doc.getDefinition(unique).attributes.name).toBe('Component#2');
    expect(counts(doc, unique)).toEqual({ v: 8, e: 12, f: 6 });
    draw(doc, [segment([0, 0, 1], [1, 1, 1])], unique);
    expect(counts(doc, unique).f).toBe(7);
    expect(counts(doc, definition).f).toBe(6);
    expect(doc.rootStore.getInstance(instances[1] as InstanceId).definitionId).toBe(unique);
  });

  it('Make Unique on the only instance keeps its definition', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const { definition, instance } = makeComponent(doc, doc.rootDefinitionId, everything(doc.rootStore));
    const depth = doc.undoDepth;
    expect(makeUnique(doc, doc.rootDefinitionId, instance)).toBe(definition);
    expect(doc.undoDepth).toBe(depth);
  });

  it('G6: exploding a component places its nested instances with composed transforms', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const group = makeGroup(doc, doc.rootDefinitionId, everything(doc.rootStore));
    const component = makeComponent(doc, doc.rootDefinitionId, { instances: [group.instance] });
    expect(counts(doc, component.definition)).toEqual({ v: 0, e: 0, f: 0 });
    expect(doc.store(component.definition).instanceCount).toBe(1);
    doc.transact('Move', () => {
      setInstanceTransform(doc, doc.rootDefinitionId, component.instance, translation(vec3(10, 0, 0)));
    });
    explodeInstance(doc, doc.rootDefinitionId, component.instance);
    const nested = doc.rootStore.getInstance(onlyInstance(doc.rootStore));
    expect(nested.definitionId).toBe(group.definition);
    expect(transformPoint(nested.transform, ZERO)).toEqual(vec3(10, 0, 0));
    expect(doc.definition(component.definition)).toBeDefined();
  });

  it('G7: undoing Make Group restores the exact previous document, and redo reapplies it', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const before = hashDocument(doc);
    makeGroup(doc, doc.rootDefinitionId, everything(doc.rootStore));
    const after = hashDocument(doc);
    doc.undo();
    expect(hashDocument(doc)).toBe(before);
    doc.redo();
    expect(hashDocument(doc)).toBe(after);
    expectValid(doc);
  });

  it('A20: a rectangle drawn over a group face from outside the group does not split it', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 2));
    const { definition } = makeGroup(doc, doc.rootDefinitionId, everything(doc.rootStore));
    draw(doc, rectangle(0.5, 0.5, 1.5, 1.5));
    expect(counts(doc, definition)).toEqual({ v: 4, e: 4, f: 1 });
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
  });

  it('rejects an empty selection without creating history', () => {
    const doc = newDocument();
    expect(() => makeGroup(doc, doc.rootDefinitionId, {})).toThrow(KernelError);
    expect(doc.undoDepth).toBe(0);
    expect([...doc.definitions()]).toHaveLength(1);
  });

  it('rejects placing a definition inside itself', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const { definition } = makeComponent(doc, doc.rootDefinitionId, everything(doc.rootStore));
    expect(() => doc.transact('Nest', () => addInstance(doc, definition, definition))).toThrow(KernelError);
  });
});
