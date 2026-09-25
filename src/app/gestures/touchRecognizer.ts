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

import type { ScreenPoint } from '../camera/camera';

/** Finger travel up to this is jitter, not a drag, in pixels. */
export const TOUCH_SLOP_PX = 8;
/** A finger held still this long is a long press, in milliseconds. */
export const LONG_PRESS_MS = 450;
/** A tap this soon and this close after the last one counts as the next click of a double or triple tap. */
export const MULTI_TAP_MS = 350;
export const MULTI_TAP_PX = 24;
/** The fingers of a two-, three- or four-finger touch may travel this far and still tap or hold, in pixels. */
export const MULTI_FINGER_SLOP_PX = 12;
/** A change of the distance between two fingers this large makes their gesture a pinch, in pixels. */
export const PINCH_COMMIT_PX = 10;
/** A tap with several fingers lasts at most this long, from the gesture's start to the last finger lifting. */
export const MULTI_TAP_MAX_MS = 500;

/** The timers the recognizer needs; the editor's animation clock provides them. */
export interface GestureClock {
  now(): number;
  setTimer(callback: () => void, milliseconds: number): number;
  clearTimer(handle: number): void;
}

/** What the recognizer asks when it decides what a touch is. */
export interface TouchProbe {
  /**
   * True when a finger dragged now should move the pointer rather than press: an operation is underway, or a press
   * would act at once. A long press then aims too, instead of opening the context menu (which would end it).
   */
  aims(): boolean;
  /** How long two or three fingers are held still before holding counts, or null when holding does nothing. */
  holdDelayMs(): number | null;
  /** Whether two fingers spreading or closing zoom. */
  pinches(): boolean;
  /** Whether two fingers moving together do something. */
  slides(): boolean;
}

/** A gesture found in the touches, in viewport pixels. */
export type TouchGesture =
  /** One finger tapped; `count` is 2 for a double tap. */
  | { readonly kind: 'tap'; readonly point: ScreenPoint; readonly count: number }
  /** One finger pressed and dragged: a mouse press, moves and release. */
  | { readonly kind: 'press-start'; readonly point: ScreenPoint }
  | { readonly kind: 'press-move'; readonly point: ScreenPoint }
  | { readonly kind: 'press-end'; readonly point: ScreenPoint }
  | { readonly kind: 'press-cancel' }
  /** One finger dragged while aiming: the pointer moves, and lifting the finger clicks where it is. */
  | { readonly kind: 'aim-move'; readonly point: ScreenPoint }
  | { readonly kind: 'aim-end'; readonly point: ScreenPoint }
  | { readonly kind: 'long-press'; readonly point: ScreenPoint }
  /** Dragging after a long press: a selection box. */
  | { readonly kind: 'box-start'; readonly point: ScreenPoint }
  | { readonly kind: 'box-move'; readonly point: ScreenPoint }
  | { readonly kind: 'box-end'; readonly point: ScreenPoint }
  | { readonly kind: 'box-cancel' }
  | { readonly kind: 'multi-tap'; readonly fingers: number; readonly point: ScreenPoint }
  | { readonly kind: 'hold-start'; readonly fingers: number; readonly point: ScreenPoint }
  | { readonly kind: 'hold-end' }
  /** Two fingers pinching: `span` is the distance between them, measured from where the pinch started. */
  | {
      readonly kind: 'pinch-start';
      readonly centroid: ScreenPoint;
      readonly span: number;
    }
  | { readonly kind: 'pinch-move'; readonly centroid: ScreenPoint; readonly span: number }
  | { readonly kind: 'slide-start'; readonly centroid: ScreenPoint }
  | { readonly kind: 'slide-move'; readonly centroid: ScreenPoint }
  | { readonly kind: 'two-finger-end' };

interface Finger {
  start: ScreenPoint;
  latest: ScreenPoint;
}

/** Several fingers: still (they may tap or hold), moving (not yet a pinch or slide), or one of the gestures. */
type MultiMode = 'still' | 'moving' | 'pinch' | 'slide' | 'hold' | 'lifting' | 'ignored';

