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
import { projectToScreen, type CameraState } from '../../src/app/camera/camera';
import type { Editor } from '../../src/app/Editor';
import { ARC_TOOL_ID, PIE_TOOL_ID, TWO_POINT_ARC_TOOL_ID } from '../../src/app/tools/ArcTool';
import { PROTRACTOR_TOOL_ID } from '../../src/app/tools/ProtractorTool';
import { ROTATED_RECTANGLE_TOOL_ID } from '../../src/app/tools/RotatedRectangleTool';
import { ROTATE_TOOL_ID } from '../../src/app/tools/RotateTool';
import {
  CIRCLE_TOOL_ID,
  ERASER_TOOL_ID,
  LINE_TOOL_ID,
  MOVE_TOOL_ID,
  POLYGON_TOOL_ID,
  PUSH_PULL_TOOL_ID,
  RECTANGLE_TOOL_ID,
  SELECT_TOOL_ID,
  TAPE_MEASURE_TOOL_ID,
} from '../../src/app/tools/Tool';
import type { EdgeId } from '../../src/kernel/ids';
import { add, AXIS_X, AXIS_Z, scale, vec3, type Vec3 } from '../../src/kernel/math/vec3';
import { validateDocument } from '../../src/kernel/model/validate';
import { deleteFaces } from '../../src/kernel/ops/erase';
import { pushPull } from '../../src/kernel/ops/pushPull';
import { boxEdges, counts, draw, polygon, rectangle, segment } from '../kernel/helpers';
import { click, createTestEditor, pointer, screenOf, VIEW_SIZE } from './fixtures';

const key = (value: string, modifiers: { shiftKey?: boolean } = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: modifiers.shiftKey ?? false,
});

/** Types into the measurements box through the keyboard router and presses Enter. */
function type(editor: Editor, text: string): void {
  for (const character of text) expect(editor.handleKey(key(character))).toBe(true);
  expect(editor.handleKey(key('Enter'))).toBe(true);
}

function clickAt(editor: Editor, x: number, y: number, overrides: Parameters<typeof pointer>[2] = {}): void {
  const screen = screenOf(x, y);
  click(editor, screen.x, screen.y, overrides);
}

function moveTo(editor: Editor, x: number, y: number, overrides: Parameters<typeof pointer>[2] = {}): void {
  const screen = screenOf(x, y);
  editor.tools.pointerMove(pointer(screen.x, screen.y, { buttons: 0, ...overrides }));
}

function positions(editor: Editor) {
  return [...editor.session.doc.rootStore.vertices()].map((vertex) => vertex.position);
}

function extent(editor: Editor, axis: 'x' | 'y' | 'z') {
  const values = positions(editor).map((p) => p[axis]);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function expectExtent(editor: Editor, axis: 'x' | 'y' | 'z', min: number, max: number): void {
  const range = extent(editor, axis);
  expect(range.min).toBeCloseTo(min, 9);
  expect(range.max).toBeCloseTo(max, 9);
}

function expectValidModel(editor: Editor): void {
  expect(validateDocument(editor.session.doc).problems).toEqual([]);
}

describe('Line tool', () => {
  it('draws connected edges, closes a face and ends the chain', () => {
    const editor = createTestEditor();
    editor.activateTool(LINE_TOOL_ID);
    clickAt(editor, 1, 1);
    clickAt(editor, 4, 1);
    clickAt(editor, 4, 3);
    clickAt(editor, 1, 3);
    clickAt(editor, 1, 1);
    expect(counts(editor.session.doc)).toEqual({ v: 4, e: 4, f: 1 });
    expect(editor.session.doc.undoDepth).toBe(4);
    expect(editor.tools.statusHint).toMatch(/start point/);
    expectValidModel(editor);
  });

  it('takes a typed length along the inferred axis', () => {
    const editor = createTestEditor();
    editor.activateTool(LINE_TOOL_ID);
    clickAt(editor, 1, 1);
    moveTo(editor, 3, 1.1);
    expect(editor.session.preview?.lines[0]?.style).toBe('axis-x');
    expect(editor.session.preview?.marker?.label).toBe('On Red Axis');
    type(editor, '2.5m');
    expect(extent(editor, 'x').max).toBeCloseTo(3.5);
    expectExtent(editor, 'y', 1, 1);
    expect(editor.handleKey(key('Escape'))).toBe(true);
    expect(counts(editor.session.doc)).toEqual({ v: 2, e: 1, f: 0 });
  });

  it('brings back a missing face when drawn over one of its edges', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 3));
    const face = [...doc.rootStore.faces()][0];
    deleteFaces(doc, doc.rootDefinitionId, face ? [face.id] : []);
    expect(counts(doc).f).toBe(0);
    editor.activateTool(LINE_TOOL_ID);
    clickAt(editor, 1, 1);
    clickAt(editor, 3, 1);
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
    expectValidModel(editor);
  });

  it('locks an axis with the arrow keys', () => {
    const editor = createTestEditor();
    editor.activateTool(LINE_TOOL_ID);
    clickAt(editor, 1, 1);
    expect(editor.handleKey(key('ArrowLeft'))).toBe(true);
    moveTo(editor, 3, 4);
    expect(editor.session.preview?.marker?.label).toBe('On Green Axis');
    clickAt(editor, 3, 4);
    expectExtent(editor, 'x', 1, 1);
    expect(extent(editor, 'y').max).toBeCloseTo(4);
  });
});

