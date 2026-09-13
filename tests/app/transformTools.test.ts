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
import {
  ARC_TOOL_ID,
  arcFromChord,
  arcThroughPoints,
  bulgeForRadius,
  PIE_TOOL_ID,
  THREE_POINT_ARC_TOOL_ID,
  TWO_POINT_ARC_TOOL_ID,
} from '../../src/app/tools/ArcTool';
import { FREEHAND_TOOL_ID } from '../../src/app/tools/FreehandTool';
import { PROTRACTOR_TOOL_ID } from '../../src/app/tools/ProtractorTool';
import { ROTATED_RECTANGLE_TOOL_ID } from '../../src/app/tools/RotatedRectangleTool';
import { ROTATE_TOOL_ID } from '../../src/app/tools/RotateTool';
import { SCALE_TOOL_ID } from '../../src/app/tools/ScaleTool';
import { vec3 } from '../../src/kernel/math/vec3';
import { validateDocument } from '../../src/kernel/model/validate';
import { counts, draw, rectangle } from '../kernel/helpers';
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

type Overrides = Parameters<typeof pointer>[2];

function clickAt(editor: Editor, x: number, y: number, overrides: Overrides = {}): void {
  const screen = screenOf(x, y);
  click(editor, screen.x, screen.y, overrides);
}

function moveTo(editor: Editor, x: number, y: number, overrides: Overrides = {}): void {
  const screen = screenOf(x, y);
  editor.tools.pointerMove(pointer(screen.x, screen.y, { buttons: 0, ...overrides }));
}

function extent(editor: Editor, axis: 'x' | 'y' | 'z') {
  const values = [...editor.session.doc.rootStore.vertices()].map((vertex) => vertex.position[axis]);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function expectValid(editor: Editor): void {
  expect(validateDocument(editor.session.doc).problems).toEqual([]);
  expect(editor.notifications.filter((n) => n.kind === 'error')).toEqual([]);
}

describe('Rotate tool', () => {
  it('rotates about a center by a clicked angle, then by a typed angle', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 3));
    editor.selectAll();
    editor.activateTool(ROTATE_TOOL_ID);
    clickAt(editor, 1, 1);
    clickAt(editor, 3, 1);
    moveTo(editor, 1, 3);
    expect(editor.tools.measurement?.value).toBe('90.0°');
    clickAt(editor, 1, 3);
    expect(extent(editor, 'x').min).toBeCloseTo(-1);
    expect(extent(editor, 'y').max).toBeCloseTo(3);
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });

    type(editor, '45');
    expect(extent(editor, 'y').max).toBeCloseTo(1 + 2 * Math.SQRT2);
    expect(doc.undoDepth).toBe(2);
    expectValid(editor);
  });

  it('makes a radial array from a rotated copy', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(2, -0.5, 3, 0.5));
    editor.selectAll();
    editor.activateTool(ROTATE_TOOL_ID);
    clickAt(editor, 0, 0);
    clickAt(editor, 2.5, 0);
    moveTo(editor, 0, 2.5, { ctrlKey: true });
    clickAt(editor, 0, 2.5, { ctrlKey: true });
    expect(counts(doc).f).toBe(2);
    type(editor, '3x');
    expect(counts(doc)).toEqual({ v: 16, e: 16, f: 4 });
    expect(extent(editor, 'x').min).toBeCloseTo(-3);
    expectValid(editor);
  });
});

describe('Scale tool', () => {
  it('scales with a grip, then by typed factors', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(0, 0, 2, 2));
    editor.selectAll();
    editor.activateTool(SCALE_TOOL_ID);
    clickAt(editor, 2, 2);
    moveTo(editor, 4, 4);
    clickAt(editor, 4, 4);
    expect(extent(editor, 'x')).toMatchObject({ min: 0 });
    expect(extent(editor, 'x').max).toBeCloseTo(4);

    type(editor, '3');
    expect(extent(editor, 'x').max).toBeCloseTo(6);
    type(editor, '1,2');
    expect(extent(editor, 'x').max).toBeCloseTo(2);
    expect(extent(editor, 'y').max).toBeCloseTo(4);
    expect(doc.undoDepth).toBe(2);
    expectValid(editor);
  });

  it('refuses a zero factor', () => {
    const editor = createTestEditor();
    draw(editor.session.doc, rectangle(0, 0, 2, 2));
    editor.selectAll();
    editor.activateTool(SCALE_TOOL_ID);
    clickAt(editor, 2, 2);
    for (const character of '0') editor.handleKey(key(character));
    editor.handleKey(key('Enter'));
    expect(editor.notifications.at(-1)?.kind).toBe('error');
    expect(extent(editor, 'x').max).toBeCloseTo(2);
  });
});

describe('Flip', () => {
  it('mirrors the selection across its center', async () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 2));
    draw(doc, [{ a: vec3(3, 2, 0), b: vec3(4, 2, 0) }]);
    editor.selectAll();
    await editor.runCommand('edit.flipX');
    expect(extent(editor, 'x')).toMatchObject({ min: 1, max: 4 });
    const positions = [...doc.rootStore.vertices()].map((v) => v.position);
    expect(positions.some((p) => Math.abs(p.x - 2) < 1e-9 && Math.abs(p.y - 2) < 1e-9)).toBe(true);
    expect(counts(doc)).toEqual({ v: 5, e: 5, f: 1 });
    expect(doc.undoLabel).toBe('Flip Along Red');
    expectValid(editor);
  });
});

