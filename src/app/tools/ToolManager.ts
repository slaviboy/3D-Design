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

import { createLogger } from '../diagnostics/log';
import type { Editor } from '../Editor';
import {
  MIDDLE_BUTTON,
  type MeasurementField,
  type PointerInput,
  type PointerKind,
  type Tool,
  type ToolOverlay,
  type WheelInput,
} from './Tool';

const toolLog = createLogger('tools');

/** Wheel zoom: factor = exp(-deltaY × this). A typical mouse notch (deltaY 100) zooms by about 16%. */
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;

interface NavigationDrag {
  readonly mode: 'orbit' | 'pan';
  lastX: number;
  lastY: number;
}

/**
 * Routes input to the active tool. Middle-button drags orbit (Shift: pan) and the wheel zooms at the cursor
 * regardless of the active tool, as temporary navigation.
 *
 * Two kinds of stand-in keep the active tool's operation while something else has the pointer: a tool *suspended*
 * for navigation (switching to Orbit and back continues a line where it was), and a *temporary* tool that takes the
 * pointer for one gesture (a box selection after a long press) without becoming the active tool.
 */
export class ToolManager {
  readonly #editor: Editor;
  readonly #tools = new Map<string, Tool>();
  readonly #listeners = new Set<() => void>();
  #active: Tool;
  #suspended: Tool | null = null;
  #temporary: Tool | null = null;
  #navigation: NavigationDrag | null = null;
  #lastPointerType: PointerKind = 'mouse';

  constructor(editor: Editor, tools: readonly Tool[], initialToolId: string) {
    this.#editor = editor;
    for (const tool of tools) this.#tools.set(tool.id, tool);
    const initial = this.#tools.get(initialToolId);
    if (!initial) throw new Error(`Unknown tool "${initialToolId}"`);
    this.#active = initial;
  }

  get activeTool(): Tool {
    return this.#active;
  }

  get activeToolId(): string {
    return this.#active.id;
  }

  /** The tool set aside for navigation, if any. */
  get suspendedToolId(): string | null {
    return this.#suspended?.id ?? null;
  }

