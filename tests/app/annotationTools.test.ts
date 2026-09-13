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
import { collectAnnotationLabels } from '../../src/app/annotations/annotationLabels';
import type { Editor } from '../../src/app/Editor';
import { createEditorStore } from '../../src/app/stores/editorStore';
import { DIMENSION_TOOL_ID } from '../../src/app/tools/DimensionTool';
import { TEXT_TOOL_ID } from '../../src/app/tools/TextTool';
import type { VertexId } from '../../src/kernel/ids';
import { vec3 } from '../../src/kernel/math/vec3';
import { moveVertex } from '../../src/kernel/model/mutations';
import { validateDocument } from '../../src/kernel/model/validate';
import { insertCurve } from '../../src/kernel/ops/curves';
import { formatArea, formatLength } from '../../src/kernel/units/units';
import { draw, rectangle } from '../kernel/helpers';
import { click, createTestEditor, pointer, screenOf } from './fixtures';

function clickAt(editor: Editor, x: number, y: number): void {
  const screen = screenOf(x, y);
  click(editor, screen.x, screen.y);
}

function moveTo(editor: Editor, x: number, y: number): void {
  const screen = screenOf(x, y);
  editor.tools.pointerMove(pointer(screen.x, screen.y, { buttons: 0 }));
}

function vertexAt(editor: Editor, x: number, y: number): VertexId {
  const vertex = [...editor.session.doc.rootStore.vertices()].find(
    (v) => Math.abs(v.position.x - x) < 1e-9 && Math.abs(v.position.y - y) < 1e-9,
  );
  if (!vertex) throw new Error('vertex not found');
  return vertex.id;
}

const labels = (editor: Editor) => collectAnnotationLabels(editor.session.doc, editor.units);

describe('Dimension tool', () => {
  it('places a linear dimension that follows the vertices it measures', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(-2, -2, 2, 2));
    editor.activateTool(DIMENSION_TOOL_ID);
    clickAt(editor, -2, -2);
    clickAt(editor, 2, -2);
    moveTo(editor, 0, -3);
    expect(editor.session.preview?.lines).toHaveLength(3);
    clickAt(editor, 0, -3);

    expect(doc.rootStore.annotationCount).toBe(1);
    const [label] = labels(editor);
    expect(label?.text).toBe(formatLength(4, editor.units));
    expect(label?.world?.y).toBeCloseTo(-3);

    doc.transact('Stretch', () => {
      moveVertex(doc, doc.rootDefinitionId, vertexAt(editor, 2, -2), vec3(3, -2, 0));
      moveVertex(doc, doc.rootDefinitionId, vertexAt(editor, 2, 2), vec3(3, 2, 0));
    });
    expect(labels(editor)[0]?.text).toBe(formatLength(5, editor.units));
    expect(validateDocument(doc).problems).toEqual([]);
  });

  it('dimensions a circle by its diameter', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    insertCurve(doc, doc.rootDefinitionId, {
      kind: 'circle',
      center: vec3(0, 0, 0),
      normal: vec3(0, 0, 1),
      xAxis: vec3(1, 0, 0),
      radius: 3,
      segments: 12,
    });
    editor.activateTool(DIMENSION_TOOL_ID);
    clickAt(editor, (3 + 3 * Math.cos(Math.PI / 6)) / 2, (3 * Math.sin(Math.PI / 6)) / 2);
    clickAt(editor, 4, 4);
    expect(labels(editor)[0]?.text).toBe(`Ø ${formatLength(6, editor.units)}`);
  });
});

describe('Text tool', () => {
  it('places leader text that starts as the face area, and screen text', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 3));
    editor.activateTool(TEXT_TOOL_ID);
    clickAt(editor, 2, 2);
    moveTo(editor, 4, 4);
    clickAt(editor, 4, 4);
    expect(editor.inputRequest?.initial).toBe(formatArea(4, editor.units));
    editor.resolveInput('Roof');
    expect(labels(editor).map((label) => label.text)).toEqual(['Roof']);
    expect(labels(editor)[0]?.world?.x).toBeCloseTo(4);

    clickAt(editor, -4, 4);
    expect(editor.inputRequest?.title).toBe('Screen Text');
    editor.resolveInput('Front view');
    const screenText = labels(editor).find((label) => label.kind === 'screen-text');
    expect(screenText?.screen?.x).toBeCloseTo(screenOf(-4, 4).x / 200);
    expect(doc.undoDepth).toBe(3);
  });

  it('edits dimension text, restores the measurement, and deletes text labels', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(-2, -2, 2, 2));
    editor.activateTool(DIMENSION_TOOL_ID);
    clickAt(editor, -2, -2);
    clickAt(editor, 2, -2);
    clickAt(editor, 0, -3);
    const [dimension] = labels(editor);
    if (!dimension) throw new Error('no dimension');

    editor.editAnnotation(dimension.context, dimension.id);
    editor.resolveInput('Width');
    expect(labels(editor)[0]?.text).toBe('Width');
    editor.editAnnotation(dimension.context, dimension.id);
    editor.resolveInput('');
    expect(labels(editor)[0]?.text).toBe(formatLength(4, editor.units));

    editor.activateTool(TEXT_TOOL_ID);
    clickAt(editor, 0, 0.5);
    clickAt(editor, 1, 3);
    editor.resolveInput('Note');
    const note = labels(editor).find((label) => label.text === 'Note');
    if (!note) throw new Error('no note');
    editor.editAnnotation(note.context, note.id);
    editor.resolveInput('  ');
    expect(labels(editor).some((label) => label.text === 'Note')).toBe(false);
    expect(doc.rootStore.annotationCount).toBe(1);
  });

  it('projects labels into the view state', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(-2, -2, 2, 2));
    editor.activateTool(DIMENSION_TOOL_ID);
    clickAt(editor, -2, -2);
    clickAt(editor, 2, -2);
    clickAt(editor, 0, -3);
    const store = createEditorStore(editor);
    const [label] = store.getState().annotationLabels;
    expect(label?.x).toBeCloseTo(screenOf(0, -3).x);
    expect(label?.y).toBeCloseTo(screenOf(0, -3).y);
    store.dispose();
  });
});
