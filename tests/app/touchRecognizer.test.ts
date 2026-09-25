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
  DEFAULT_TOUCH_SETTINGS,
  gestureCommand,
  gestureTool,
  readTouchSettings,
} from '../../src/app/gestures/gestureSettings';
import {
  LONG_PRESS_MS,
  TouchRecognizer,
  type TouchGesture,
  type TouchProbe,
} from '../../src/app/gestures/touchRecognizer';
import { FakeClock } from './fixtures';

interface Setup {
  readonly clock: FakeClock;
  readonly recognizer: TouchRecognizer;
  readonly events: TouchGesture[];
  /** The kinds of the events so far, then forgets them. */
  readonly kinds: () => string[];
}

function setup(probe: Partial<TouchProbe> = {}): Setup {
  const clock = new FakeClock();
  const events: TouchGesture[] = [];
  const recognizer = new TouchRecognizer(
    clock,
    {
      aims: () => false,
      holdDelayMs: () => 500,
      pinches: () => true,
      slides: () => false,
      ...probe,
    },
    (gesture) => events.push(gesture),
  );
  return {
    clock,
    recognizer,
    events,
    kinds: () => events.splice(0).map((event) => event.kind),
  };
}

const at = (x: number, y: number) => ({ x, y });

describe('touch gestures with one finger', () => {
  it('taps, and counts a quick second tap nearby as a double tap where the first landed', () => {
    const { recognizer, clock, events } = setup();
    recognizer.down(1, at(100, 100));
    recognizer.up(1, at(101, 100));
    clock.advance(100);
    recognizer.down(2, at(110, 104));
    recognizer.up(2, at(110, 104));
    expect(events).toEqual([
      { kind: 'tap', point: at(100, 100), count: 1 },
      { kind: 'tap', point: at(100, 100), count: 2 },
    ]);
    clock.advance(1000);
    recognizer.down(3, at(110, 104));
    recognizer.up(3, at(110, 104));
    expect(events.at(-1)).toEqual({ kind: 'tap', point: at(110, 104), count: 1 });
  });

  it('presses and drags once the finger travels past the jitter allowance', () => {
    const { recognizer, events } = setup();
    recognizer.down(1, at(100, 100));
    recognizer.move(1, at(104, 100));
    expect(events).toEqual([]);
    recognizer.move(1, at(120, 100));
    recognizer.move(1, at(140, 100));
    recognizer.up(1, at(140, 100));
    expect(events).toEqual([
      { kind: 'press-start', point: at(100, 100) },
      { kind: 'press-move', point: at(120, 100) },
      { kind: 'press-move', point: at(140, 100) },
      { kind: 'press-end', point: at(140, 100) },
    ]);
  });

  it('aims instead of pressing while the tool is busy, and clicks where the finger lifts', () => {
    const { recognizer, kinds } = setup({ aims: () => true });
    recognizer.down(1, at(100, 100));
    recognizer.move(1, at(130, 100));
    recognizer.up(1, at(150, 100));
    expect(kinds()).toEqual(['aim-move', 'aim-end']);
  });

  it('opens the menu on a long press, and draws a selection box when the finger then drags', () => {
    const { recognizer, clock, events, kinds } = setup();
    recognizer.down(1, at(100, 100));
    clock.advance(LONG_PRESS_MS + 20);
    expect(events).toEqual([{ kind: 'long-press', point: at(100, 100) }]);
    kinds();
    recognizer.move(1, at(160, 140));
    recognizer.up(1, at(160, 140));
    expect(kinds()).toEqual(['box-start', 'box-move', 'box-end']);
  });

  it('aims on a long press while the tool is busy, instead of opening the menu', () => {
    const { recognizer, clock, kinds } = setup({ aims: () => true });
    recognizer.down(1, at(100, 100));
    clock.advance(LONG_PRESS_MS + 20);
    recognizer.up(1, at(100, 100));
    expect(kinds()).toEqual(['aim-move', 'aim-end']);
  });
});

