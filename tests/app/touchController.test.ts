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
import { projectToScreen, type CameraState, type ScreenPoint } from '../../src/app/camera/camera';
import type { Editor } from '../../src/app/Editor';
import { DEFAULT_TOUCH_SETTINGS, type TouchSettings } from '../../src/app/gestures/gestureSettings';
import type { TouchUiPort } from '../../src/app/gestures/TouchController';
import { PASTE_TOOL_ID } from '../../src/app/tools/PasteTool';
import { LINE_TOOL_ID, ORBIT_TOOL_ID, PUSH_PULL_TOOL_ID, RECTANGLE_TOOL_ID } from '../../src/app/tools/Tool';
import { AXIS_Z, vec3 } from '../../src/kernel/math/vec3';
import { draw, rectangle } from '../kernel/helpers';
import { createTestEditor, FakeClock, screenOf, VIEW_SIZE } from './fixtures';

interface Setup {
  readonly editor: Editor;
  readonly clock: FakeClock;
  readonly menus: ScreenPoint[];
  readonly corners: string[];
}

function setup(touch: Partial<TouchSettings> = {}): Setup {
  const clock = new FakeClock();
  const editor = createTestEditor({ clock });
  editor.updatePreferences({ touch: { ...DEFAULT_TOUCH_SETTINGS, ...touch } });
  const menus: ScreenPoint[] = [];
  const corners: string[] = [];
  const port: TouchUiPort = {
    openContextMenu: (point) => menus.push(point),
    closeContextMenu: () => undefined,
    cornerTriggered: (corner, label) => corners.push(`${corner}: ${label}`),
  };
  editor.touch.attach(port);
  return { editor, clock, menus, corners };
}