describe('measurements box routing', () => {
  it('sends typing to the active tool only while it has a measurements box', () => {
    const editor = createTestEditor();
    expect(editor.tools.activeToolId).toBe(SELECT_TOOL_ID);
    expect(editor.handleKey(key('2'))).toBe(false);

    editor.activateTool(LINE_TOOL_ID);
    expect(editor.handleKey(key('2'))).toBe(true);
    expect(editor.measurementText).toBe('2');
    expect(editor.handleKey(key('Backspace'))).toBe(true);
    expect(editor.measurementText).toBe('');
    // Letters start shortcuts, not typing, while the box is empty.
    expect(editor.handleKey(key('R'))).toBe(true);
    expect(editor.tools.activeToolId).toBe(RECTANGLE_TOOL_ID);
  });

  it('reports values the tool cannot use', () => {
    const editor = createTestEditor();
    editor.activateTool(LINE_TOOL_ID);
    type(editor, '5x');
    expect(editor.notifications.at(-1)?.kind).toBe('error');
    type(editor, '5m');
    expect(editor.notifications.at(-1)?.message).toMatch(/start the line/);
  });
});

describe('Rectangle tool', () => {
  it('draws from two corners and replaces the result with typed dimensions', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.activateTool(RECTANGLE_TOOL_ID);
    clickAt(editor, 1, 1);
    clickAt(editor, 3, 2);
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
    expectExtent(editor, 'x', 1, 3);

    type(editor, '4m,3m');
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
    expect(extent(editor, 'x').max).toBeCloseTo(5);
    expect(extent(editor, 'y').max).toBeCloseTo(4);
    expect(doc.undoDepth).toBe(1);
    editor.undo();
    expect(counts(doc)).toEqual({ v: 0, e: 0, f: 0 });
  });

  it('starts on a drawing axis when the pointer is near its line', () => {
    const editor = createTestEditor();
    editor.activateTool(RECTANGLE_TOOL_ID);
    moveTo(editor, 1, 0.3);
    expect(editor.session.preview?.marker).toMatchObject({
      kind: 'on-drawing-axis',
      label: 'On Red Axis',
      axis: 'x',
    });
    clickAt(editor, 1, 0.3);
    clickAt(editor, 3, 2);
    expectExtent(editor, 'x', 1, 3);
    expectExtent(editor, 'y', 0, 2);
  });

  it('ends on a drawing axis, but not on one through its first corner, which would flatten it', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.activateTool(RECTANGLE_TOOL_ID);
    clickAt(editor, 1, 1);
    moveTo(editor, 3, 0.2);
    expect(editor.session.preview?.marker).toMatchObject({ label: 'On Red Axis' });
    clickAt(editor, 3, 0.2);
    expectExtent(editor, 'y', 0, 1);
    expect(counts(doc).f).toBe(1);

    const fresh = createTestEditor();
    fresh.activateTool(RECTANGLE_TOOL_ID);
    clickAt(fresh, 0, 0);
    moveTo(fresh, 0.3, 3);
    expect(fresh.session.preview?.marker?.kind).not.toBe('on-drawing-axis');
    clickAt(fresh, 0.3, 3);
    expect(counts(fresh.session.doc).f).toBe(1);
  });

  describe('between corners of existing geometry', () => {
    // From the front, above.
    const camera: CameraState = {
      eye: vec3(0.5, -3, 3.5),
      target: vec3(0.5, 0.5, 0.5),
      up: AXIS_Z,
      fovDegrees: 35,
      projection: 'perspective',
      orthoHalfHeight: 5,
    };

    function viewed(): Editor {
      const editor = createTestEditor();
      editor.session.setCamera(camera);
      return editor;
    }

    function clickOn(editor: Editor, point: Vec3): void {
      const screen = projectToScreen(camera, point, VIEW_SIZE);
      if (!screen) throw new Error('behind the camera');
      editor.tools.pointerMove(pointer(screen.x, screen.y, { buttons: 0 }));
      click(editor, screen.x, screen.y);
    }

    /** Faces whose outline has every point on the plane `axis` = `value`. */
    function facesAt(editor: Editor, axis: 'x' | 'y' | 'z', value: number) {
      const store = editor.session.doc.rootStore;
      return [...store.faces()].filter((face) =>
        store.loopPoints(face.outer).every((p) => Math.abs(p[axis] - value) < 1e-9),
      );
    }

    it('fills the opening of a hole cut through a box, from one corner to the diagonal one', () => {
      const editor = viewed();
      const doc = editor.session.doc;
      draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
      draw(doc, rectangle(0.25, 0.25, 0.75, 0.75, 1));
      const square = facesAt(editor, 'z', 1).find((face) => face.inners.length === 0);
      if (!square) throw new Error('no square marked on the top');
      pushPull(doc, doc.rootDefinitionId, square.id, -1);
      expect(counts(doc).f).toBe(10);

      editor.activateTool(RECTANGLE_TOOL_ID);
      clickOn(editor, vec3(0.25, 0.25, 1));
      expect(editor.session.preview?.marker?.label).toBe('Endpoint');
      clickOn(editor, vec3(0.75, 0.75, 1));
      expect(counts(doc).f).toBe(11);
      expect(
        facesAt(editor, 'z', 1)
          .map((face) => face.inners.length)
          .sort(),
      ).toEqual([0, 1]);
      expect(doc.lastTransaction?.label).toBe('Rectangle');
      expectValidModel(editor);
    });

    it('stands up between two diagonal corners in a vertical plane', () => {
      const editor = viewed();
      const doc = editor.session.doc;
      draw(doc, [segment([0, 0, 0], [0, 0, 1]), segment([1, 0, 0], [1, 0, 1])]);
      editor.activateTool(RECTANGLE_TOOL_ID);
      clickOn(editor, vec3(0, 0, 0));
      clickOn(editor, vec3(1, 0, 1));
      expect(facesAt(editor, 'y', 0)).toHaveLength(1);
      expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
      expectValidModel(editor);
    });

    it('lies on the wall under the pointer when it starts at a corner of that wall', () => {
      const editor = viewed();
      const doc = editor.session.doc;
      draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
      editor.activateTool(RECTANGLE_TOOL_ID);
      clickOn(editor, vec3(0, 0, 1));
      clickOn(editor, vec3(0.6, 0, 0.4));
      const front = facesAt(editor, 'y', 0);
      expect(front).toHaveLength(2);
      expect(counts(doc).f).toBe(7);
      expectValidModel(editor);
    });
  });
});

