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

import { describe, expect, it, vi } from 'vitest';
import { KernelError, KernelInvariantError } from '../../../src/kernel/errors';
import type { EdgeId, VertexId } from '../../../src/kernel/ids';
import { vec3 } from '../../../src/kernel/math/vec3';
import { ModelDocument, type DocumentEvent } from '../../../src/kernel/model/ModelDocument';
import {
  addDefinition,
  addEdge,
  addInstance,
  addMaterial,
  addTag,
  addVertex,
  removeDefinition,
  removeMaterial,
  removeVertex,
  reverseFace,
  setEdgeAttributes,
  setMaterialAttributes,
  setTagAttributes,
  splitEdge,
} from '../../../src/kernel/model/mutations';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { insertCurve } from '../../../src/kernel/ops/curves';
import { counts, draw, expectValid, newDocument, rectangle, segment } from '../helpers';

describe('ModelDocument transactions and history', () => {
  it('refuses changes outside a transaction', () => {
    const doc = newDocument();
    expect(() => addVertex(doc, doc.rootDefinitionId, vec3(0, 0, 0))).toThrow(
      expect.objectContaining({ code: 'transaction-required' }),
    );
  });

  it('commits a transaction as one history entry and notifies subscribers', () => {
    const doc = newDocument();
    const events: DocumentEvent[] = [];
    const unsubscribe = doc.subscribe((event) => events.push(event));
    draw(doc, rectangle(0, 0, 1, 1));
    expect(doc.undoDepth).toBe(1);
    expect(doc.undoLabel).toBe('Draw edges');
    expect(events.map((event) => event.kind)).toEqual(['commit']);
    expect(events[0]?.changes.length).toBeGreaterThan(0);
    unsubscribe();
    draw(doc, [segment([5, 5, 0], [6, 5, 0])]);
    expect(events).toHaveLength(1);
  });

  it('nested transactions join the outer transaction', () => {
    const doc = newDocument();
    doc.transact('Outer', () => {
      draw(doc, rectangle(0, 0, 1, 1));
      draw(doc, rectangle(2, 0, 3, 1));
    });
    expect(doc.undoDepth).toBe(1);
    expect(doc.undoLabel).toBe('Outer');
  });

  it('rolls back every change when the transaction throws', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const before = hashDocument(doc);
    expect(() =>
      doc.transact('Broken', () => {
        draw(doc, rectangle(5, 5, 6, 6));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(hashDocument(doc)).toBe(before);
    expect(doc.undoDepth).toBe(1);
  });

  it('rolls back a transaction that breaks invariants when validation is on', () => {
    const doc = newDocument();
    expect(() => {
      doc.transact('Duplicate vertices', () => {
        addVertex(doc, doc.rootDefinitionId, vec3(0, 0, 0));
        addVertex(doc, doc.rootDefinitionId, vec3(0, 0, 0));
      });
    }).toThrow(KernelInvariantError);
    expect(counts(doc)).toEqual({ v: 0, e: 0, f: 0 });
    expect(doc.undoDepth).toBe(0);
  });

  it('does not validate when validation is off', () => {
    const doc = new ModelDocument();
    doc.transact('Duplicate vertices', () => {
      addVertex(doc, doc.rootDefinitionId, vec3(0, 0, 0));
      addVertex(doc, doc.rootDefinitionId, vec3(0, 0, 0));
    });
    expect(counts(doc).v).toBe(2);
  });

  it('undoes and redoes with labels, and a new transaction clears redo', () => {
    const doc = newDocument();
    const empty = hashDocument(doc);
    draw(doc, rectangle(0, 0, 1, 1));
    const drawn = hashDocument(doc);
    expect(doc.undo()).toBe(true);
    expect(hashDocument(doc)).toBe(empty);
    expect(doc.redoLabel).toBe('Draw edges');
    expect(doc.redo()).toBe(true);
    expect(hashDocument(doc)).toBe(drawn);
    doc.undo();
    draw(doc, [segment([0, 0, 0], [1, 1, 0])]);
    expect(doc.canRedo).toBe(false);
    expect(doc.redo()).toBe(false);
    doc.clearHistory();
    expect(doc.undo()).toBe(false);
  });

  it('refuses undo while a transaction is running', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    expect(() => doc.transact('Inner undo', () => doc.undo())).toThrow(
      expect.objectContaining({ code: 'transaction-active' }),
    );
  });

  it('rolls back the last transaction without making it redoable', () => {
    const doc = newDocument();
    const events: DocumentEvent[] = [];
    doc.subscribe((event) => events.push(event));
    draw(doc, rectangle(0, 0, 1, 1));
    expect(doc.lastTransaction?.label).toBe('Draw edges');
    const record = doc.rollbackLastTransaction();
    expect(record?.label).toBe('Draw edges');
    expect(counts(doc)).toEqual({ v: 0, e: 0, f: 0 });
    expect(doc.canRedo).toBe(false);
    expect(events.map((event) => event.kind)).toEqual(['commit', 'rollback']);
    expect(doc.rollbackLastTransaction()).toBeUndefined();
  });

  it('keeps at most historyLimit transactions', () => {
    const doc = new ModelDocument({ historyLimit: 2 });
    for (let i = 0; i < 3; i++) draw(doc, [segment([i, 0, 0], [i, 1, 0])]);
    expect(doc.undoDepth).toBe(2);
    expect(() => new ModelDocument({ historyLimit: -1 })).toThrow(KernelError);
  });

  it('a change that repeats current values creates no history entry', () => {
    const doc = newDocument();
    const { createdEdges } = draw(doc, [segment([0, 0, 0], [1, 0, 0])]);
    const edge = createdEdges[0] as EdgeId;
    doc.transact('No-op', () => {
      setEdgeAttributes(doc, doc.rootDefinitionId, edge, { soft: false });
    });
    expect(doc.undoDepth).toBe(1);
    doc.transact('Soften', () => {
      setEdgeAttributes(doc, doc.rootDefinitionId, edge, { soft: true, smooth: true });
    });
    expect(doc.rootStore.getEdge(edge).attributes.soft).toBe(true);
    doc.undo();
    expect(doc.rootStore.getEdge(edge).attributes.soft).toBe(false);
  });

  it('refuses to remove a vertex still used by an edge, leaving the document unchanged', () => {
    const doc = newDocument();
    draw(doc, [segment([0, 0, 0], [1, 0, 0])]);
    const vertex = [...doc.rootStore.vertices()][0]?.id as VertexId;
    const before = hashDocument(doc);
    expect(() => {
      doc.transact('Remove', () => {
        removeVertex(doc, doc.rootDefinitionId, vertex);
      });
    }).toThrow(KernelError);
    expect(hashDocument(doc)).toBe(before);
  });

  it('rejects duplicate and degenerate edges', () => {
    const doc = newDocument();
    doc.transact('Edges', () => {
      const a = addVertex(doc, doc.rootDefinitionId, vec3(0, 0, 0));
      const b = addVertex(doc, doc.rootDefinitionId, vec3(1, 0, 0));
      addEdge(doc, doc.rootDefinitionId, a, b);
      expect(() => addEdge(doc, doc.rootDefinitionId, b, a)).toThrow(
        expect.objectContaining({ code: 'duplicate-entity' }),
      );
      expect(() => addEdge(doc, doc.rootDefinitionId, a, a)).toThrow(
        expect.objectContaining({ code: 'invalid-geometry' }),
      );
    });
  });

  it('protects definitions that are in use and the root definition', () => {
    const doc = newDocument();
    const definition = doc.transact('Define', () => addDefinition(doc, { name: 'Part', isGroup: false }));
    doc.transact('Place', () => addInstance(doc, doc.rootDefinitionId, definition));
    expect(() => {
      doc.transact('Remove', () => {
        removeDefinition(doc, definition);
      });
    }).toThrow(KernelError);
    expect(() => doc.transact('Root', () => addInstance(doc, definition, doc.rootDefinitionId))).toThrow(
      KernelError,
    );
    expect(() => {
      doc.transact('Root', () => {
        removeDefinition(doc, doc.rootDefinitionId);
      });
    }).toThrow(KernelError);
    expect(() => doc.getDefinition(9999 as never)).toThrow(KernelError);
  });

  it('splits a curve edge and keeps face loops and the curve chain valid', () => {
    const doc = newDocument();
    const { curve, edges } = insertCurve(doc, doc.rootDefinitionId, {
      kind: 'circle',
      center: vec3(0, 0, 0),
      normal: vec3(0, 0, 1),
      xAxis: vec3(1, 0, 0),
      radius: 1,
      segments: 8,
    });
    const edge = doc.rootStore.getEdge(edges[3] as EdgeId);
    const a = doc.rootStore.position(edge.v0);
    const b = doc.rootStore.position(edge.v1);
    doc.transact('Split', () => {
      splitEdge(doc, doc.rootDefinitionId, edge.id, vec3((a.x + b.x) / 2, (a.y + b.y) / 2, 0));
    });
    expect(doc.rootStore.getCurve(curve as never).edges).toHaveLength(9);
    expect(counts(doc)).toEqual({ v: 9, e: 9, f: 1 });
    expectValid(doc);
  });

  it('reverses a face', () => {
    const doc = newDocument();
    const { createdFaces } = draw(doc, rectangle(0, 0, 1, 1));
    const face = createdFaces[0];
    if (face === undefined) throw new Error('expected a face');
    doc.transact('Reverse', () => {
      reverseFace(doc, doc.rootDefinitionId, face);
    });
    expect(doc.rootStore.getFacePlane(face).normal.z).toBeCloseTo(1);
  });

  it('adds, updates and removes materials and tags undoably', () => {
    const doc = newDocument();
    const listener = vi.fn();
    doc.subscribe(listener);
    const { material, tag } = doc.transact('Library', () => ({
      material: addMaterial(doc, { name: 'Glass', color: { r: 0.8, g: 0.9, b: 1 }, opacity: 0.4 }),
      tag: addTag(doc, { name: 'Walls', visible: true, color: { r: 1, g: 0, b: 0 } }),
    }));
    doc.transact('Edit', () => {
      setMaterialAttributes(doc, material, { opacity: 0.5 });
      setTagAttributes(doc, tag, { visible: false, color: { r: 1, g: 0, b: 0 } });
    });
    expect(doc.material(material)?.opacity).toBe(0.5);
    expect(doc.tag(tag)?.visible).toBe(false);
    doc.undo();
    expect(doc.material(material)?.opacity).toBe(0.4);
    expect(doc.tag(tag)?.visible).toBe(true);
    doc.transact('Remove', () => {
      removeMaterial(doc, material);
    });
    expect([...doc.materials()]).toHaveLength(0);
    doc.undo();
    expect([...doc.materials()]).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(5);
  });
});
