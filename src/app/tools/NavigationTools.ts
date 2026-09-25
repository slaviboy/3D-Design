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

import type { Editor } from '../Editor';
import {
  ORBIT_TOOL_ID,
  PAN_TOOL_ID,
  PRIMARY_BUTTON,
  ZOOM_TOOL_ID,
  type PointerInput,
  type Tool,
} from './Tool';

/** Drag zoom: factor = exp(-dy × this), so dragging up zooms in. */
export const DRAG_ZOOM_SENSITIVITY = 0.01;

type DragAction = (editor: Editor, dx: number, dy: number, input: PointerInput) => void;

/** A tool that turns primary-button drags into camera movement. */
class DragNavigationTool implements Tool {
  readonly id: string;
  readonly label: string;
  readonly cursor: string;
  readonly #hint: string;
  readonly #action: DragAction;
  #last: { x: number; y: number } | null = null;

  constructor(id: string, label: string, cursor: string, hint: string, action: DragAction) {
    this.id = id;
    this.label = label;
    this.cursor = cursor;
    this.#hint = hint;
    this.#action = action;
  }

  pointerDown(input: PointerInput): void {
    if (input.button === PRIMARY_BUTTON) this.#last = { x: input.x, y: input.y };
  }

  pointerMove(input: PointerInput, editor: Editor): void {
    const last = this.#last;
    if (!last) return;
    this.#action(editor, input.x - last.x, input.y - last.y, input);
    this.#last = { x: input.x, y: input.y };
  }

  pointerUp(): void {
    this.#last = null;
  }

  busy(): boolean {
    return this.#last !== null;
  }

  cancel(): void {
    this.#last = null;
  }

  statusHint(): string {
    return this.#hint;
  }
}

export function createOrbitTool(): Tool {
  return new DragNavigationTool(
    ORBIT_TOOL_ID,
    'Orbit',
    'grab',
    'Drag to orbit. Shift+drag pans.',
    (editor, dx, dy, input) => {
      if (input.shiftKey) editor.panBy(dx, dy);
      else editor.orbitBy(dx, dy);
    },
  );
}

export function createPanTool(): Tool {
  return new DragNavigationTool(PAN_TOOL_ID, 'Pan', 'move', 'Drag to pan the view.', (editor, dx, dy) => {
    editor.panBy(dx, dy);
  });
}

export function createZoomTool(): Tool {
  return new DragNavigationTool(
    ZOOM_TOOL_ID,
    'Zoom',
    'zoom-in',
    'Drag up to zoom in, down to zoom out. The wheel zooms at the cursor.',
    (editor, _dx, dy) => {
      editor.zoomBy(Math.exp(-dy * DRAG_ZOOM_SENSITIVITY));
    },
  );
}