describe('Circle and Polygon tools', () => {
  it('draws a circle with a typed radius, then changes its segment count', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.activateTool(CIRCLE_TOOL_ID);
    clickAt(editor, 2, 2);
    moveTo(editor, 3, 2);
    type(editor, '1.5m');
    expect(counts(doc)).toEqual({ v: 24, e: 24, f: 1 });
    expect(extent(editor, 'x').max).toBeCloseTo(3.5);
    type(editor, '12s');
    expect(counts(doc)).toEqual({ v: 12, e: 12, f: 1 });
    expect(doc.rootStore.curveCount).toBe(1);
    expect(doc.undoDepth).toBe(1);
  });

  it('draws a polygon with the typed number of sides', () => {
    const editor = createTestEditor();
    editor.activateTool(POLYGON_TOOL_ID);
    expect(editor.tools.measurement?.label).toBe('Sides');
    type(editor, '5s');
    clickAt(editor, 0, -3);
    clickAt(editor, 1, -3);
    expect(counts(editor.session.doc)).toEqual({ v: 5, e: 5, f: 1 });
    expectValidModel(editor);
  });

  it('pull up into a prism with a line down each side, and a smooth cylinder', () => {
    const editor = createTestEditor();
    const store = editor.session.doc.rootStore;
    editor.activateTool(POLYGON_TOOL_ID);
    type(editor, '6s');
    clickAt(editor, -2, -2);
    clickAt(editor, -1, -2);
    editor.activateTool(CIRCLE_TOOL_ID);
    clickAt(editor, 2, 2);
    clickAt(editor, 3, 2);
    editor.activateTool(PUSH_PULL_TOOL_ID);
    clickAt(editor, -2, -2);
    type(editor, '1m');
    clickAt(editor, 2, 2);
    type(editor, '1m');

    const sides = (left: boolean) =>
      [...store.edges()].filter((edge) => {
        const a = store.position(edge.v0);
        const b = store.position(edge.v1);
        return a.x < 0 === left && Math.abs(a.z - b.z) > 0.5;
      });
    const prism = sides(true);
    expect(prism).toHaveLength(6);
    expect(prism.filter((edge) => edge.attributes.soft || edge.attributes.smooth)).toEqual([]);
    const cylinder = sides(false);
    expect(cylinder).toHaveLength(24);
    expect(cylinder.every((edge) => edge.attributes.soft && edge.attributes.smooth)).toBe(true);
    expectValidModel(editor);
  });
});

