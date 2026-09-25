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

import { createStore } from 'zustand/vanilla';
import type { ToolbarSlot } from '../../app/toolbars/toolbarLayout';

/** Arranging the toolbar and the tool palette: shared by both bars, since buttons move between them. */
export interface ArrangeState {
  readonly arranging: boolean;
  /** The button following the pointer. */
  readonly dragging: ToolbarSlot | null;
  /** Where the dragged button would go: just before the button at this place, or at the end of the bar. */
  readonly target: ToolbarSlot | null;
  /** A button picked up by a tap, which the next tap on another button puts down before it. */
  readonly picked: ToolbarSlot | null;
  /** Read out after each move. */
  readonly announcement: string;
}

const IDLE: ArrangeState = {
  arranging: false,
  dragging: null,
  target: null,
  picked: null,
  announcement: '',
};

export const arrangeStore = createStore<ArrangeState>(() => IDLE);

export function startArranging(announcement: string): void {
  arrangeStore.setState({ ...IDLE, arranging: true, announcement });
}

export function stopArranging(): void {
  arrangeStore.setState({ ...IDLE, announcement: 'Finished arranging the toolbars' });
}
