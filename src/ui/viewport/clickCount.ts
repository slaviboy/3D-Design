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

/** Longest pause between presses that still continues a double or triple click. */
export const MULTI_CLICK_MS = 500;
/** Presses farther apart than this start a new click count. */
export const MULTI_CLICK_DISTANCE_PX = 5;

export interface PressEvent {
  readonly detail: number;
  readonly button: number;
  readonly timeStamp: number;
  readonly clientX: number;
  readonly clientY: number;
}

interface LastPress {
  readonly button: number;
  readonly time: number;
  readonly x: number;
  readonly y: number;
  readonly count: number;
}

/**
 * Click counts for pointer presses. Chromium and Firefox report `detail` 0 on pointer events (only WebKit reports the
 * click count there), so when the browser gives none the count comes from the time and distance between presses.
 */
export class ClickCounter {
  #last: LastPress | null = null;

  /** Records a press and returns its click count: 1, 2 for a double-click, 3 for a triple-click. */
  press(event: PressEvent): number {
    const last = this.#last;
    let count = 1;
    if (event.detail > 0) {
      count = event.detail;
    } else if (
      last?.button === event.button &&
      event.timeStamp - last.time <= MULTI_CLICK_MS &&
      Math.hypot(event.clientX - last.x, event.clientY - last.y) <= MULTI_CLICK_DISTANCE_PX
    ) {
      count = last.count + 1;
    }
    this.#last = { button: event.button, time: event.timeStamp, x: event.clientX, y: event.clientY, count };
    return count;
  }

  /** The click count of the latest press, reported with the moves and release that follow it. */
  get current(): number {
    return this.#last?.count ?? 0;
  }
}