describe('tools that draw in a plane through their first point', () => {
  // From the front right, above, so the blue line above a point on the ground shows as a line of its own.
  const camera: CameraState = {
    eye: vec3(6, -9, 6),
    target: vec3(1.5, 0, 0.5),
    up: AXIS_Z,
    fovDegrees: 35,
    projection: 'perspective',
    orthoHalfHeight: 5,
  };
  const size = { width: 800, height: 600 };

  function viewed(): Editor {
    const editor = createTestEditor();
    editor.setViewportSize(size);
    editor.session.setCamera(camera);
    return editor;
  }

  /** Where `point` shows, two pixels to the right, so the pointer isn't exactly on a line through it. */
  function near(point: Vec3): { x: number; y: number } {
    const screen = projectToScreen(camera, point, size);
    if (!screen) throw new Error('behind the camera');
    return { x: screen.x + 2, y: screen.y };
  }

  function hover(editor: Editor, point: Vec3): void {
    const screen = near(point);
    editor.tools.pointerMove(pointer(screen.x, screen.y, { buttons: 0 }));
  }

  function clickOn(editor: Editor, point: Vec3): void {
    hover(editor, point);
    const screen = near(point);
    click(editor, screen.x, screen.y);
  }

  function expectShapeShown(editor: Editor, axis: string): void {
    expect(editor.session.preview?.marker?.label).not.toBe(axis);
    expect(editor.session.preview?.lines.length).toBeGreaterThan(0);
    expect(editor.tools.measurement?.value).not.toBe('0mm');
  }

  it.each([
    ['Circle', CIRCLE_TOOL_ID],
    ['Polygon', POLYGON_TOOL_ID],
    ['Arc', ARC_TOOL_ID],
    ['Pie', PIE_TOOL_ID],
    ['2-Point Arc', TWO_POINT_ARC_TOOL_ID],
    ['Rotated Rectangle', ROTATED_RECTANGLE_TOOL_ID],
  ])('%s keeps its size with the pointer straight above its first point', (_name, toolId) => {
    const editor = viewed();
    editor.activateTool(toolId);
    clickOn(editor, vec3(2, 0, 0));
    // Every point of the blue line up from the first point lies on it once dropped into the ground plane.
    for (const height of [0.5, 1, 2]) {
      hover(editor, vec3(2, 0, height));
      expectShapeShown(editor, 'On Blue Axis');
    }
  });

  it('keeps a circle on a wall with the pointer out along the wall normal', () => {
    for (const { wall, center, normal, axis } of [
      {
        wall: polygon([vec3(-1, 1, 0), vec3(-1, 4, 0), vec3(-1, 4, 2), vec3(-1, 1, 2)]),
        center: vec3(-1, 2.5, 1),
        normal: AXIS_X,
        axis: 'On Red Axis',
      },
      {
        wall: polygon([vec3(0, 1, 0), vec3(3, 1, 0), vec3(3, 1, 2), vec3(0, 1, 2)]),
        center: vec3(1.5, 1, 1),
        normal: vec3(0, -1, 0),
        axis: 'On Green Axis',
      },
    ]) {
      const editor = viewed();
      draw(editor.session.doc, wall);
      editor.activateTool(CIRCLE_TOOL_ID);
      hover(editor, center);
      expect(editor.session.preview?.marker?.label).toBe('On Face');
      clickOn(editor, center);
      for (const out of [0.6, 1]) {
        hover(editor, add(center, scale(normal, out)));
        expectShapeShown(editor, axis);
      }
    }
  });

  it.each([
    ['Rotate', ROTATE_TOOL_ID],
    ['Protractor', PROTRACTOR_TOOL_ID],
  ])('%s turns toward the pointer above its center instead of holding the last angle', (_name, toolId) => {
    const editor = viewed();
    draw(editor.session.doc, rectangle(3, 1, 4, 2));
    editor.selectAll();
    editor.activateTool(toolId);
    clickOn(editor, vec3(2, 0, 0));
    hover(editor, vec3(2, 0, 1));
    expect(editor.session.preview?.marker?.label).not.toBe('On Blue Axis');
    clickOn(editor, vec3(3, 0, 0));
    hover(editor, vec3(2, 1, 0));
    expect(editor.tools.measurement?.value).toBe('90.0°');
    // Seen from the camera, the pointer above the center covers the ground straight behind it, away from the eye.
    const behind = (Math.atan2(9, -4) * 180) / Math.PI;
    for (const height of [0.5, 1]) {
      hover(editor, vec3(2, 0, height));
      expect(editor.session.preview?.marker?.label).not.toBe('On Blue Axis');
      expect(Number.parseFloat(editor.tools.measurement?.value ?? '')).toBeCloseTo(behind, 0);
    }
  });
});

