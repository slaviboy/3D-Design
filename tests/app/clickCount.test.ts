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
import {
  ClickCounter,
  MULTI_CLICK_DISTANCE_PX,
  MULTI_CLICK_MS,
  type PressEvent,
} from '../../src/ui/viewport/clickCount';

const press = (timeStamp: number, overrides: Partial<PressEvent> = {}): PressEvent => ({
  detail: 0,
  button: 0,
  clientX: 100,
  clientY: 100,
  timeStamp,
  ...overrides,
});

describe('ClickCounter', () => {
  it('uses the click count the browser reports', () => {
    const clicks = new ClickCounter();
    expect(clicks.press(press(0, { detail: 1 }))).toBe(1);
    expect(clicks.press(press(5000, { detail: 2 }))).toBe(2);
    expect(clicks.current).toBe(2);
  });

  it('counts double and triple clicks when pointer events report no count (Chromium, Firefox)', () => {
    const clicks = new ClickCounter();
    expect(clicks.current).toBe(0);
    expect(clicks.press(press(0))).toBe(1);
    expect(clicks.press(press(120, { clientX: 102 }))).toBe(2);
    expect(clicks.current).toBe(2);
    expect(clicks.press(press(240, { clientY: 103 }))).toBe(3);
  });

  it('starts a new count after a pause, a move or another button', () => {
    const clicks = new ClickCounter();
    clicks.press(press(0));
    expect(clicks.press(press(MULTI_CLICK_MS + 1))).toBe(1);
    expect(clicks.press(press(MULTI_CLICK_MS + 50, { clientX: 100 + MULTI_CLICK_DISTANCE_PX + 1 }))).toBe(1);
    expect(
      clicks.press(press(MULTI_CLICK_MS + 100, { clientX: 100 + MULTI_CLICK_DISTANCE_PX + 1, button: 1 })),
    ).toBe(1);
  });
});
