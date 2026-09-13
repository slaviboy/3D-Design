import { createLogger } from '../diagnostics/log';
import type { Editor } from '../Editor';
import {
  MIDDLE_BUTTON,
  type MeasurementField,
  type PointerInput,
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
 */
export class ToolManager {
  readonly #editor: Editor;
  readonly #tools = new Map<string, Tool>();
  readonly #listeners = new Set<() => void>();
  #active: Tool;
  #navigation: NavigationDrag | null = null;

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

  get overlay(): ToolOverlay | null {
    return this.#active.overlay?.() ?? null;
  }

  get statusHint(): string {
    return this.#active.statusHint(this.#editor);
  }

  get measurement(): MeasurementField | null {
    return this.#active.measurement?.(this.#editor) ?? null;
  }

  tools(): Tool[] {
    return [...this.#tools.values()];
  }

  has(toolId: string): boolean {
    return this.#tools.has(toolId);
  }

  activate(toolId: string): void {
    const tool = this.#tools.get(toolId);
    if (!tool) throw new Error(`Unknown tool "${toolId}"`);
    if (tool === this.#active) return;
    this.#active.cancel?.(this.#editor);
    this.#active.deactivate?.(this.#editor);
    this.#active = tool;
    tool.activate?.(this.#editor);
    this.#changed();
  }

  pointerDown(input: PointerInput): void {
    if (input.button === MIDDLE_BUTTON) {
      this.#navigation = { mode: input.shiftKey ? 'pan' : 'orbit', lastX: input.x, lastY: input.y };
      return;
    }
    this.#guard(() => this.#active.pointerDown?.(input, this.#editor));
    this.#changed();
  }

  pointerMove(input: PointerInput): void {
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
    const tool = this.#active;
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
    this.#guard(() => this.#active.pointerUp?.(input, this.#editor));
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
    const handled = this.#guard(() => this.#active.keyDown?.(chord, this.#editor)) ?? false;
    if (handled) {
      this.#changed();
      return true;
    }
    if (chord === 'Escape') {
      this.#active.cancel?.(this.#editor);
      this.#changed();
      return true;
    }
    return false;
  }

  cancel(): void {
    this.#navigation = null;
    this.#active.cancel?.(this.#editor);
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

  /** Runs tool code, turning failures into error notifications so one bad input never breaks the editor. */
  #guard<T>(action: () => T): T | undefined {
    try {
      return action();
    } catch (error) {
      toolLog.error(`${this.#active.id} failed`, error);
      this.#editor.notify('error', error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  #changed(): void {
    this.#editor.session.setPreview(this.#active.preview?.(this.#editor) ?? null);
    for (const listener of [...this.#listeners]) listener();
  }
}