describe('Push/Pull tool', () => {
  it('extrudes a face by a typed distance, retypes it, and repeats it with a double-click', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 3));
    const depth = doc.undoDepth;
    editor.activateTool(PUSH_PULL_TOOL_ID);
    moveTo(editor, 2, 2);
    expect(editor.session.preview?.highlight).toHaveLength(1);

    clickAt(editor, 2, 2);
    type(editor, '2m');
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expectExtent(editor, 'z', 0, 2);

    type(editor, '3m');
    expect(extent(editor, 'z').max).toBeCloseTo(3);
    expect(doc.undoDepth).toBe(depth + 1);

    draw(doc, rectangle(5, 1, 7, 3));
    clickAt(editor, 6, 2);
    clickAt(editor, 6, 2, { detail: 2 });
    expect(counts(doc)).toEqual({ v: 16, e: 24, f: 12 });
    expectValidModel(editor);
  });

  it('cancels with Escape, leaving the model unchanged', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 3));
    editor.activateTool(PUSH_PULL_TOOL_ID);
    clickAt(editor, 2, 2);
    expect(editor.handleKey(key('Escape'))).toBe(true);
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
  });

  it('does not snap to the drawing axes, which would make the face jump', () => {
    const camera: CameraState = {
      eye: vec3(6, -8, 5),
      target: vec3(1, 1, 0.5),
      up: AXIS_Z,
      fovDegrees: 35,
      projection: 'perspective',
      orthoHalfHeight: 5,
    };
    const editor = createTestEditor();
    editor.session.setCamera(camera);
    draw(editor.session.doc, rectangle(1, 1, 3, 3));
    editor.activateTool(PUSH_PULL_TOOL_ID);
    const face = projectToScreen(camera, vec3(2, 2, 0), VIEW_SIZE);
    const onBlueAxis = projectToScreen(camera, vec3(0, 0, 1), VIEW_SIZE);
    if (!face || !onBlueAxis) throw new Error('behind the camera');
    click(editor, face.x, face.y);
    editor.tools.pointerMove(pointer(onBlueAxis.x, onBlueAxis.y, { buttons: 0 }));
    expect(editor.session.preview?.marker?.kind).not.toBe('on-drawing-axis');
  });

  describe('reaching the far side of a shape', () => {
    // From the front, above: the back of a pocket's floor shows over its front wall, and points below the box appear
    // below it, away from its edges.
    const camera: CameraState = {
      eye: vec3(0.5, -3, 3.5),
      target: vec3(0.5, 0.5, 0.5),
      up: AXIS_Z,
      fovDegrees: 35,
      projection: 'perspective',
      orthoHalfHeight: 5,
    };

    const at = (point: Vec3) => {
      const screen = projectToScreen(camera, point, VIEW_SIZE);
      if (!screen) throw new Error('behind the camera');
      return { x: screen.x, y: screen.y };
    };

    /** A unit box with a square marked on its top, and Push/Pull ready. */
    function boxWithSquare(): Editor {
      const editor = createTestEditor();
      editor.session.setCamera(camera);
      draw(editor.session.doc, boxEdges(0, 0, 0, 1, 1, 1));
      draw(editor.session.doc, rectangle(0.25, 0.25, 0.75, 0.75, 1));
      editor.activateTool(PUSH_PULL_TOOL_ID);
      return editor;
    }

    /** Holes in each face lying on the ground. */
    function bottomHoles(editor: Editor): number[] {
      const store = editor.session.doc.rootStore;
      return [...store.faces()]
        .filter((face) => store.loopPoints(face.outer).every((p) => Math.abs(p.z) < 1e-9))
        .map((face) => face.inners.length);
    }

    it('stops at the far side and cuts through there, when the pointer goes further', () => {
      const editor = boxWithSquare();
      const press = at(vec3(0.5, 0.5, 1));
      click(editor, press.x, press.y);
      // Where a point two metres below the box appears: three times as deep as the box.
      const below = at(vec3(0.5, 0.5, -2));
      editor.tools.pointerMove(pointer(below.x, below.y, { buttons: 0 }));
      expect(editor.tools.measurement?.value).toBe('1000mm');
      expect(editor.tools.statusHint).toMatch(/^Offset limited to 1000mm: this is the far side/);
      expect(bottomHoles(editor)).toEqual([1]);
      click(editor, below.x, below.y);
      expect(bottomHoles(editor)).toEqual([1]);
      expect(counts(editor.session.doc)).toEqual({ v: 16, e: 24, f: 10 });
      expectValidModel(editor);
    });

    it('cuts through from the floor of a pocket too, instead of leaving two bottoms', () => {
      const editor = boxWithSquare();
      const press = at(vec3(0.5, 0.5, 1));
      click(editor, press.x, press.y);
      const shallow = at(vec3(0.5, 0.5, 0.9));
      editor.tools.pointerMove(pointer(shallow.x, shallow.y, { buttons: 0 }));
      type(editor, '300mm');
      expect(extent(editor, 'z').max).toBeCloseTo(1);

      const floor = at(vec3(0.5, 0.7, 0.7));
      click(editor, floor.x, floor.y);
      const below = at(vec3(0.5, 0.7, -2));
      editor.tools.pointerMove(pointer(below.x, below.y, { buttons: 0 }));
      expect(editor.tools.measurement?.value).toBe('700mm');
      click(editor, below.x, below.y);
      expect(bottomHoles(editor)).toEqual([1]);
      expectValidModel(editor);
    });

    it('refuses a typed depth past the far side, and says how deep it can go', () => {
      const editor = boxWithSquare();
      const press = at(vec3(0.5, 0.5, 1));
      click(editor, press.x, press.y);
      const shallow = at(vec3(0.5, 0.5, 0.9));
      editor.tools.pointerMove(pointer(shallow.x, shallow.y, { buttons: 0 }));
      type(editor, '2m');
      expect(editor.notifications.at(-1)?.message).toMatch(
        /^Push\/Pull stops at the face on the other side, .+ away$/,
      );
      expect(bottomHoles(editor)).toEqual([0]);
    });

    it('takes the whole box when its top reaches the bottom, and never shows the full box on the way', () => {
      const editor = createTestEditor();
      editor.session.setCamera(camera);
      const doc = editor.session.doc;
      draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
      editor.activateTool(PUSH_PULL_TOOL_ID);
      const press = at(vec3(0.5, 0.5, 1));
      click(editor, press.x, press.y);
      const bottom = at(vec3(0.5, 0.5, 0));
      // Down to the bottom a fraction of a pixel at a time, past it, and back up.
      const heights: number[] = [];
      for (const dy of [-3, -1, -0.5, -0.2, 0, 0.5, 2, 40, 0.5, -0.2, -1]) {
        editor.tools.pointerMove(pointer(bottom.x, bottom.y + dy, { buttons: 0 }));
        heights.push(Math.max(0, ...positions(editor).map((p) => p.z)));
      }
      expect(Math.max(...heights)).toBeLessThan(0.1);
      expect(heights.filter((height) => height === 0)).toHaveLength(5);

      const below = at(vec3(0.5, 0.5, -2));
      editor.tools.pointerMove(pointer(below.x, below.y, { buttons: 0 }));
      expect(editor.tools.measurement?.value).toBe('1000mm');
      expect(editor.tools.statusHint).toMatch(/^Offset limited to 1000mm: this is the far side/);
      click(editor, below.x, below.y);
      expect(counts(doc)).toEqual({ v: 0, e: 0, f: 0 });
      expect(doc.lastTransaction?.label).toBe('Push/Pull');
      expectValidModel(editor);
    });

    it('holds still near the bottom: a snap that lands the push is kept while the pointer stays by it', () => {
      // Steeply from above, where a snap to the bottom's edges lands the push well below where the pointer is.
      const steep: CameraState = { ...camera, eye: vec3(3, -3, 12), target: vec3(1, 0.5, 0.5) };
      const size = { width: 800, height: 600 };
      const on = (point: Vec3) => {
        const screen = projectToScreen(steep, point, size);
        if (!screen) throw new Error('behind the camera');
        return screen;
      };
      const flickering: string[] = [];
      for (const corner of [vec3(0, 0, 0), vec3(1, 0, 0), vec3(2, 0, 0)]) {
        const near = on(corner);
        for (let dx = -12; dx <= 12; dx += 3) {
          for (let dy = -12; dy <= 12; dy += 3) {
            const editor = createTestEditor();
            editor.setViewportSize(size);
            editor.session.setCamera(steep);
            const doc = editor.session.doc;
            draw(doc, boxEdges(0, 0, 0, 2, 1, 1));
            editor.activateTool(PUSH_PULL_TOOL_ID);
            const press = on(vec3(1, 0.5, 1));
            click(editor, press.x, press.y);
            const spot = { x: near.x + dx, y: near.y + dy };
            for (const t of [0.25, 0.5, 0.75]) {
              const x = press.x + t * (spot.x - press.x);
              const y = press.y + t * (spot.y - press.y);
              editor.tools.pointerMove(pointer(x, y, { buttons: 0 }));
            }
            // The first move there may still settle; after that the preview must not change.
            const states = new Set<string>();
            for (let move = 0; move < 5; move++) {
              editor.tools.pointerMove(pointer(spot.x, spot.y, { buttons: 0 }));
              if (move > 0)
                states.add(`${String(counts(doc).f)} faces, ${editor.tools.measurement?.value ?? ''}`);
            }
            if (states.size > 1)
              flickering.push(`${String(dx)},${String(dy)} from ${JSON.stringify(corner)}`);
          }
        }
      }
      expect(flickering).toEqual([]);
    });

    it('stops a bump pushed back down where it is flush, and flattens it there', () => {
      const editor = boxWithSquare();
      const doc = editor.session.doc;
      const press = at(vec3(0.5, 0.5, 1));
      click(editor, press.x, press.y);
      const up = at(vec3(0.5, 0.5, 1.1));
      editor.tools.pointerMove(pointer(up.x, up.y, { buttons: 0 }));
      type(editor, '300mm');
      expect(extent(editor, 'z').max).toBeCloseTo(1.3);

      const bump = at(vec3(0.5, 0.5, 1.3));
      click(editor, bump.x, bump.y);
      const shallow = at(vec3(0.5, 0.5, 1.2));
      editor.tools.pointerMove(pointer(shallow.x, shallow.y, { buttons: 0 }));
      type(editor, '500mm');
      expect(editor.notifications.at(-1)?.message).toBe(
        'Push/Pull stops where the face is flush, 300mm away',
      );

      const deep = at(vec3(0.5, 0.5, 0.5));
      editor.tools.pointerMove(pointer(deep.x, deep.y, { buttons: 0 }));
      expect(editor.tools.measurement?.value).toBe('300mm');
      expect(editor.tools.statusHint).toMatch(/^Offset limited to 300mm: the face is flush there/);
      click(editor, deep.x, deep.y);
      expect(counts(doc)).toEqual({ v: 12, e: 16, f: 7 });
      expect(extent(editor, 'z').max).toBeCloseTo(1);
      expectValidModel(editor);
    });
  });
});

