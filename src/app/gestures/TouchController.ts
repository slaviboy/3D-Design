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

import type { Vec3 } from '../../kernel/math/vec3';
import {
  pan,
  zoom,
  zoomFocusInEmptySpace,
  zoomLimits,
  type CameraState,
  type ScreenPoint,
  type ZoomLimits,
} from '../camera/camera';
import type { Editor } from '../Editor';
import { definitionBounds } from '../geometry/bounds';
import { SELECT_TOOL_ID, type PointerInput, type PointerKind } from '../tools/Tool';
import {
  cornerAt,
  gestureCommand,
  gestureTool,
  type CornerId,
  type GestureAction,
  type TouchSettings,
} from './gestureSettings';
import { TouchRecognizer, type GestureClock, type TouchGesture } from './touchRecognizer';

/** What touch input needs from the interface. */
export interface TouchUiPort {
  /** Opens the context menu for what is at a viewport point, as a right-click there would. */
  openContextMenu(point: ScreenPoint): void;
  closeContextMenu(): void;
  /** A corner zone ran its action; `label` names the tool now in use, or the command that ran. */
  cornerTriggered(corner: CornerId, label: string): void;
}

/** A corner set to double tap waits this long for the second tap before taking the first as an ordinary tap. */
export const CORNER_DOUBLE_TAP_MS = 300;

/** Holding repeats the action this long after the first time, then each time sooner, down to the minimum. */
const REPEAT_FIRST_MS = 150;
const REPEAT_ACCELERATION = 0.85;
const REPEAT_MIN_MS = 40;

interface Pinch {
  readonly camera: CameraState;
  /** The point the zoom stays about: what was under the fingers where the pinch started. */
  readonly anchor: Vec3;
  readonly span: number;
  readonly centroid: ScreenPoint;
  readonly limits: ZoomLimits;
}

/**
 * Touch on the view. One finger drives the active tool like a mouse: a tap clicks, a drag presses, drags and
 * releases, and while an operation is underway (or a press would act at once) a drag moves the pointer and lifting
 * the finger clicks. Two fingers pinch to zoom about the spot where they started; two, three and four-finger taps
 * and holds run what the preferences assign (undo and redo by default), and a long press opens the context menu,
 * turning into a selection box if the finger then drags.
 */
