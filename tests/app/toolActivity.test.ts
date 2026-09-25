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
import { Selection } from '../../src/app/selection/Selection';
import { PAINT_TOOL_ID } from '../../src/app/tools/PaintBucketTool';
import { PASTE_TOOL_ID } from '../../src/app/tools/PasteTool';
import { SECTION_PLANE_TOOL_ID } from '../../src/app/tools/SectionPlaneTool';
import {
  LINE_TOOL_ID,
  MOVE_TOOL_ID,
  ORBIT_TOOL_ID,
  PAN_TOOL_ID,
  PUSH_PULL_TOOL_ID,
  RECTANGLE_TOOL_ID,
  SELECT_TOOL_ID,
} from '../../src/app/tools/Tool';
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

const escape = (editor: Editor) =>
  editor.handleKey({ key: 'Escape', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });

describe('what tools report about their state', () => {
  it('is busy while an operation is underway, and not after it ends or is cancelled', () => {
    const editor = createTestEditor();
    editor.activateTool(LINE_TOOL_ID);
    expect(editor.tools.busy).toBe(false);
    clickAt(editor, 0, 0);
    expect(editor.tools.busy).toBe(true);
    escape(editor);
    expect(editor.tools.busy).toBe(false);

    editor.activateTool(RECTANGLE_TOOL_ID);
    clickAt(editor, 0, 0);
    expect(editor.tools.busy).toBe(true);
    clickAt(editor, 1, 1);
    expect(editor.tools.busy).toBe(false);

    draw(editor.session.doc, rectangle(2, 2, 3, 3));
    editor.activateTool(PUSH_PULL_TOOL_ID);
    clickAt(editor, 2.5, 2.5);
    expect(editor.tools.busy).toBe(true);
    escape(editor);
    expect(editor.tools.busy).toBe(false);
  });

  it('is busy only during a press for Select and the navigation tools', () => {
    const editor = createTestEditor();
    const start = screenOf(0, 0);
    editor.tools.pointerDown(pointer(start.x, start.y));
    expect(editor.tools.busy).toBe(true);
    editor.tools.pointerUp(pointer(start.x, start.y, { buttons: 0 }));
    expect(editor.tools.busy).toBe(false);

    editor.activateTool(ORBIT_TOOL_ID);
    editor.tools.pointerDown(pointer(start.x, start.y));
    expect(editor.tools.busy).toBe(true);
    editor.tools.pointerUp(pointer(start.x, start.y, { buttons: 0 }));
    expect(editor.tools.busy).toBe(false);
  });

  it('aims with tools whose press acts at once', () => {
    const editor = createTestEditor();
    for (const toolId of [PAINT_TOOL_ID, SECTION_PLANE_TOOL_ID]) {
      editor.activateTool(toolId);
      expect(editor.tools.aims, toolId).toBe(true);
      expect(editor.tools.busy, toolId).toBe(false);
    }
    for (const toolId of [SELECT_TOOL_ID, LINE_TOOL_ID, MOVE_TOOL_ID, PUSH_PULL_TOOL_ID]) {
      editor.activateTool(toolId);
      expect(editor.tools.aims, toolId).toBe(false);
    }

    draw(editor.session.doc, rectangle(0, 0, 1, 1));
    editor.selectAll();
    editor.copySelection();
    editor.pasteFromClipboard();
    expect(editor.tools.activeToolId).toBe(PASTE_TOOL_ID);
    expect(editor.tools.busy).toBe(true);
    expect(editor.tools.aims).toBe(true);
    // Escape leaves the paste, back to Select.
    escape(editor);
    expect(editor.tools.activeToolId).toBe(SELECT_TOOL_ID);
  });

  it('remembers the kind of pointer used last', () => {
    const editor = createTestEditor();
    expect(editor.pointerKind).toBe('mouse');
    editor.tools.pointerMove(pointer(10, 10, { buttons: 0, pointerType: 'touch' }));
    expect(editor.pointerKind).toBe('touch');
    editor.tools.pointerMove(pointer(10, 10, { buttons: 0, pointerType: 'pen' }));
    expect(editor.pointerKind).toBe('pen');
    editor.tools.pointerMove(pointer(10, 10, { buttons: 0 }));
    expect(editor.pointerKind).toBe('mouse');
  });

  it('snaps from farther away for a finger than for a mouse', () => {
    const editor = createTestEditor();
    draw(editor.session.doc, rectangle(-2, -2, 2, 2));
    editor.activateTool(LINE_TOOL_ID);
    // 15 px from the corner at (2, 2): out of reach for a mouse, within reach for a finger.
    const near = screenOf(2 - 0.75, 2);
    editor.tools.pointerMove(pointer(near.x, near.y, { buttons: 0 }));
    expect(editor.session.preview?.marker?.kind).not.toBe('endpoint');
    editor.tools.pointerMove(pointer(near.x, near.y, { buttons: 0, pointerType: 'touch' }));
    expect(editor.session.preview?.marker?.kind).toBe('endpoint');
  });
});