describe('Move tool', () => {
  it('moves the selection between two inferred points, then makes an array of copies', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 3));
    editor.selectAll();
    editor.activateTool(MOVE_TOOL_ID);

    clickAt(editor, 1, 1);
    moveTo(editor, 5, 1);
    clickAt(editor, 5, 1);
    expect(counts(doc)).toEqual({ v: 4, e: 4, f: 1 });
    expectExtent(editor, 'x', 5, 7);
    expect(editor.session.selection.size).toBe(5);

    clickAt(editor, 5, 1);
    moveTo(editor, 8, 1, { ctrlKey: true });
    clickAt(editor, 8, 1, { ctrlKey: true });
    expect(counts(doc)).toEqual({ v: 8, e: 8, f: 2 });

    type(editor, '3x');
    expect(counts(doc)).toEqual({ v: 16, e: 16, f: 4 });
    expect(extent(editor, 'x').max).toBeCloseTo(16);
    expectValidModel(editor);
  });

  it('moves the entity under the pointer when nothing is selected, by a typed distance', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 3));
    editor.activateTool(MOVE_TOOL_ID);
    clickAt(editor, 2, 2);
    moveTo(editor, 2, 3.5);
    type(editor, '1m');
    expectExtent(editor, 'y', 2, 4);
  });
});

