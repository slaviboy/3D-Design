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
import type { Editor } from '../../src/app/Editor';
import { OFFSET_TOOL_ID } from '../../src/app/tools/OffsetTool';
import type { FaceId } from '../../src/kernel/ids';
import { vec3 } from '../../src/kernel/math/vec3';
import { validateDocument } from '../../src/kernel/model/validate';
import { pushPull } from '../../src/kernel/ops/pushPull';
import { counts, draw, rectangle } from '../kernel/helpers';
import { click, createTestEditor, screenOf } from './fixtures';

const key = (value: string) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
});

function type(editor: Editor, text: string): void {
  for (const character of text) expect(editor.handleKey(key(character))).toBe(true);
  expect(editor.handleKey(key('Enter'))).toBe(true);
  expect(editor.notifications.filter((n) => n.kind === 'error')).toEqual([]);
}

function hasVertexNear(editor: Editor, x: number, y: number): boolean {
  return [...editor.session.doc.rootStore.vertices()].some(
    (vertex) => Math.abs(vertex.position.x - x) < 1e-6 && Math.abs(vertex.position.y - y) < 1e-6,
  );
}

describe('Offset tool', () => {
  it('offsets a face inward by a typed distance and retypes it', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(-4, -4, 4, 4));
    editor.activateTool(OFFSET_TOOL_ID);
    const press = screenOf(-3, 1);
    click(editor, press.x, press.y);
    type(editor, '1m');
    expect(counts(doc)).toEqual({ v: 8, e: 8, f: 2 });
    expect(hasVertexNear(editor, -3, -3)).toBe(true);

    type(editor, '2m');
    expect(counts(doc)).toEqual({ v: 8, e: 8, f: 2 });
    expect(hasVertexNear(editor, -2, -2)).toBe(true);
    expect(doc.undoDepth).toBe(2);
    expect(validateDocument(doc).problems).toEqual([]);
  });
});

describe('curve commands', () => {
  it('divides an edge through the input dialog, welds the parts and explodes the curve', async () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    const [edge] = draw(doc, [{ a: vec3(0, 0, 0), b: vec3(3, 0, 0) }]).createdEdges;
    editor.session.setSelection(editor.session.selection.union([{ kind: 'edge', id: edge ?? 0 }]));

    await editor.runCommand('edit.divide');
    expect(editor.inputRequest?.label).toBe('Number of segments');
    editor.resolveInput('3');
    expect(editor.inputRequest).toBeNull();
    expect(counts(doc)).toEqual({ v: 4, e: 3, f: 0 });
    expect(editor.session.selection.count('edge')).toBe(3);

    await editor.runCommand('edit.weld');
    expect(doc.rootStore.curveCount).toBe(1);
    await editor.runCommand('edit.explodeCurve');
    expect(doc.rootStore.curveCount).toBe(0);
    expect(counts(doc)).toEqual({ v: 4, e: 3, f: 0 });
  });

  it('reports invalid input from the dialog without changing the model', async () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    const [edge] = draw(doc, [{ a: vec3(0, 0, 0), b: vec3(3, 0, 0) }]).createdEdges;
    editor.session.setSelection(editor.session.selection.union([{ kind: 'edge', id: edge ?? 0 }]));
    await editor.runCommand('edit.divide');
    editor.resolveInput('one');
    expect(editor.notifications.at(-1)?.kind).toBe('error');
    expect(counts(doc).e).toBe(1);
  });
});

describe('soften by angle', () => {
  it('softens box edges only when the threshold reaches their angle, and shows the panel on request', async () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(0, 0, 1, 1));
    const [ground] = [...doc.rootStore.faces()];
    pushPull(doc, doc.rootDefinitionId, ground?.id as FaceId, -1);
    editor.selectAll();

    const softened = editor.softenSelection({ maxAngleDegrees: 95, softenCoplanar: false, smooth: true });
    expect(softened).toBe(12);
    expect([...doc.rootStore.edges()].every((e) => e.attributes.soft && e.attributes.smooth)).toBe(true);
    editor.softenSelection({ maxAngleDegrees: 45, softenCoplanar: false, smooth: true });
    expect([...doc.rootStore.edges()].some((e) => e.attributes.soft)).toBe(false);

    expect(editor.isPanelOpen('soften')).toBe(false);
    await editor.runCommand('window.soften');
    expect(editor.isPanelOpen('soften')).toBe(true);
  });
});