interface Multi {
  readonly kind: 'multi';
  /**
   * False when the touch began as a drag with one finger: stopping a drag by adding a finger must not undo, so it
   * may still pinch or slide but never tap or hold.
   */
  readonly taps: boolean;
  fingers: number;
  startTime: number;
  centroid: ScreenPoint;
  span: number;
  holdTimer: number | null;
  mode: MultiMode;
}

type State =
  | { readonly kind: 'idle' }
  /** One finger down, not yet a tap, drag or long press. Nothing has reached the tool yet. */
  | { readonly kind: 'pending'; readonly id: number; readonly timer: number }
  | { readonly kind: 'pressing'; readonly id: number }
  | { readonly kind: 'aiming'; readonly id: number }
  /** A long press opened the context menu; dragging now draws a selection box. */
  | { readonly kind: 'menu'; readonly id: number }
  | { readonly kind: 'boxing'; readonly id: number }
  | Multi
  /** A gesture ended while fingers remain: they are ignored until all are lifted, so nothing leaks into a tool. */
  | { readonly kind: 'draining' };

const distanceBetween = (a: ScreenPoint, b: ScreenPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Turns touches on the view into gestures. The first finger is held back until it is clearly a tap, a drag or a
 * long press, or a second finger joins it, so a multi-finger gesture never leaks a click into the active tool.
 */
export class TouchRecognizer {
  readonly #clock: GestureClock;
  readonly #probe: TouchProbe;
  readonly #emit: (gesture: TouchGesture) => void;
  readonly #fingers = new Map<number, Finger>();
  #state: State = { kind: 'idle' };
  #lastTap: { readonly point: ScreenPoint; readonly time: number; readonly count: number } | null = null;

  constructor(clock: GestureClock, probe: TouchProbe, emit: (gesture: TouchGesture) => void) {
    this.#clock = clock;
    this.#probe = probe;
    this.#emit = emit;
  }

  /** Fingers on the view. */
  get activeCount(): number {
    return this.#fingers.size;
  }

  down(id: number, point: ScreenPoint): void {
    if (this.#fingers.has(id)) return;
    this.#fingers.set(id, { start: point, latest: point });
    const state = this.#state;
    switch (state.kind) {
      case 'idle':
        this.#state = {
          kind: 'pending',
          id,
          timer: this.#clock.setTimer(() => {
            this.#longPressTimeout(id);
          }, LONG_PRESS_MS),
        };
        return;
      case 'pending':
        this.#clock.clearTimer(state.timer);
        this.#startMulti(true);
        return;
      case 'pressing':
        this.#emit({ kind: 'press-cancel' });
        this.#startMulti(false);
        return;
      case 'aiming':
        // The pointer stops where it is, without a click.
        this.#startMulti(false);
        return;
      case 'menu':
        this.#state = { kind: 'draining' };
        return;
      case 'boxing':
        this.#emit({ kind: 'box-cancel' });
        this.#state = { kind: 'draining' };
        return;
      case 'multi':
        this.#addFinger(state);
        return;
      case 'draining':
        return;
    }
  }

  move(id: number, point: ScreenPoint): void {
    const finger = this.#fingers.get(id);
    if (!finger) return;
    finger.latest = point;
    const state = this.#state;
    switch (state.kind) {
      case 'pending':
        if (distanceBetween(finger.start, point) <= TOUCH_SLOP_PX) return;
        this.#clock.clearTimer(state.timer);
        if (this.#probe.aims()) {
          this.#state = { kind: 'aiming', id };
          this.#emit({ kind: 'aim-move', point });
        } else {
          this.#state = { kind: 'pressing', id };
          this.#emit({ kind: 'press-start', point: finger.start });
          this.#emit({ kind: 'press-move', point });
        }
        return;
      case 'pressing':
        this.#emit({ kind: 'press-move', point });
        return;
      case 'aiming':
        this.#emit({ kind: 'aim-move', point });
        return;
      case 'menu':
        if (distanceBetween(finger.start, point) <= TOUCH_SLOP_PX) return;
        this.#state = { kind: 'boxing', id };
        this.#emit({ kind: 'box-start', point: finger.start });
        this.#emit({ kind: 'box-move', point });
        return;
      case 'boxing':
        this.#emit({ kind: 'box-move', point });
        return;
      case 'multi':
        this.#multiMove(state);
        return;
      default:
        return;
    }
  }

  up(id: number, point: ScreenPoint): void {
    const finger = this.#fingers.get(id);
    if (!finger) return;
    finger.latest = point;
    this.#fingers.delete(id);
    const state = this.#state;
    switch (state.kind) {
      case 'pending':
        this.#clock.clearTimer(state.timer);
        this.#state = { kind: 'idle' };
        this.#tap(finger.start);
        return;
      case 'pressing':
        this.#emit({ kind: 'press-end', point });
        this.#settle();
        return;
      case 'aiming':
        this.#emit({ kind: 'aim-end', point });
        this.#settle();
        return;
      case 'menu':
        this.#settle();
        return;
      case 'boxing':
        this.#emit({ kind: 'box-end', point });
        this.#settle();
        return;
      case 'multi':
        this.#multiUp(state);
        return;
      default:
        this.#settle();
        return;
    }
  }

  /** The system took a finger away (an OS gesture, for example): whatever it was doing is abandoned. */
  cancel(id: number): void {
    if (!this.#fingers.delete(id)) return;
    const state = this.#state;
    switch (state.kind) {
      case 'pending':
        this.#clock.clearTimer(state.timer);
        break;
      case 'pressing':
        this.#emit({ kind: 'press-cancel' });
        break;
      case 'boxing':
        this.#emit({ kind: 'box-cancel' });
        break;
      case 'multi':
        this.#endMulti(state);
        break;
      default:
        break;
    }
    this.#state = { kind: 'draining' };
    this.#settle();
  }

  /** Forgets every finger and timer, as when the view goes away. */
  reset(): void {
    const state = this.#state;
    if (state.kind === 'pending') this.#clock.clearTimer(state.timer);
    if (state.kind === 'multi' && state.holdTimer !== null) this.#clock.clearTimer(state.holdTimer);
    this.#fingers.clear();
    this.#state = { kind: 'idle' };
  }

  #settle(): void {
    this.#state = this.#fingers.size === 0 ? { kind: 'idle' } : { kind: 'draining' };
  }

  #tap(point: ScreenPoint): void {
    const now = this.#clock.now();
    const last = this.#lastTap;
    // Later taps of a double tap act where the first one did, so a double tap doesn't draw a tiny line.
    const next =
      last && now - last.time <= MULTI_TAP_MS && distanceBetween(last.point, point) <= MULTI_TAP_PX
        ? { point: last.point, time: now, count: last.count + 1 }
        : { point, time: now, count: 1 };
    this.#lastTap = next;
    this.#emit({ kind: 'tap', point: next.point, count: next.count });
  }

  #longPressTimeout(id: number): void {
    const state = this.#state;
    const finger = this.#fingers.get(id);
    if (state.kind !== 'pending' || state.id !== id || !finger) return;
    if (this.#probe.aims()) {
      this.#state = { kind: 'aiming', id };
      this.#emit({ kind: 'aim-move', point: finger.latest });
      return;
    }
    this.#state = { kind: 'menu', id };
    this.#emit({ kind: 'long-press', point: finger.start });
  }

  /** The fingers' middle and, for two or more, the distance between the first two. */
  #shape(): { readonly centroid: ScreenPoint; readonly span: number } {
    const fingers = [...this.#fingers.values()];
    const x = fingers.reduce((sum, finger) => sum + finger.latest.x, 0) / Math.max(fingers.length, 1);
    const y = fingers.reduce((sum, finger) => sum + finger.latest.y, 0) / Math.max(fingers.length, 1);
    const [first, second] = fingers;
    return {
      centroid: { x, y },
      span: first && second ? distanceBetween(first.latest, second.latest) : 0,
    };
  }

  #startMulti(taps: boolean): void {
    const multi: Multi = {
      kind: 'multi',
      taps,
      fingers: 0,
      startTime: this.#clock.now(),
      centroid: { x: 0, y: 0 },
      span: 0,
      holdTimer: null,
      mode: 'still',
    };
    this.#state = multi;
    this.#addFinger(multi);
  }

  /** A finger joined the touch: while it is still, the tap or hold now counts one more finger. */
  #addFinger(multi: Multi): void {
    if (multi.mode !== 'still') {
      if (multi.mode === 'lifting') multi.mode = 'ignored';
      return;
    }
    // Movement counts from the moment the last finger arrived.
    for (const finger of this.#fingers.values()) finger.start = finger.latest;
    const shape = this.#shape();
    multi.fingers = Math.max(multi.fingers, this.#fingers.size);
    multi.centroid = shape.centroid;
    multi.span = shape.span;
    if (multi.holdTimer !== null) this.#clock.clearTimer(multi.holdTimer);
    multi.holdTimer = null;
    const delay = this.#probe.holdDelayMs();
    if (multi.taps && delay !== null && (multi.fingers === 2 || multi.fingers === 3)) {
      multi.holdTimer = this.#clock.setTimer(() => {
        multi.holdTimer = null;
        if (this.#state !== multi || multi.mode !== 'still') return;
        multi.mode = 'hold';
        this.#emit({ kind: 'hold-start', fingers: multi.fingers, point: multi.centroid });
      }, delay);
    }
  }

  #multiMove(multi: Multi): void {
    if (multi.mode === 'still') {
      const moved = [...this.#fingers.values()].some(
        (finger) => distanceBetween(finger.start, finger.latest) > MULTI_FINGER_SLOP_PX,
      );
      if (!moved) return;
      if (multi.holdTimer !== null) this.#clock.clearTimer(multi.holdTimer);
      multi.holdTimer = null;
      // Only two fingers pinch or slide; more fingers moving do nothing.
      multi.mode = multi.fingers === 2 && this.#fingers.size === 2 ? 'moving' : 'ignored';
    }
    const shape = this.#shape();
    switch (multi.mode) {
      case 'moving': {
        const spread = Math.abs(shape.span - multi.span);
        const travel = distanceBetween(shape.centroid, multi.centroid);
        if (this.#probe.pinches() && spread >= PINCH_COMMIT_PX) {
          multi.mode = 'pinch';
          this.#emit({ kind: 'pinch-start', centroid: multi.centroid, span: multi.span });
          this.#emit({ kind: 'pinch-move', centroid: shape.centroid, span: shape.span });
        } else if (this.#probe.slides() && travel >= MULTI_FINGER_SLOP_PX && spread < PINCH_COMMIT_PX) {
          multi.mode = 'slide';
          this.#emit({ kind: 'slide-start', centroid: multi.centroid });
          this.#emit({ kind: 'slide-move', centroid: shape.centroid });
        }
        return;
      }
      case 'pinch':
        this.#emit({ kind: 'pinch-move', centroid: shape.centroid, span: shape.span });
        return;
      case 'slide':
        this.#emit({ kind: 'slide-move', centroid: shape.centroid });
        return;
      default:
        return;
    }
  }

  #multiUp(multi: Multi): void {
    if (multi.mode === 'still') {
      if (multi.holdTimer !== null) this.#clock.clearTimer(multi.holdTimer);
      multi.holdTimer = null;
      multi.mode = 'lifting';
    }
    if (multi.mode === 'lifting') {
      if (this.#fingers.size > 0) return;
      this.#state = { kind: 'idle' };
      if (multi.taps && this.#clock.now() - multi.startTime <= MULTI_TAP_MAX_MS) {
        this.#emit({ kind: 'multi-tap', fingers: multi.fingers, point: multi.centroid });
      }
      return;
    }
    this.#endMulti(multi);
    this.#state = { kind: 'draining' };
    this.#settle();
  }

  #endMulti(multi: Multi): void {
    if (multi.holdTimer !== null) this.#clock.clearTimer(multi.holdTimer);
    multi.holdTimer = null;
    if (multi.mode === 'hold') this.#emit({ kind: 'hold-end' });
    else if (multi.mode === 'pinch' || multi.mode === 'slide') this.#emit({ kind: 'two-finger-end' });
    multi.mode = 'ignored';
  }
}