describe('Eraser tool', () => {
  it('erases, hides, softens and unsoftens edges', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 3));
    editor.activateTool(ERASER_TOOL_ID);

    clickAt(editor, 2, 1, { shiftKey: true });
    const hidden = [...doc.rootStore.edges()].filter((edge) => edge.attributes.hidden);
    expect(hidden).toHaveLength(1);

    clickAt(editor, 1, 2, { ctrlKey: true });
    const left = [...doc.rootStore.edges()].find((edge) => edge.attributes.soft);
    expect(left).toBeDefined();
    clickAt(editor, 1, 2, { ctrlKey: true, shiftKey: true });
    expect(doc.rootStore.getEdge(left?.id as EdgeId).attributes.soft).toBe(false);

    clickAt(editor, 3, 2);
    expect(counts(doc)).toEqual({ v: 4, e: 3, f: 0 });
  });
});

describe('Tape Measure tool', () => {
  it('creates a parallel guide line from an edge and a guide point from a point', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(-4, -4, 4, 4));
    editor.activateTool(TAPE_MEASURE_TOOL_ID);

    clickAt(editor, -2, -4);
    moveTo(editor, -2, -2);
    clickAt(editor, -2, -2);
    const [line] = [...doc.rootStore.guides()];
    expect(line?.geometry.kind).toBe('line');
    expect(line?.geometry.point.y).toBeCloseTo(-2);

    clickAt(editor, 4, 4);
    clickAt(editor, 2, 4);
    const point = [...doc.rootStore.guides()].find((guide) => guide.geometry.kind === 'point');
    expect(point?.geometry.point.x).toBeCloseTo(2);

    // Inference snaps to the guide line.
    editor.activateTool(LINE_TOOL_ID);
    moveTo(editor, 0, -2.1);
    expect(editor.session.preview?.marker?.label).toBe('On Guide');
  });
});

