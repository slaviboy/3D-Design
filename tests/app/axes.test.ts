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
import { AXES_TOOL_ID } from '../../src/app/tools/AxesTool';
import { LINE_TOOL_ID, RECTANGLE_TOOL_ID } from '../../src/app/tools/Tool';
import { vec3 } from '../../src/kernel/math/vec3';
import { setModelAxes } from '../../src/kernel/model/mutations';
import { DEFAULT_MODEL_AXES } from '../../src/kernel/model/types';
import { validateDocument } from '../../src/kernel/model/validate';
import { counts } from '../kernel/helpers';
import { click, createTestEditor, pointer, screenOf } from './fixtures';

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

function clickAt(editor: Editor, x: number, y: number): void {
  const screen = screenOf(x, y);
  click(editor, screen.x, screen.y);
}

function moveTo(editor: Editor, x: number, y: number): void {
  const screen = screenOf(x, y);
  editor.tools.pointerMove(pointer(screen.x, screen.y, { buttons: 0 }));
}

/** Axes at (1, 1) turned 45° about blue. */
function rotatedAxesEditor(): Editor {
  const editor = createTestEditor();
  const doc = editor.session.doc;
  doc.transact('Place Axes', () => {
    setModelAxes(doc, { origin: vec3(1, 1, 0), xAxis: vec3(1, 1, 0), yAxis: vec3(-1, 1, 0) });
  });
  return editor;
}

function hasVertexNear(editor: Editor, x: number, y: number): boolean {
  return [...editor.session.doc.rootStore.vertices()].some(
    (vertex) => Math.abs(vertex.position.x - x) < 1e-6 && Math.abs(vertex.position.y - y) < 1e-6,
  );
}

describe('drawing axes', () => {
  it('drive the origin, axis inferences and axis colors', () => {
    const editor = rotatedAxesEditor();
    editor.activateTool(LINE_TOOL_ID);
    moveTo(editor, 1.1, 0.95);
    expect(editor.session.preview?.marker?.label).toBe('Origin');
    clickAt(editor, 1, 1);
    moveTo(editor, 3, 3.05);
    expect(editor.session.preview?.marker?.label).toBe('On Red Axis');
    expect(editor.session.preview?.lines[0]?.style).toBe('axis-x');
    clickAt(editor, 3, 3.05);
    expect(hasVertexNear(editor, 3.025, 3.025)).toBe(true);
  });

  it('turn arrow-key locks and typed coordinates with them', () => {
    const editor = rotatedAxesEditor();
    editor.activateTool(LINE_TOOL_ID);
    clickAt(editor, 1, 1);
    expect(editor.handleKey(key('ArrowLeft'))).toBe(true);
    moveTo(editor, -1, 3);
    expect(editor.session.preview?.marker?.label).toBe('On Green Axis');
    expect(editor.handleKey(key('ArrowLeft'))).toBe(true);
    type(editor, `[${String(Math.SQRT2)}m,0,0]`);
    expect(hasVertexNear(editor, 2, 2)).toBe(true);
  });

  it('align rectangles with the red and green directions', () => {
    const editor = rotatedAxesEditor();
    editor.activateTool(RECTANGLE_TOOL_ID);
    clickAt(editor, 1, 1);
    clickAt(editor, 1, 3);
    expect(counts(editor.session.doc)).toEqual({ v: 4, e: 4, f: 1 });
    expect(hasVertexNear(editor, 2, 2)).toBe(true);
    expect(hasVertexNear(editor, 0, 2)).toBe(true);
    expect(validateDocument(editor.session.doc).ok).toBe(true);
  });

  it('are placed with the Axes tool, undone, and reset', async () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.activateTool(AXES_TOOL_ID);
    clickAt(editor, 2, 2);
    clickAt(editor, 4, 2);
    clickAt(editor, 2, 5);
    expect(doc.axes.origin.x).toBeCloseTo(2, 9);
    expect(doc.axes.origin.y).toBeCloseTo(2, 9);
    expect(doc.axes.origin.z).toBeCloseTo(0, 9);
    expect(doc.axes.xAxis.x).toBeCloseTo(1);
    expect(doc.axes.yAxis.y).toBeCloseTo(1);
    expect(doc.undoLabel).toBe('Place Axes');

    editor.undo();
    expect(doc.axes).toEqual(DEFAULT_MODEL_AXES);
    editor.redo();
    expect(editor.commands.isEnabled('axes.reset', editor)).toBe(true);
    await editor.runCommand('axes.reset');
    expect(doc.axes).toEqual(DEFAULT_MODEL_AXES);
    expect(editor.commands.isEnabled('axes.reset', editor)).toBe(false);
  });
});
