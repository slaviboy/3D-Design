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

/**
 * What a gesture does: nothing, open the context menu, run a command (`command:<id>`), or switch to a tool and back
 * (`toggleTool:<id>`, see `Editor.toggleTool`).
 */
export type GestureAction = 'none' | 'contextMenu' | `command:${string}` | `toggleTool:${string}`;

/** What two fingers moving together do, when they don't pinch. */
export type TwoFingerSlide = 'none' | 'pan' | 'orbit';

export type CornerId = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
export const CORNER_IDS: readonly CornerId[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

/** A corner of the view that runs an action when tapped (or double-tapped) with a finger or a pen. */
export interface CornerSetting {
  readonly action: GestureAction;
  readonly trigger: 'tap' | 'doubleTap';
}

/** How touch and pen input behave, besides one finger driving the active tool. */
export interface TouchSettings {
  readonly twoFingerTap: GestureAction;
  readonly threeFingerTap: GestureAction;
  readonly fourFingerTap: GestureAction;
  /** A finger held still on the view. */
  readonly longPress: GestureAction;
  /** Holding two or three fingers still repeats their tap's action, faster and faster (rapid undo and redo). */
  readonly holdRepeat: boolean;
  /** How long fingers are held still before their action repeats, in milliseconds. */
  readonly holdDelayMs: number;
  readonly twoFingerSlide: TwoFingerSlide;
  /** Two fingers spreading or closing zoom, about the spot where the pinch started. */
  readonly pinchZoom: boolean;
  /** The side button of a pen (S Pen, Wacom, Surface Pen). */
  readonly penButton: GestureAction;
  readonly corners: Readonly<Record<CornerId, CornerSetting>>;
  /** How far each corner zone reaches from its corner, in pixels. */
  readonly cornerSizePx: number;
  /** Faint marks show where the corner zones are and what they do. */
  readonly showCornerHints: boolean;
}

export const CORNER_SIZE_RANGE = Object.freeze({ min: 40, max: 160 });

/**
 * The shortest hold before repeating. Shorter, every two-finger touch would start repeating before it could become a
 * pinch.
 */
export const MIN_HOLD_DELAY_MS = 150;
export const MAX_HOLD_DELAY_MS = 1500;

export const DEFAULT_TOUCH_SETTINGS: TouchSettings = Object.freeze({
  twoFingerTap: 'command:edit.undo',
  threeFingerTap: 'command:edit.redo',
  fourFingerTap: 'command:camera.zoomExtents',
  longPress: 'contextMenu',
  holdRepeat: true,
  holdDelayMs: 500,
  twoFingerSlide: 'none',
  pinchZoom: true,
  penButton: 'toggleTool:tool.orbit',
  corners: Object.freeze({
    topLeft: Object.freeze({ action: 'none', trigger: 'tap' }),
    topRight: Object.freeze({ action: 'none', trigger: 'tap' }),
    bottomLeft: Object.freeze({ action: 'toggleTool:tool.orbit', trigger: 'tap' }),
    bottomRight: Object.freeze({ action: 'toggleTool:tool.pan', trigger: 'tap' }),
  }),
  cornerSizePx: 72,
  showCornerHints: true,
});

const ACTION_KEYS = ['twoFingerTap', 'threeFingerTap', 'fourFingerTap', 'longPress', 'penButton'] as const;
const SLIDES: readonly TwoFingerSlide[] = ['none', 'pan', 'orbit'];

export function isGestureAction(value: unknown): value is GestureAction {
  if (typeof value !== 'string') return false;
  if (value === 'none' || value === 'contextMenu') return true;
  const match = /^(command|toggleTool):(.+)$/.exec(value);
  return match !== null;
}

/** The command a gesture runs, or null when it runs none. */
export function gestureCommand(action: GestureAction): string | null {
  return action.startsWith('command:') ? action.slice('command:'.length) : null;
}

/** The tool a gesture switches to and back, or null. */
export function gestureTool(action: GestureAction): string | null {
  return action.startsWith('toggleTool:') ? action.slice('toggleTool:'.length) : null;
}

function readCorners(value: unknown): Readonly<Record<CornerId, CornerSetting>> {
  const defaults = DEFAULT_TOUCH_SETTINGS.corners;
  if (typeof value !== 'object' || value === null) return defaults;
  const stored = value as Record<string, unknown>;
  const corner = (id: CornerId): CornerSetting => {
    const entry = stored[id];
    if (typeof entry !== 'object' || entry === null) return defaults[id];
    const { action, trigger } = entry as Record<string, unknown>;
    return {
      action: isGestureAction(action) ? action : defaults[id].action,
      trigger: trigger === 'tap' || trigger === 'doubleTap' ? trigger : defaults[id].trigger,
    };
  };
  return {
    topLeft: corner('topLeft'),
    topRight: corner('topRight'),
    bottomLeft: corner('bottomLeft'),
    bottomRight: corner('bottomRight'),
  };
}

/** Reads stored touch settings. Each invalid or missing setting falls back to its default. */
export function readTouchSettings(value: unknown): TouchSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_TOUCH_SETTINGS;
  const stored = value as Record<string, unknown>;
  const size = stored.cornerSizePx;
  const actions = Object.fromEntries(
    ACTION_KEYS.map((key) => [key, isGestureAction(stored[key]) ? stored[key] : DEFAULT_TOUCH_SETTINGS[key]]),
  ) as Pick<TouchSettings, (typeof ACTION_KEYS)[number]>;
  const delay = stored.holdDelayMs;
  return {
    ...actions,
    holdRepeat:
      typeof stored.holdRepeat === 'boolean' ? stored.holdRepeat : DEFAULT_TOUCH_SETTINGS.holdRepeat,
    holdDelayMs:
      typeof delay === 'number' && delay >= MIN_HOLD_DELAY_MS && delay <= MAX_HOLD_DELAY_MS
        ? delay
        : DEFAULT_TOUCH_SETTINGS.holdDelayMs,
    twoFingerSlide: SLIDES.includes(stored.twoFingerSlide as TwoFingerSlide)
      ? (stored.twoFingerSlide as TwoFingerSlide)
      : DEFAULT_TOUCH_SETTINGS.twoFingerSlide,
    pinchZoom: typeof stored.pinchZoom === 'boolean' ? stored.pinchZoom : DEFAULT_TOUCH_SETTINGS.pinchZoom,
    corners: readCorners(stored.corners),
    cornerSizePx:
      typeof size === 'number' && size >= CORNER_SIZE_RANGE.min && size <= CORNER_SIZE_RANGE.max
        ? size
        : DEFAULT_TOUCH_SETTINGS.cornerSizePx,
    showCornerHints:
      typeof stored.showCornerHints === 'boolean'
        ? stored.showCornerHints
        : DEFAULT_TOUCH_SETTINGS.showCornerHints,
  };
}

/** The active corner zone a viewport point lies in, or null: a quarter circle of the zone size at each corner. */
export function cornerAt(
  settings: TouchSettings,
  size: { readonly width: number; readonly height: number },
  point: { readonly x: number; readonly y: number },
): CornerId | null {
  const corners: Readonly<Record<CornerId, { readonly x: number; readonly y: number }>> = {
    topLeft: { x: 0, y: 0 },
    topRight: { x: size.width, y: 0 },
    bottomLeft: { x: 0, y: size.height },
    bottomRight: { x: size.width, y: size.height },
  };
  for (const id of CORNER_IDS) {
    if (settings.corners[id].action === 'none') continue;
    const corner = corners[id];
    if (Math.hypot(point.x - corner.x, point.y - corner.y) <= settings.cornerSizePx) return id;
  }
  return null;
}