describe('groups', () => {
  it('makes a group, opens it with a double-click, closes it with Escape, and explodes it', async () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 3));
    editor.selectAll();
    await editor.runCommand('edit.makeGroup');
    expect(doc.rootStore.instanceCount).toBe(1);
    expect(counts(doc)).toEqual({ v: 0, e: 0, f: 0 });

    clickAt(editor, 2, 2, { detail: 2 });
    expect(editor.session.editPath).toHaveLength(1);
    expect(editor.session.activeContext).not.toBe(doc.rootDefinitionId);

    // Drawing happens inside the open group.
    editor.activateTool(LINE_TOOL_ID);
    clickAt(editor, 1, 2);
    clickAt(editor, 3, 2);
    expect(counts(doc, editor.session.activeContext)).toEqual({ v: 6, e: 7, f: 2 });

    editor.activateTool(SELECT_TOOL_ID);
    expect(editor.handleKey(key('Escape'))).toBe(true);
    expect(editor.session.editPath).toHaveLength(0);
    expect(editor.session.selection.count('instance')).toBe(1);

    await editor.runCommand('edit.explode');
    expect(doc.rootStore.instanceCount).toBe(0);
    expect(counts(doc)).toEqual({ v: 6, e: 7, f: 2 });
    expectValidModel(editor);
  });
});