describe('Arc tools', () => {
  it('computes arcs from a chord, three points and a radius', () => {
    const semicircle = arcFromChord(vec3(0, 0, 0), vec3(2, 0, 0), 1, vec3(0, 1, 0));
    expect(semicircle?.radius).toBeCloseTo(1);
    expect(semicircle?.sweep).toBeCloseTo(Math.PI);
    expect(semicircle?.center.x).toBeCloseTo(1);
    const through = arcThroughPoints(vec3(0, 0, 0), vec3(1, 1, 0), vec3(2, 0, 0));
    expect(through?.radius).toBeCloseTo(1);
    expect(through?.sweep).toBeCloseTo(Math.PI);
    expect(arcThroughPoints(vec3(0, 0, 0), vec3(1, 0, 0), vec3(2, 0, 0))).toBeNull();
    expect(bulgeForRadius(2, 1)).toBeCloseTo(1);
    expect(bulgeForRadius(2, 0.5)).toBeNull();
  });

  it('draws a 2-point arc with a bulge', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.activateTool(TWO_POINT_ARC_TOOL_ID);
    clickAt(editor, 1, 1);
    clickAt(editor, 3, 1);
    moveTo(editor, 2, 2);
    clickAt(editor, 2, 2);
    expect(counts(doc)).toEqual({ v: 13, e: 12, f: 0 });
    expect(doc.rootStore.curveCount).toBe(1);
    expect(extent(editor, 'y').max).toBeCloseTo(2);
    expectValid(editor);
  });

  it('draws a center arc and retypes its angle and segments', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.activateTool(ARC_TOOL_ID);
    clickAt(editor, 2, 2);
    clickAt(editor, 3, 2);
    moveTo(editor, 2, 3);
    clickAt(editor, 2, 3);
    expect(counts(doc)).toEqual({ v: 13, e: 12, f: 0 });
    expect(extent(editor, 'x').min).toBeCloseTo(2);
    type(editor, '180');
    expect(extent(editor, 'x').min).toBeCloseTo(1);
    type(editor, '6s');
    expect(counts(doc)).toEqual({ v: 7, e: 6, f: 0 });
    expect(doc.undoDepth).toBe(1);
    expectValid(editor);
  });

  it('draws a 3-point arc and a pie with a face', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.activateTool(THREE_POINT_ARC_TOOL_ID);
    clickAt(editor, 1, 1);
    clickAt(editor, 2, 2);
    clickAt(editor, 3, 1);
    expect(counts(doc)).toEqual({ v: 13, e: 12, f: 0 });
    expect(extent(editor, 'y').max).toBeCloseTo(2);

    editor.activateTool(PIE_TOOL_ID);
    clickAt(editor, -2, -2);
    clickAt(editor, 0, -2);
    moveTo(editor, -2, 0);
    clickAt(editor, -2, 0);
    expect(counts(doc)).toEqual({ v: 27, e: 26, f: 1 });
    expectValid(editor);
  });
});

describe('Freehand tool', () => {
  it('draws a polyline curve along the pointer path', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.activateTool(FREEHAND_TOOL_ID);
    const start = screenOf(1, 1);
    editor.tools.pointerDown(pointer(start.x, start.y));
    for (const [x, y] of [
      [1.5, 1.2],
      [2, 1.6],
      [2.5, 1.4],
      [3, 2],
    ] as const) {
      moveTo(editor, x, y, { buttons: 1 });
    }
    const end = screenOf(3, 2);
    editor.tools.pointerUp(pointer(end.x, end.y, { buttons: 0 }));
    expect(counts(doc)).toEqual({ v: 5, e: 4, f: 0 });
    expect(doc.rootStore.curveCount).toBe(1);
    expectValid(editor);
  });
});

describe('Rotated Rectangle tool', () => {
  it('draws a rectangle along a diagonal base and retypes its size', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.activateTool(ROTATED_RECTANGLE_TOOL_ID);
    clickAt(editor, 1, 1);
    clickAt(editor, 3, 3);
    moveTo(editor, 0, 2);
    clickAt(editor, 0, 2);
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
    type(editor, '4m,1m');
    const store = doc.rootStore;
    const lengths = [...store.edges()]
      .map((edge) => {
        const a = store.position(edge.v0);
        const b = store.position(edge.v1);
        return Math.hypot(a.x - b.x, a.y - b.y);
      })
      .sort((a, b) => a - b);
    expect(lengths[0]).toBeCloseTo(1);
    expect(lengths[3]).toBeCloseTo(4);
    expectValid(editor);
  });
});

describe('Protractor tool', () => {
  it('creates an angled guide line', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.activateTool(PROTRACTOR_TOOL_ID);
    clickAt(editor, 1, 1);
    clickAt(editor, 3, 1);
    moveTo(editor, 2, 3);
    type(editor, '30');
    const [guide] = [...doc.rootStore.guides()];
    expect(guide?.geometry.kind).toBe('line');
    if (guide?.geometry.kind === 'line') {
      expect(guide.geometry.direction.x).toBeCloseTo(Math.cos(Math.PI / 6));
      expect(guide.geometry.direction.y).toBeCloseTo(Math.sin(Math.PI / 6));
    }
    expectValid(editor);
  });
});