describe('switching to a tool and back', () => {
  it('sets a line aside while orbiting and continues it afterwards', () => {
    const editor = createTestEditor();
    editor.activateTool(LINE_TOOL_ID);
    clickAt(editor, 0, 0);
    editor.toggleTool(ORBIT_TOOL_ID);
    expect(editor.tools.activeToolId).toBe(ORBIT_TOOL_ID);
    expect(editor.tools.suspendedToolId).toBe(LINE_TOOL_ID);
    // The line being drawn stays in view while the view moves.
    expect(editor.tools.hasOperation).toBe(true);

    editor.toggleTool(ORBIT_TOOL_ID);
    expect(editor.tools.activeToolId).toBe(LINE_TOOL_ID);
    moveTo(editor, 1, 0);
    clickAt(editor, 1, 0);
    expect([...editor.session.doc.rootStore.edges()]).toHaveLength(1);
  });

  it('takes typed lengths for the tool set aside', () => {
    const editor = createTestEditor();
    editor.activateTool(LINE_TOOL_ID);
    clickAt(editor, 0, 0);
    moveTo(editor, 1, 0);
    editor.toggleTool(PAN_TOOL_ID);
    expect(editor.submitMeasurement('3m')).toBe(true);
    const lengths = [...editor.session.doc.rootStore.edges()].map((edge) => {
      const store = editor.session.doc.rootStore;
      const a = store.position(edge.v0);
      const b = store.position(edge.v1);
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    });
    expect(lengths).toEqual([3]);
  });

  it('ends the operation set aside when undoing or choosing another tool', () => {
    const editor = createTestEditor();
    editor.activateTool(LINE_TOOL_ID);
    clickAt(editor, 0, 0);
    editor.toggleTool(ORBIT_TOOL_ID);
    editor.undo();
    expect(editor.tools.hasOperation).toBe(false);

    editor.activateTool(LINE_TOOL_ID);
    clickAt(editor, 0, 0);
    editor.toggleTool(ORBIT_TOOL_ID);
    editor.activateTool(RECTANGLE_TOOL_ID);
    expect(editor.tools.suspendedToolId).toBeNull();
    editor.activateTool(LINE_TOOL_ID);
    expect(editor.tools.busy).toBe(false);
  });

  it('returns to the tool it replaced, and to Select after a placement tool', () => {
    const editor = createTestEditor();
    editor.activateTool(MOVE_TOOL_ID);
    editor.toggleTool(LINE_TOOL_ID);
    expect(editor.tools.activeToolId).toBe(LINE_TOOL_ID);
    editor.toggleTool(LINE_TOOL_ID);
    expect(editor.tools.activeToolId).toBe(MOVE_TOOL_ID);

    draw(editor.session.doc, rectangle(0, 0, 1, 1));
    editor.selectAll();
    editor.copySelection();
    editor.pasteFromClipboard();
    editor.toggleTool(LINE_TOOL_ID);
    editor.toggleTool(LINE_TOOL_ID);
    expect(editor.tools.activeToolId).toBe(SELECT_TOOL_ID);
  });

  it('lends the pointer to another tool for one gesture without disturbing the active one', () => {
    const editor = createTestEditor();
    draw(editor.session.doc, rectangle(0, 0, 1, 1));
    editor.selectAll();
    editor.copySelection();
    editor.pasteFromClipboard();
    editor.session.setSelection(Selection.EMPTY);

    editor.tools.beginTemporary(SELECT_TOOL_ID);
    const from = screenOf(-1, -1);
    const to = screenOf(2, 2);
    editor.tools.pointerDown(pointer(from.x, from.y));
    editor.tools.pointerMove(pointer(to.x, to.y));
    expect(editor.tools.overlay?.kind).toBe('selection-rectangle');
    editor.tools.pointerUp(pointer(to.x, to.y, { buttons: 0 }));
    editor.tools.endTemporary();

    expect(editor.session.selection.isEmpty).toBe(false);
    expect(editor.tools.activeToolId).toBe(PASTE_TOOL_ID);
    expect(editor.tools.busy).toBe(true);
  });
});
