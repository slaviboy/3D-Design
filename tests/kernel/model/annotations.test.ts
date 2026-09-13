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
import type { VertexId } from '../../../src/kernel/ids';
import { vec3 } from '../../../src/kernel/math/vec3';
import {
  addAnnotation,
  moveVertex,
  removeAnnotation,
  updateAnnotation,
} from '../../../src/kernel/model/mutations';
import { createSnapshot, hashDocument, restoreSnapshot } from '../../../src/kernel/model/snapshot';
import { validateDocument } from '../../../src/kernel/model/validate';
import { resolveAnnotation } from '../../../src/kernel/ops/annotations';
import { insertCurve } from '../../../src/kernel/ops/curves';
import { draw, newDocument, rectangle } from '../helpers';

function vertexAt(doc: ReturnType<typeof newDocument>, x: number, y: number): VertexId {
  const vertex = [...doc.rootStore.vertices()].find((v) => v.position.x === x && v.position.y === y);
  if (!vertex) throw new Error('vertex not found');
  return vertex.id;
}

describe('annotations', () => {
  it('follow the vertices a linear dimension is anchored to', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    const context = doc.rootDefinitionId;
    const a = vertexAt(doc, 0, 0);
    const b = vertexAt(doc, 2, 0);
    const id = doc.transact('Dimension', () =>
      addAnnotation(doc, context, {
        kind: 'linear-dimension',
        start: { point: vec3(0, 0, 0), vertex: a },
        end: { point: vec3(2, 0, 0), vertex: b },
        offset: vec3(0, -0.5, 0),
      }),
    );
    const resolve = () => resolveAnnotation(doc.rootStore, doc.rootStore.getAnnotation(id));
    expect(resolve().value).toBeCloseTo(2);
    expect(resolve().labelPoint).toEqual(vec3(1, -0.5, 0));

    doc.transact('Move', () => {
      moveVertex(doc, context, b, vec3(3, 0, 0));
      moveVertex(doc, context, vertexAt(doc, 2, 1), vec3(3, 1, 0));
    });
    expect(resolve().value).toBeCloseTo(3);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('measure radius or diameter of a curve and fall back when the curve is gone', () => {
    const doc = newDocument();
    const context = doc.rootDefinitionId;
    const { curve } = insertCurve(doc, context, {
      kind: 'circle',
      center: vec3(0, 0, 0),
      normal: vec3(0, 0, 1),
      xAxis: vec3(1, 0, 0),
      radius: 1.5,
      segments: 24,
    });
    if (curve === null) throw new Error('curve not created');
    const id = doc.transact('Dimension', () =>
      addAnnotation(doc, context, {
        kind: 'radial-dimension',
        curve,
        diameter: true,
        labelPoint: vec3(3, 0, 0),
      }),
    );
    const resolved = resolveAnnotation(doc.rootStore, doc.rootStore.getAnnotation(id));
    expect(resolved.value).toBeCloseTo(3);
    expect(resolved.lines[0]?.[0].x).toBeCloseTo(-1.5);
  });

  it('are updated and removed as undoable changes and survive snapshots', () => {
    const doc = newDocument();
    const context = doc.rootDefinitionId;
    const empty = hashDocument(doc);
    expect(createSnapshot(doc).definitions[0]?.annotations).toBeUndefined();

    const id = doc.transact('Text', () =>
      addAnnotation(
        doc,
        context,
        { kind: 'leader-text', target: { point: vec3(1, 1, 0), vertex: null }, offset: vec3(1, 1, 1) },
        { text: 'Roof', hidden: false, tagId: null },
      ),
    );
    doc.transact('Edit Text', () => {
      updateAnnotation(doc, context, id, { attributes: { text: 'Metal roof' } });
    });
    doc.transact('Screen Text', () => addAnnotation(doc, context, { kind: 'screen-text', x: 0.1, y: 0.9 }));
    expect(doc.rootStore.getAnnotation(id).attributes.text).toBe('Metal roof');

    const restored = restoreSnapshot(JSON.parse(JSON.stringify(createSnapshot(doc))));
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(hashDocument(restored.value)).toBe(hashDocument(doc));
      expect(restored.value.rootStore.annotationCount).toBe(2);
    }

    doc.undo();
    doc.undo();
    expect(doc.rootStore.getAnnotation(id).attributes.text).toBe('Roof');
    doc.transact('Delete', () => {
      removeAnnotation(doc, context, id);
    });
    expect(doc.rootStore.annotation(id)).toBeUndefined();
    doc.undo();
    doc.undo();
    expect(hashDocument(doc)).toBe(empty);
  });

  it('refuse invalid coordinates', () => {
    const doc = newDocument();
    const context = doc.rootDefinitionId;
    expect(() =>
      doc.transact('Text', () => addAnnotation(doc, context, { kind: 'screen-text', x: 2, y: 0.5 })),
    ).toThrow(KernelError);
    expect(() =>
      doc.transact('Text', () =>
        addAnnotation(doc, context, {
          kind: 'leader-text',
          target: { point: vec3(Number.NaN, 0, 0), vertex: null },
          offset: vec3(0, 0, 0),
        }),
      ),
    ).toThrow(KernelError);
    expect(doc.rootStore.annotationCount).toBe(0);
  });
});