  /** Where pointer input goes: the temporary tool while it has the pointer, otherwise the active one. */
  get #target(): Tool {
    return this.#temporary ?? this.#active;
  }

  get overlay(): ToolOverlay | null {
    return this.#target.overlay?.() ?? null;
  }

  get statusHint(): string {
    return this.#active.statusHint(this.#editor);
  }

  /** The tool the measurements box talks to: the active one, or the one set aside while navigating. */
  get measurementTool(): Tool {
    if (!this.#active.measurement && this.#suspended?.measurement) return this.#suspended;
    return this.#active;
  }

  get measurement(): MeasurementField | null {
    return this.measurementTool.measurement?.(this.#editor) ?? null;
  }

  /** The kind of pointer that moved last; touch gets larger snapping tolerances. */
  get lastPointerType(): PointerKind {
    return this.#lastPointerType;
  }

  /** An operation is underway in the tool that has the pointer. */
  get busy(): boolean {
    return this.#target.busy?.(this.#editor) ?? false;
  }

  /** A press would act at once, so touch should aim first (see `Tool.aims`). */
  get aims(): boolean {
    return this.#target.aims?.(this.#editor) ?? false;
  }

  /** An operation is underway, in the tool with the pointer or in one set aside for navigation. */
  get hasOperation(): boolean {
    return this.busy || (this.#suspended?.busy?.(this.#editor) ?? false);
  }

  tools(): Tool[] {
    return [...this.#tools.values()];
  }

  has(toolId: string): boolean {
    return this.#tools.has(toolId);
  }

  activate(toolId: string): void {
    const tool = this.#get(toolId);
    if (tool === this.#active && !this.#suspended) return;
    this.#endTemporary();
    // Choosing a tool ends the operation set aside for navigation.
    if (this.#suspended && this.#suspended !== tool) this.#leave(this.#suspended);
    if (tool !== this.#active) this.#leave(this.#active);
    const resumed = tool === this.#suspended;
    this.#suspended = null;
    this.#active = tool;
    if (!resumed) tool.activate?.(this.#editor);
    this.#changed();
  }

  /** Switches to a navigation tool for a while; the current tool keeps its operation until `resumeSuspended`. */
  suspendFor(toolId: string): void {
    const tool = this.#get(toolId);
    if (tool === this.#active) return;
    this.#endTemporary();
    if (this.#suspended) this.#leave(this.#active);
    else this.#suspended = this.#active;
    this.#active = tool;
    tool.activate?.(this.#editor);
    this.#changed();
  }

  /** Returns to the tool set aside by `suspendFor`, operation and all. False when none is set aside. */
  resumeSuspended(): boolean {
    const suspended = this.#suspended;
    if (!suspended) return false;
    this.#endTemporary();
    this.#leave(this.#active);
    this.#active = suspended;
    this.#suspended = null;
    this.#changed();
    return true;
  }

  /** Gives the pointer to another tool for one gesture, leaving the active tool and its state untouched. */
  beginTemporary(toolId: string): void {
    const tool = this.#get(toolId);
    this.#endTemporary();
    if (tool === this.#active) return;
    this.#temporary = tool;
    this.#changed();
  }

  /** Gives the pointer back to the active tool. */
  endTemporary(): void {
    if (this.#endTemporary()) this.#changed();
  }

  pointerDown(input: PointerInput): void {
    this.#lastPointerType = input.pointerType ?? 'mouse';
    if (input.button === MIDDLE_BUTTON) {
      this.#navigation = { mode: input.shiftKey ? 'pan' : 'orbit', lastX: input.x, lastY: input.y };
      return;
    }
    const tool = this.#target;
    this.#guard(() => tool.pointerDown?.(input, this.#editor));
    this.#changed();
  }

  pointerMove(input: PointerInput): void {
    this.#lastPointerType = input.pointerType ?? 'mouse';
    const navigation = this.#navigation;
    if (navigation) {
      const dx = input.x - navigation.lastX;
      const dy = input.y - navigation.lastY;
      navigation.lastX = input.x;
      navigation.lastY = input.y;
      if (navigation.mode === 'orbit') this.#editor.orbitBy(dx, dy);
      else this.#editor.panBy(dx, dy);
      return;
    }
    const tool = this.#target;
    if (tool.pointerMove) {
      this.#guard(() => tool.pointerMove?.(input, this.#editor));
      this.#changed();
    }
  }

  pointerUp(input: PointerInput): void {
    if (this.#navigation) {
      if (input.button === MIDDLE_BUTTON) this.#navigation = null;
      return;
    }
    const tool = this.#target;
    this.#guard(() => tool.pointerUp?.(input, this.#editor));
    this.#changed();
  }

  wheel(input: WheelInput): void {
    const direction = this.#editor.preferences.invertWheelZoom ? -1 : 1;
    this.#editor.zoomAtScreen(
      { x: input.x, y: input.y },
      Math.exp(-direction * input.deltaY * WHEEL_ZOOM_SENSITIVITY),
    );
  }

  /** Offers a chord to the active tool. Escape always cancels the tool's current operation. */
  keyDown(chord: string): boolean {
    const tool = this.#target;
    const handled = this.#guard(() => tool.keyDown?.(chord, this.#editor)) ?? false;
    if (handled) {
      this.#changed();
      return true;
    }
    if (chord === 'Escape') {
      this.#endTemporary();
      this.#active.cancel?.(this.#editor);
      this.#suspended?.cancel?.(this.#editor);
      this.#changed();
      return true;
    }
    return false;
  }

  /** Abandons every operation in progress: the active tool's, the one set aside for navigation, and any drag. */
  cancel(): void {
    this.#navigation = null;
    this.#endTemporary();
    this.#active.cancel?.(this.#editor);
    this.#suspended?.cancel?.(this.#editor);
    this.#changed();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Call after something outside the tool manager changed what the active tool shows. */
  refresh(): void {
    this.#changed();
  }

  #get(toolId: string): Tool {
    const tool = this.#tools.get(toolId);
    if (!tool) throw new Error(`Unknown tool "${toolId}"`);
    return tool;
  }

  #leave(tool: Tool): void {
    tool.cancel?.(this.#editor);
    tool.deactivate?.(this.#editor);
  }

  #endTemporary(): boolean {
    const temporary = this.#temporary;
    if (!temporary) return false;
    temporary.cancel?.(this.#editor);
    this.#temporary = null;
    return true;
  }

  /** Runs tool code, turning failures into error notifications so one bad input never breaks the editor. */
  #guard<T>(action: () => T): T | undefined {
    try {
      return action();
    } catch (error) {
      toolLog.error(`${this.#target.id} failed`, error);
      this.#editor.notify('error', error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  #changed(): void {
    // A navigation tool shows nothing itself, so the operation set aside keeps showing while the view moves.
    const preview = this.#target.preview?.(this.#editor) ?? this.#suspended?.preview?.(this.#editor) ?? null;
    this.#editor.session.setPreview(preview);
    for (const listener of [...this.#listeners]) listener();
  }
}