describe('touch gestures with several fingers', () => {
  it('taps with two, three and four fingers without a click reaching the tool', () => {
    for (const fingers of [2, 3, 4]) {
      const { recognizer, events } = setup();
      for (let id = 1; id <= fingers; id++) recognizer.down(id, at(100 + id * 30, 100));
      for (let id = 1; id <= fingers; id++) recognizer.up(id, at(100 + id * 30, 100));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: 'multi-tap', fingers });
    }
  });

  it('cancels a press when a second finger joins it, without taking the fingers for a tap or a hold', () => {
    const { recognizer, clock, kinds } = setup();
    recognizer.down(1, at(100, 100));
    recognizer.move(1, at(140, 100));
    recognizer.down(2, at(200, 100));
    recognizer.up(1, at(140, 100));
    recognizer.up(2, at(200, 100));
    expect(kinds()).toEqual(['press-start', 'press-move', 'press-cancel']);

    recognizer.down(3, at(100, 100));
    recognizer.move(3, at(140, 100));
    recognizer.down(4, at(200, 100));
    clock.advance(800);
    expect(kinds()).toEqual(['press-start', 'press-move', 'press-cancel']);
    // It may still pinch.
    recognizer.move(4, at(240, 100));
    expect(kinds()).toEqual(['pinch-start', 'pinch-move']);
  });

  it('holds two fingers still to start repeating, and stops when they lift', () => {
    const { recognizer, clock, events, kinds } = setup();
    recognizer.down(1, at(100, 100));
    recognizer.down(2, at(150, 100));
    clock.advance(520);
    expect(events).toEqual([{ kind: 'hold-start', fingers: 2, point: at(125, 100) }]);
    kinds();
    recognizer.up(1, at(100, 100));
    recognizer.up(2, at(150, 100));
    expect(kinds()).toEqual(['hold-end']);
  });

  it('pinches when the distance between two fingers changes, measured from where the pinch started', () => {
    const { recognizer, events, kinds } = setup();
    recognizer.down(1, at(100, 100));
    recognizer.down(2, at(200, 100));
    recognizer.move(2, at(230, 100));
    expect(events[0]).toEqual({ kind: 'pinch-start', centroid: at(150, 100), span: 100 });
    expect(events[1]).toEqual({ kind: 'pinch-move', centroid: at(165, 100), span: 130 });
    kinds();
    recognizer.up(2, at(230, 100));
    // The finger left behind drains: it neither drags nor taps.
    recognizer.move(1, at(160, 100));
    recognizer.up(1, at(160, 100));
    expect(kinds()).toEqual(['two-finger-end']);
    recognizer.down(3, at(100, 100));
    recognizer.up(3, at(100, 100));
    expect(kinds()).toEqual(['tap']);
  });

  it('slides two fingers together when sliding does something, and otherwise waits for a pinch', () => {
    const sliding = setup({ slides: () => true });
    sliding.recognizer.down(1, at(100, 100));
    sliding.recognizer.down(2, at(200, 100));
    sliding.recognizer.move(1, at(100, 130));
    sliding.recognizer.move(2, at(200, 130));
    expect(sliding.kinds()).toEqual(['slide-start', 'slide-move', 'slide-move']);

    const still = setup();
    still.recognizer.down(1, at(100, 100));
    still.recognizer.down(2, at(200, 100));
    still.recognizer.move(1, at(100, 130));
    still.recognizer.move(2, at(200, 130));
    expect(still.kinds()).toEqual([]);
    // Spreading afterwards still pinches.
    still.recognizer.move(2, at(240, 130));
    expect(still.kinds()).toEqual(['pinch-start', 'pinch-move']);
  });

  it('does not tap after the fingers moved or stayed down too long', () => {
    const moved = setup({ holdDelayMs: () => null, pinches: () => false });
    moved.recognizer.down(1, at(100, 100));
    moved.recognizer.down(2, at(200, 100));
    moved.recognizer.move(1, at(100, 140));
    moved.recognizer.up(1, at(100, 140));
    moved.recognizer.up(2, at(200, 100));
    expect(moved.events).toEqual([]);

    const slow = setup({ holdDelayMs: () => null });
    slow.recognizer.down(1, at(100, 100));
    slow.recognizer.down(2, at(200, 100));
    slow.clock.advance(700);
    slow.recognizer.up(1, at(100, 100));
    slow.recognizer.up(2, at(200, 100));
    expect(slow.events).toEqual([]);
  });

  it('abandons a gesture the system cancels, and ignores fingers it never saw go down', () => {
    const { recognizer, kinds } = setup();
    recognizer.move(9, at(10, 10));
    recognizer.up(9, at(10, 10));
    expect(kinds()).toEqual([]);
    recognizer.down(1, at(100, 100));
    recognizer.move(1, at(140, 100));
    recognizer.cancel(1);
    expect(kinds()).toEqual(['press-start', 'press-move', 'press-cancel']);
  });
});

describe('touch settings', () => {
  it('are read defensively, one setting at a time', () => {
    expect(readTouchSettings(null)).toEqual(DEFAULT_TOUCH_SETTINGS);
    expect(
      readTouchSettings({
        twoFingerTap: 'toggleTool:tool.orbit',
        threeFingerTap: 'explode',
        holdDelayMs: 20,
        twoFingerSlide: 'pan',
        pinchZoom: 'yes',
      }),
    ).toEqual({ ...DEFAULT_TOUCH_SETTINGS, twoFingerTap: 'toggleTool:tool.orbit', twoFingerSlide: 'pan' });
    expect(gestureCommand('command:edit.undo')).toBe('edit.undo');
    expect(gestureTool('toggleTool:tool.pan')).toBe('tool.pan');
    expect(gestureCommand('contextMenu')).toBeNull();
  });
});