/** A finger: down, moves in small steps, up. */
function drag(editor: Editor, id: number, from: ScreenPoint, to: ScreenPoint, steps = 5): void {
  editor.touch.pointerDown(id, from);
  for (let step = 1; step <= steps; step++) {
    editor.touch.pointerMove(id, {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
  }
  editor.touch.pointerUp(id, to);
}

function tap(editor: Editor, point: ScreenPoint, id = 1): void {
  editor.touch.pointerDown(id, point);
  editor.touch.pointerUp(id, point);
}

function tapWith(editor: Editor, fingers: number, clock: FakeClock): void {
  const points = Array.from({ length: fingers }, (_, index) => screenOf(-3 + index, 3));
  points.forEach((point, index) => {
    editor.touch.pointerDown(10 + index, point);
  });
  clock.advance(50);
  points.forEach((point, index) => {
    editor.touch.pointerUp(10 + index, point);
  });
  clock.advance(400);
}

const faces = (editor: Editor) => [...editor.session.doc.rootStore.faces()].length;
const edges = (editor: Editor) => [...editor.session.doc.rootStore.edges()].length;

describe('touch drives the active tool like a mouse', () => {
  it('selects what a tap lands on', () => {
    const { editor } = setup();
    draw(editor.session.doc, rectangle(-1, -1, 1, 1));
    tap(editor, screenOf(0, 0));
    expect(editor.session.selection.count('face')).toBe(1);
    tap(editor, screenOf(3, 3), 2);
    expect(editor.session.selection.isEmpty).toBe(true);
  });

  it('draws a line by pressing, dragging and lifting, and the next one by dragging again', () => {
    const { editor, clock } = setup();
    editor.activateTool(LINE_TOOL_ID);
    drag(editor, 1, screenOf(-2, -2), screenOf(0, -2));
    expect(edges(editor)).toBe(1);
    expect(editor.tools.busy).toBe(true);
    clock.advance(500);
    // While the line continues, a drag moves its end and lifting places it.
    drag(editor, 2, screenOf(3, 3), screenOf(0, 0));
    expect(edges(editor)).toBe(2);
  });

  it('draws a rectangle with two taps', () => {
    const { editor, clock } = setup();
    editor.activateTool(RECTANGLE_TOOL_ID);
    tap(editor, screenOf(-1, -1));
    clock.advance(500);
    tap(editor, screenOf(1, 1), 2);
    expect(faces(editor)).toBe(1);
  });
});

describe('undo and redo with fingers', () => {
  it('undoes with a two-finger tap and redoes with a three-finger tap', () => {
    const { editor, clock } = setup();
    draw(editor.session.doc, rectangle(-1, -1, 1, 1));
    expect(faces(editor)).toBe(1);
    tapWith(editor, 2, clock);
    expect(faces(editor)).toBe(0);
    tapWith(editor, 3, clock);
    expect(faces(editor)).toBe(1);
  });

  it('takes back an operation underway before undoing anything', () => {
    const { editor, clock } = setup();
    draw(editor.session.doc, rectangle(-1, -1, 1, 1));
    editor.activateTool(PUSH_PULL_TOOL_ID);
    tap(editor, screenOf(0, 0));
    expect(editor.tools.busy).toBe(true);
    tapWith(editor, 2, clock);
    expect(editor.tools.busy).toBe(false);
    expect(faces(editor)).toBe(1);
  });

  it('undoes faster and faster while two fingers stay down, until nothing is left', () => {
    const { editor, clock } = setup();
    for (let i = 0; i < 6; i++) draw(editor.session.doc, rectangle(i * 3, 0, i * 3 + 1, 1));
    expect(faces(editor)).toBe(6);
    editor.touch.pointerDown(1, screenOf(-2, 2));
    editor.touch.pointerDown(2, screenOf(2, 2));
    clock.advance(520);
    expect(faces(editor)).toBe(5);
    clock.advance(160);
    expect(faces(editor)).toBe(4);
    clock.advance(1000);
    expect(faces(editor)).toBe(0);
    editor.touch.pointerUp(1, screenOf(-2, 2));
    editor.touch.pointerUp(2, screenOf(2, 2));
    // Redo still has every step.
    expect(editor.session.doc.canRedo).toBe(true);
  });

  it('runs the assigned action, such as switching to Orbit and back', () => {
    const { editor, clock } = setup({ fourFingerTap: 'toggleTool:tool.orbit' });
    editor.activateTool(LINE_TOOL_ID);
    tapWith(editor, 4, clock);
    expect(editor.tools.activeToolId).toBe(ORBIT_TOOL_ID);
    tapWith(editor, 4, clock);
    expect(editor.tools.activeToolId).toBe(LINE_TOOL_ID);
  });
});

describe('pinching', () => {
  it('zooms about the spot where the pinch started, which stays under the fingers', () => {
    for (const camera of [
      undefined,
      {
        eye: vec3(6, -8, 6),
        target: vec3(0, 0, 0),
        up: AXIS_Z,
        fovDegrees: 35,
        projection: 'perspective',
        orthoHalfHeight: 5,
      } satisfies CameraState,
    ]) {
      const { editor } = setup();
      if (camera) editor.session.setCamera(camera);
      draw(editor.session.doc, rectangle(-3, -3, 3, 3));
      const start = editor.session.camera;
      const left = { x: 80, y: 110 };
      const right = { x: 120, y: 110 };
      const centroid = { x: 100, y: 110 };
      const anchor = editor.pickAt(centroid)?.point;
      if (!anchor) throw new Error('nothing under the fingers');
      editor.touch.pointerDown(1, left);
      editor.touch.pointerDown(2, right);
      for (let step = 1; step <= 10; step++) {
        editor.touch.pointerMove(1, { x: left.x - 3 * step, y: left.y });
        editor.touch.pointerMove(2, { x: right.x + 3 * step, y: right.y });
      }
      const after = editor.session.camera;
      expect(after).not.toEqual(start);
      const onScreen = projectToScreen(after, anchor, VIEW_SIZE);
      expect(onScreen?.x).toBeCloseTo(centroid.x, 6);
      expect(onScreen?.y).toBeCloseTo(centroid.y, 6);
      editor.touch.pointerUp(1, { x: left.x - 30, y: left.y });
      editor.touch.pointerUp(2, { x: right.x + 30, y: right.y });
    }
  });

  it('leaves the tool alone: the finger left after a pinch does not draw', () => {
    const { editor } = setup();
    editor.activateTool(LINE_TOOL_ID);
    editor.touch.pointerDown(1, { x: 80, y: 100 });
    editor.touch.pointerDown(2, { x: 120, y: 100 });
    editor.touch.pointerMove(2, { x: 160, y: 100 });
    editor.touch.pointerUp(2, { x: 160, y: 100 });
    editor.touch.pointerMove(1, { x: 40, y: 140 });
    editor.touch.pointerUp(1, { x: 40, y: 140 });
    expect(edges(editor)).toBe(0);
    expect(editor.tools.busy).toBe(false);
  });
});

describe('touch and hold', () => {
  it('opens the context menu, then draws a selection box if the finger drags on', () => {
    const { editor, clock, menus } = setup();
    draw(editor.session.doc, rectangle(-1, -1, 1, 1));
    editor.activateTool(LINE_TOOL_ID);

    const start = screenOf(-2, 2);
    editor.touch.pointerDown(1, start);
    clock.advance(500);
    expect(menus).toEqual([start]);
    editor.touch.pointerMove(1, screenOf(0, 0));
    editor.touch.pointerMove(1, screenOf(2, -2));
    editor.touch.pointerUp(1, screenOf(2, -2));
    expect(editor.session.selection.count('face')).toBe(1);
    // The Line tool is still the one in use.
    expect(editor.tools.activeToolId).toBe(LINE_TOOL_ID);
    expect(edges(editor)).toBe(4);
  });

  it('aims instead while a paste waits to be placed, and places it where the finger lifts', () => {
    const { editor, clock, menus } = setup();
    draw(editor.session.doc, rectangle(-1, -1, 1, 1));
    editor.selectAll();
    editor.copySelection();
    editor.pasteFromClipboard();
    expect(editor.tools.activeToolId).toBe(PASTE_TOOL_ID);
    editor.touch.pointerDown(1, screenOf(3, 3));
    clock.advance(500);
    editor.touch.pointerUp(1, screenOf(3, 3));
    expect(menus).toEqual([]);
    expect(faces(editor)).toBe(2);
  });
});

describe('corner zones and the pen button', () => {
  const bottomLeft = { x: 20, y: 180 };
  const bottomRight = { x: 180, y: 180 };

  it('switches to Orbit and back with a tap in the bottom-left corner', () => {
    const { editor, clock, corners } = setup();
    tap(editor, bottomLeft);
    expect(editor.tools.activeToolId).toBe(ORBIT_TOOL_ID);
    clock.advance(500);
    tap(editor, bottomLeft, 2);
    expect(editor.tools.activeToolId).toBe('tool.select');
    expect(corners).toEqual(['bottomLeft: Orbit', 'bottomLeft: Select']);
  });

  it('lets a drag that starts in a corner reach the tool', () => {
    const { editor } = setup();
    editor.activateTool(LINE_TOOL_ID);
    drag(editor, 1, bottomLeft, { x: 100, y: 180 });
    expect(edges(editor)).toBe(1);
    expect(editor.tools.activeToolId).toBe(LINE_TOOL_ID);
  });

  it('waits for the second tap on a double-tap corner, and otherwise passes the tap on', () => {
    const { editor, clock } = setup({
      corners: {
        ...DEFAULT_TOUCH_SETTINGS.corners,
        bottomRight: { action: 'toggleTool:tool.orbit', trigger: 'doubleTap' },
      },
    });
    editor.activateTool(LINE_TOOL_ID);
    tap(editor, bottomRight);
    expect(editor.tools.busy).toBe(false);
    clock.advance(350);
    // No second tap came: the tap was the Line tool's first click after all.
    expect(editor.tools.busy).toBe(true);
    editor.escape();

    tap(editor, bottomRight, 2);
    clock.advance(100);
    tap(editor, bottomRight, 3);
    expect(editor.tools.activeToolId).toBe(ORBIT_TOOL_ID);
  });

  it('only answers in corners that do something, within their size', () => {
    const { editor } = setup();
    expect(editor.touch.cornerAt({ x: 10, y: 10 })).toBeNull();
    expect(editor.touch.cornerAt({ x: 50, y: 150 })).toBe('bottomLeft');
    editor.updatePreferences({ touch: { ...editor.preferences.touch, cornerSizePx: 40 } });
    expect(editor.touch.cornerAt({ x: 50, y: 150 })).toBeNull();
  });

  it('switches to Orbit and back with the pen button', () => {
    const { editor } = setup();
    editor.activateTool(LINE_TOOL_ID);
    editor.touch.penButton({ x: 100, y: 100 });
    expect(editor.tools.activeToolId).toBe(ORBIT_TOOL_ID);
    editor.touch.penButton({ x: 100, y: 100 });
    expect(editor.tools.activeToolId).toBe(LINE_TOOL_ID);
  });
});