export class TouchController {
  readonly #editor: Editor;
  readonly #clock: GestureClock;
  readonly #recognizer: TouchRecognizer;
  #ui: TouchUiPort | null = null;
  #pinch: Pinch | null = null;
  #slide: ScreenPoint | null = null;
  #repeat: number | null = null;
  #cornerWait: {
    readonly corner: CornerId;
    readonly point: ScreenPoint;
    readonly pointerType: PointerKind;
    readonly timer: number;
  } | null = null;

  constructor(editor: Editor, clock: GestureClock) {
    this.#editor = editor;
    this.#clock = clock;
    this.#recognizer = new TouchRecognizer(
      clock,
      {
        aims: () => editor.tools.busy || editor.tools.aims,
        holdDelayMs: () => (this.#settings.holdRepeat ? this.#settings.holdDelayMs : null),
        pinches: () => this.#settings.pinchZoom,
        slides: () => this.#settings.twoFingerSlide !== 'none',
        corner: (point) => this.cornerAt(point),
      },
      (gesture) => {
        this.#handle(gesture);
      },
    );
  }

  /** Connects the interface; the returned function disconnects it and forgets any touch in progress. */
  attach(ui: TouchUiPort): () => void {
    this.#ui = ui;
    return () => {
      if (this.#ui === ui) this.#ui = null;
      this.reset();
    };
  }

  /** Fingers on the view. */
  get activePointerCount(): number {
    return this.#recognizer.activeCount;
  }

  pointerDown(id: number, point: ScreenPoint): void {
    // Touching anywhere but the corner that waits for a second tap makes its first tap an ordinary one.
    if (this.#cornerWait && this.cornerAt(point) !== this.#cornerWait.corner) this.#flushCornerWait();
    this.#recognizer.down(id, point);
  }

  pointerMove(id: number, point: ScreenPoint): void {
    this.#recognizer.move(id, point);
  }

  pointerUp(id: number, point: ScreenPoint): void {
    this.#recognizer.up(id, point);
  }

  pointerCancel(id: number): void {
    this.#recognizer.cancel(id);
  }

  reset(): void {
    this.#recognizer.reset();
    this.#stopRepeat();
    if (this.#cornerWait) this.#clock.clearTimer(this.#cornerWait.timer);
    this.#cornerWait = null;
    this.#pinch = null;
    this.#slide = null;
  }

  /** The active corner zone a viewport point lies in, or null. */
  cornerAt(point: ScreenPoint): CornerId | null {
    return cornerAt(this.#settings, this.#editor.viewportSize, point);
  }

  /**
   * A tap in a corner zone, with a finger or a pen: runs the corner's action, or, for a corner set to double tap,
   * waits for the second tap and otherwise passes the tap on to the tool.
   */
  cornerTap(corner: CornerId, point: ScreenPoint, pointerType: PointerKind): void {
    const setting = this.#settings.corners[corner];
    if (setting.trigger === 'tap') {
      this.#runCorner(corner, setting.action, point);
      return;
    }
    const waiting = this.#cornerWait;
    if (waiting?.corner === corner) {
      this.#clock.clearTimer(waiting.timer);
      this.#cornerWait = null;
      this.#runCorner(corner, setting.action, point);
      return;
    }
    this.#flushCornerWait();
    this.#cornerWait = {
      corner,
      point,
      pointerType,
      timer: this.#clock.setTimer(() => {
        this.#flushCornerWait();
      }, CORNER_DOUBLE_TAP_MS),
    };
  }

  /** The pen's side button was pressed at a viewport point. */
  penButton(point: ScreenPoint): void {
    this.#perform(this.#settings.penButton, point);
  }

  get #settings(): TouchSettings {
    return this.#editor.preferences.touch;
  }

  #handle(gesture: TouchGesture): void {
    const { tools } = this.#editor;
    switch (gesture.kind) {
      case 'tap':
        this.#click(gesture.point, gesture.count);
        return;
      case 'corner-tap':
        this.cornerTap(gesture.corner, gesture.point, 'touch');
        return;
      case 'press-start':
        tools.pointerMove(this.#input(gesture.point, { buttons: 0 }));
        tools.pointerDown(this.#input(gesture.point));
        return;
      case 'press-move':
        tools.pointerMove(this.#input(gesture.point));
        return;
      case 'press-end':
        tools.pointerUp(this.#input(gesture.point, { buttons: 0 }));
        // Tools that take clicks (Line, Rectangle, Tape Measure…) took the press as their first click and now wait
        // for the second: lifting the finger gives it, so pressing, dragging and lifting draws the line.
        if (tools.busy) this.#click(gesture.point, 1);
        return;
      case 'press-cancel':
        tools.cancel();
        return;
      case 'aim-move':
        tools.pointerMove(this.#input(gesture.point, { buttons: 0 }));
        return;
      case 'aim-end':
        this.#click(gesture.point, 1);
        return;
      case 'long-press':
        this.#perform(this.#settings.longPress, gesture.point);
        return;
      case 'box-start':
        this.#ui?.closeContextMenu();
        tools.beginTemporary(SELECT_TOOL_ID);
        tools.pointerMove(this.#input(gesture.point, { buttons: 0 }));
        tools.pointerDown(this.#input(gesture.point));
        return;
      case 'box-move':
        tools.pointerMove(this.#input(gesture.point));
        return;
      case 'box-end':
        tools.pointerUp(this.#input(gesture.point, { buttons: 0 }));
        tools.endTemporary();
        return;
      case 'box-cancel':
        tools.endTemporary();
        return;
      case 'multi-tap':
        this.#perform(this.#tapAction(gesture.fingers), gesture.point);
        return;
      case 'hold-start':
        this.#startRepeat(this.#tapAction(gesture.fingers), gesture.point);
        return;
      case 'hold-end':
        this.#stopRepeat();
        return;
      case 'pinch-start':
        this.#startPinch(gesture.centroid, gesture.span);
        return;
      case 'pinch-move':
        this.#movePinch(gesture.centroid, gesture.span);
        return;
      case 'slide-start':
        this.#editor.stopAnimation();
        this.#slide = gesture.centroid;
        return;
      case 'slide-move':
        this.#moveSlide(gesture.centroid);
        return;
      case 'two-finger-end':
        this.#pinch = null;
        this.#slide = null;
        return;
    }
  }

  #input(point: ScreenPoint, overrides: Partial<PointerInput> = {}): PointerInput {
    return {
      x: point.x,
      y: point.y,
      button: 0,
      buttons: 1,
      detail: 1,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      pointerType: 'touch',
      ...overrides,
    };
  }

  /** A mouse click where the finger is: the pointer moves there first, so the tool infers at that spot. */
  #click(point: ScreenPoint, count: number, pointerType: PointerKind = 'touch'): void {
    const { tools } = this.#editor;
    tools.pointerMove(this.#input(point, { buttons: 0, pointerType }));
    tools.pointerDown(this.#input(point, { detail: count, pointerType }));
    tools.pointerUp(this.#input(point, { buttons: 0, detail: count, pointerType }));
  }

  #flushCornerWait(): void {
    const waiting = this.#cornerWait;
    if (!waiting) return;
    this.#clock.clearTimer(waiting.timer);
    this.#cornerWait = null;
    this.#click(waiting.point, 1, waiting.pointerType);
  }

  #runCorner(corner: CornerId, action: GestureAction, point: ScreenPoint): void {
    const editor = this.#editor;
    this.#perform(action, point);
    const command = gestureCommand(action);
    const label =
      gestureTool(action) !== null
        ? editor.tools.activeTool.label
        : command !== null
          ? (editor.commands.get(command)?.label ?? '')
          : '';
    if (label !== '') this.#ui?.cornerTriggered(corner, label);
  }

  #tapAction(fingers: number): GestureAction {
    const settings = this.#settings;
    if (fingers <= 2) return settings.twoFingerTap;
    return fingers === 3 ? settings.threeFingerTap : settings.fourFingerTap;
  }

  #perform(action: GestureAction, point: ScreenPoint): void {
    const editor = this.#editor;
    if (action === 'none') return;
    if (action === 'contextMenu') {
      this.#ui?.openContextMenu(point);
      return;
    }
    const tool = gestureTool(action);
    if (tool !== null) {
      if (editor.tools.has(tool)) editor.toggleTool(tool);
      return;
    }
    const command = gestureCommand(action);
    if (command === null || !editor.commands.get(command)) return;
    // Undo first takes back what is underway, like Escape, rather than the step before it.
    if (command === 'edit.undo' && editor.tools.hasOperation) {
      editor.escape();
      return;
    }
    void editor.runCommand(command);
  }

  /** Runs a hold's action at once, then again and again, faster, while it can run (rapid undo and redo). */
  #startRepeat(action: GestureAction, point: ScreenPoint): void {
    this.#stopRepeat();
    this.#perform(action, point);
    const command = gestureCommand(action);
    if (command === null) return;
    const editor = this.#editor;
    let interval = REPEAT_FIRST_MS;
    const step = (): void => {
      this.#repeat = null;
      if (!editor.commands.isEnabled(command, editor)) return;
      this.#perform(action, point);
      interval = Math.max(REPEAT_MIN_MS, interval * REPEAT_ACCELERATION);
      this.#repeat = this.#clock.setTimer(step, interval);
    };
    this.#repeat = this.#clock.setTimer(step, interval);
  }

  #stopRepeat(): void {
    if (this.#repeat !== null) this.#clock.clearTimer(this.#repeat);
    this.#repeat = null;
  }

  #startPinch(centroid: ScreenPoint, span: number): void {
    const editor = this.#editor;
    editor.stopAnimation();
    const { doc, camera } = editor.session;
    const bounds = definitionBounds(doc, doc.rootDefinitionId);
    // The zoom stays about the spot where the pinch started: the model under the fingers or, over empty space, a
    // point toward the model along that direction.
    const anchor =
      editor.pickAt(centroid)?.point ?? zoomFocusInEmptySpace(camera, centroid, editor.viewportSize, bounds);
    this.#pinch = { camera, anchor, span: Math.max(span, 1), centroid, limits: zoomLimits(bounds) };
  }

  /** Each step starts again from the camera at the pinch's start, so the anchor can't drift. */
  #movePinch(centroid: ScreenPoint, span: number): void {
    const pinch = this.#pinch;
    if (!pinch) return;
    const size = this.#editor.viewportSize;
    let camera = zoom(pinch.camera, span / pinch.span, pinch.anchor, pinch.limits);
    // With two-finger slides set to pan, the view also follows the fingers as they move.
    if (this.#settings.twoFingerSlide === 'pan') {
      camera = pan(camera, centroid.x - pinch.centroid.x, centroid.y - pinch.centroid.y, size);
    }
    this.#editor.session.setCamera(camera);
  }

  #moveSlide(centroid: ScreenPoint): void {
    const last = this.#slide;
    if (!last) return;
    this.#slide = centroid;
    const dx = centroid.x - last.x;
    const dy = centroid.y - last.y;
    if (this.#settings.twoFingerSlide === 'orbit') this.#editor.orbitBy(dx, dy);
    else if (this.#settings.twoFingerSlide === 'pan') this.#editor.panBy(dx, dy);
  }
}
