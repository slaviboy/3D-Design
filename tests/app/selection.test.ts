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
import { describeSelection } from '../../src/app/selection/entityInfo';
import {
  allSelectableRefs,
  connectedGeometry,
  edgeWithAdjacentFaces,
  faceWithBoundaryEdges,
  refExists,
} from '../../src/app/selection/queries';
import { applySelection, Selection, type EntityRef } from '../../src/app/selection/Selection';
import type { EdgeId, FaceId } from '../../src/kernel/ids';
import { setEdgeAttributes, setFaceAttributes } from '../../src/kernel/model/mutations';
import { makeGroup } from '../../src/kernel/ops/hierarchy';
import { METRIC_UNIT_SETTINGS } from '../../src/kernel/units/units';
import { boxEdges, draw, newDocument, rectangle } from '../kernel/helpers';

const face = (id: number): EntityRef => ({ kind: 'face', id });
const edge = (id: number): EntityRef => ({ kind: 'edge', id });

describe('Selection', () => {
  it('combines, toggles and compares immutably', () => {
    const a = Selection.of([face(1), edge(2)]);
    expect(a.size).toBe(2);
    expect(a.union([edge(2), face(3)]).size).toBe(3);
    expect(a.subtract([face(1)]).refs()).toEqual([edge(2)]);
    expect(a.toggle([face(1), face(4)]).refs()).toEqual([face(4), edge(2)]);
    expect(a.equals(Selection.of([edge(2), face(1)]))).toBe(true);
    expect(a.filter(() => true)).toBe(a);
    expect(Selection.of([])).toBe(Selection.EMPTY);
    expect(a.ids('face')).toEqual([1]);
    expect(a.count('edge')).toBe(1);
  });

  it('applies selection modes', () => {
    const current = Selection.of([face(1)]);
    expect(applySelection(current, [face(2)], 'replace').refs()).toEqual([face(2)]);
    expect(applySelection(current, [face(2)], 'add').size).toBe(2);
    expect(applySelection(current, [face(1)], 'toggle').isEmpty).toBe(true);
    expect(applySelection(current, [face(1)], 'subtract').isEmpty).toBe(true);
  });
});

describe('selection queries', () => {
  it('expands clicks the way double and triple clicks do', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const store = doc.rootStore;
    const [firstFace] = [...store.faces()];
    const [firstEdge] = [...store.edges()];
    if (!firstFace || !firstEdge) throw new Error('expected geometry');
    expect(faceWithBoundaryEdges(store, firstFace.id)).toHaveLength(5);
    expect(edgeWithAdjacentFaces(store, firstEdge.id)).toHaveLength(3);
    expect(connectedGeometry(store, face(firstFace.id))).toHaveLength(18);
    expect(connectedGeometry(store, { kind: 'instance', id: 99 })).toEqual([{ kind: 'instance', id: 99 }]);
  });

  it('skips hidden and soft entities in Select All and checks existence', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const store = doc.rootStore;
    const [firstEdge, secondEdge] = [...store.edges()];
    const [onlyFace] = [...store.faces()];
    doc.transact('Flags', () => {
      setEdgeAttributes(doc, doc.rootDefinitionId, firstEdge?.id as EdgeId, { hidden: true });
      setEdgeAttributes(doc, doc.rootDefinitionId, secondEdge?.id as EdgeId, { soft: true });
      setFaceAttributes(doc, doc.rootDefinitionId, onlyFace?.id as FaceId, { hidden: true });
    });
    expect(allSelectableRefs(store)).toHaveLength(2);
    expect(refExists(store, face(onlyFace?.id ?? 0))).toBe(true);
    expect(refExists(store, edge(123456))).toBe(false);
    expect(refExists(store, { kind: 'instance', id: 123456 })).toBe(false);
  });
});

describe('Entity Info', () => {
  it('describes an empty selection, a face, an edge, a group and a mixed selection', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    const store = doc.rootStore;
    const context = doc.rootDefinitionId;
    const [onlyFace] = [...store.faces()];
    const [firstEdge] = [...store.edges()];
    if (!onlyFace || !firstEdge) throw new Error('expected geometry');

    expect(describeSelection(doc, context, Selection.EMPTY, METRIC_UNIT_SETTINGS)).toMatchObject({
      title: 'Model',
      rows: [
        { label: 'Faces', value: '1' },
        { label: 'Edges', value: '4' },
        { label: 'Groups and components', value: '0' },
      ],
    });
    expect(
      describeSelection(doc, context, Selection.of([face(onlyFace.id)]), METRIC_UNIT_SETTINGS),
    ).toMatchObject({
      title: 'Face',
      rows: [
        { label: 'Area', value: '2000000mm²' },
        { label: 'Holes', value: '0' },
      ],
    });
    const edgeInfo = describeSelection(
      doc,
      context,
      Selection.of([edge(firstEdge.id)]),
      METRIC_UNIT_SETTINGS,
    );
    expect(edgeInfo.title).toBe('Edge');
    expect(edgeInfo.rows[0]?.label).toBe('Length');
    const mixed = describeSelection(
      doc,
      context,
      Selection.of([face(onlyFace.id), edge(firstEdge.id)]),
      METRIC_UNIT_SETTINGS,
    );
    expect(mixed.title).toBe('2 entities');
    expect(mixed.rows.map((row) => row.label)).toEqual(['Faces', 'Total area', 'Edges', 'Total length']);

    const { instance } = makeGroup(doc, context, { faces: [onlyFace.id] });
    expect(
      describeSelection(
        doc,
        context,
        Selection.of([{ kind: 'instance', id: instance }]),
        METRIC_UNIT_SETTINGS,
      ),
    ).toMatchObject({
      title: 'Group',
      rows: [{ label: 'Contents', value: '1 face, 4 edges' }],
    });
  });
});
