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
import type { MeasurementIntent, MeasurementKind } from '../../kernel/vcb/parseMeasurement';
import type { Editor } from '../Editor';
import type { InferenceKind } from '../inference/inference';
import type { EntityRef } from '../selection/Selection';

export const SELECT_TOOL_ID = 'tool.select';
export const ORBIT_TOOL_ID = 'tool.orbit';
export const PAN_TOOL_ID = 'tool.pan';
export const ZOOM_TOOL_ID = 'tool.zoom';
export const LINE_TOOL_ID = 'tool.line';
export const RECTANGLE_TOOL_ID = 'tool.rectangle';
export const CIRCLE_TOOL_ID = 'tool.circle';
export const POLYGON_TOOL_ID = 'tool.polygon';
export const ERASER_TOOL_ID = 'tool.eraser';
export const TAPE_MEASURE_TOOL_ID = 'tool.tapeMeasure';
export const PUSH_PULL_TOOL_ID = 'tool.pushPull';
export const MOVE_TOOL_ID = 'tool.move';

export const PRIMARY_BUTTON = 0;
export const MIDDLE_BUTTON = 1;

/** What produced pointer input. Touch gets larger snapping tolerances, since a finger covers what it points at. */
export type PointerKind = 'mouse' | 'pen' | 'touch';

/** Pointer input in CSS pixels relative to the viewport's top-left corner. */
export interface PointerInput {
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly buttons: number;
  /** Click count for presses: 1, 2 for a double-click, 3 for a triple-click. */
  readonly detail: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  /** Mouse when not given. */
  readonly pointerType?: PointerKind;
}

export interface WheelInput {
  readonly x: number;
  readonly y: number;
  readonly deltaY: number;
}

export interface SelectionRectangleOverlay {
  readonly kind: 'selection-rectangle';
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly mode: 'window' | 'crossing';
}

/** Screen-space overlays drawn by the UI on top of the viewport. */
export type ToolOverlay = SelectionRectangleOverlay;

/** Rubber-band lines are colored by the axis they follow, so the color itself is an inference cue. */
export type PreviewLineStyle = 'preview' | 'axis-x' | 'axis-y' | 'axis-z' | 'guide';

export interface PreviewLine {
  /** World coordinates. */
  readonly a: Vec3;
  readonly b: Vec3;
  readonly style: PreviewLineStyle;
}

export interface InferenceMarker {
  /** World coordinates. */
  readonly point: Vec3;
  readonly kind: InferenceKind;
  readonly label: string;
}

/** What a tool shows in the 3D view while it works. */
export interface ToolPreview {
  readonly lines: readonly PreviewLine[];
  /** Entities of the active context to highlight (the face Push/Pull would use, edges the eraser marked). */
  readonly highlight: readonly EntityRef[];
  readonly marker: InferenceMarker | null;
}

/** The measurements box while a tool is active. */
export interface MeasurementField {
  readonly label: string;
  /** Current value, shown when the user isn't typing. */
  readonly value: string;
  /** The kinds of typed input the tool understands. */
  readonly accepts: readonly MeasurementKind[];
}

/**
 * An interactive tool. Tools are plain classes driven by the ToolManager, which makes them testable with
 * synthetic input. They change the model only through kernel operations inside transactions.
 */
export interface Tool {
  readonly id: string;
  readonly label: string;
  /** CSS cursor while the tool is active. */
  readonly cursor: string;
  activate?(editor: Editor): void;
  deactivate?(editor: Editor): void;
  pointerDown?(input: PointerInput, editor: Editor): void;
  pointerMove?(input: PointerInput, editor: Editor): void;
  pointerUp?(input: PointerInput, editor: Editor): void;
  /** Handles a canonical key chord. Returns true when the key was consumed. */
  keyDown?(chord: string, editor: Editor): boolean;
  /** Abandons any operation in progress. */
  cancel?(editor: Editor): void;
  /**
   * True while an operation is underway (a line started, a face being pushed): what Escape would cancel. A finger
   * dragged then moves the pointer, like a mouse between clicks, instead of pressing.
   */
  busy?(editor: Editor): boolean;
  /**
   * True when a press acts at once (paints, places, opens a dialog), so a finger dragged first aims, with the preview
   * following it, and acts where it lifts.
   */
  aims?(editor: Editor): boolean;
  /** Instruction shown in the status bar. */
  statusHint(editor: Editor): string;
  overlay?(): ToolOverlay | null;
  preview?(editor: Editor): ToolPreview | null;
  measurement?(editor: Editor): MeasurementField | null;
  /** Applies a value typed in the measurements box. Throws to report invalid input. */
  onMeasurement?(intent: MeasurementIntent, editor: Editor): void;
}
