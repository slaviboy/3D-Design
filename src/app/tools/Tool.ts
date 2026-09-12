import type { Editor } from '../Editor';

export const SELECT_TOOL_ID = 'tool.select';
export const ORBIT_TOOL_ID = 'tool.orbit';
export const PAN_TOOL_ID = 'tool.pan';
export const ZOOM_TOOL_ID = 'tool.zoom';

export const PRIMARY_BUTTON = 0;
export const MIDDLE_BUTTON = 1;

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

export type ToolOverlay = SelectionRectangleOverlay;

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
  /** Instruction shown in the status bar. */
  statusHint(editor: Editor): string;
  overlay?(): ToolOverlay | null;
}
