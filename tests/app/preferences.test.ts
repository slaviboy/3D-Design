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

import { describe, expect, it, vi } from 'vitest';
import { AutosaveController } from '../../src/app/autosave/AutosaveController';
import {
  DEFAULT_PREFERENCES,
  parsePreferences,
  precisionChoices,
  presetFor,
  serializePreferences,
  UNIT_PRESETS,
  type Preferences,
} from '../../src/app/preferences/preferences';
import { LINE_TOOL_ID } from '../../src/app/tools/Tool';
import { DEFAULT_TOUCH_SETTINGS } from '../../src/app/gestures/gestureSettings';
import { IMPERIAL_UNIT_SETTINGS } from '../../src/kernel/units/units';
import { click, createTestEditor, MemoryRecoveryRepository, pointer, screenOf, TOP_CAMERA } from './fixtures';

describe('preferences', () => {
  it('are read defensively, one setting at a time', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('not json')).toEqual(DEFAULT_PREFERENCES);
    const architectural = UNIT_PRESETS.find((preset) => preset.id === 'architectural')?.settings;
    const custom: Preferences = {
      theme: 'dark',
      uiScale: 1.25,
      toolTips: false,
      invertWheelZoom: true,
      navigation: {
        device: 'trackpad',
        swipe: 'pan',
        invertOrbit: true,
        invertPan: false,
        zoomSpeed: 2,
        orbitSpeed: 0.5,
        panSpeed: 1,
      },
      touch: {
        ...DEFAULT_TOUCH_SETTINGS,
        twoFingerTap: 'toggleTool:tool.orbit',
        holdDelayMs: 900,
        twoFingerSlide: 'pan',
      },
      autosaveMinutes: 10,
      units: architectural ?? IMPERIAL_UNIT_SETTINGS,
    };
    expect(parsePreferences(serializePreferences(custom))).toEqual(custom);
    // Tool tips are on unless they were turned off, including for settings saved before they existed.
    expect(DEFAULT_PREFERENCES.toolTips).toBe(true);
    expect(parsePreferences(JSON.stringify({ preferences: { theme: 'dark' } })).toolTips).toBe(true);

    const broken = JSON.parse(serializePreferences(custom)) as { preferences: Record<string, unknown> };
    broken.preferences.theme = 'neon';
    broken.preferences.autosaveMinutes = -3;
    broken.preferences.units = { ...IMPERIAL_UNIT_SETTINGS, precision: 99 };
    broken.preferences.navigation = { device: 'joystick', swipe: 'pan', orbitSpeed: 40, invertPan: 'yes' };
    const parsed = parsePreferences(JSON.stringify(broken));
    // Within the navigation settings too, each invalid one falls back on its own.
    expect(parsed.navigation).toEqual({ ...DEFAULT_PREFERENCES.navigation, swipe: 'pan' });
    expect(parsed).toMatchObject({
      theme: 'system',
      autosaveMinutes: 5,
      uiScale: 1.25,
      invertWheelZoom: true,
    });
    expect(parsed.units).toEqual(DEFAULT_PREFERENCES.units);

    expect(presetFor(IMPERIAL_UNIT_SETTINGS)?.id).toBe('architectural');
    expect(precisionChoices('fractional')[2]?.label).toBe('1/4"');
    expect(precisionChoices('decimal')[3]?.label).toBe('0.000');
  });

  it('change units, wheel direction and persistence in the editor', () => {
    const normal = createTestEditor();
    normal.tools.wheel({ x: 100, y: 100, deltaY: 100 });
    const inverted = createTestEditor();
    const saved: Preferences[] = [];
    inverted.setPreferenceStorage({
      load: () => ({ ...DEFAULT_PREFERENCES, invertWheelZoom: true }),
      save: (preferences) => {
        saved.push(preferences);
      },
    });
    inverted.tools.wheel({ x: 100, y: 100, deltaY: 100 });
    const change = (camera: typeof TOP_CAMERA) =>
      Math.sign(camera.orthoHalfHeight - TOP_CAMERA.orthoHalfHeight);
    expect(change(normal.session.camera)).not.toBe(0);
    expect(change(inverted.session.camera)).toBe(-change(normal.session.camera));

    inverted.updatePreferences({ units: IMPERIAL_UNIT_SETTINGS });
    expect(saved).toHaveLength(1);
    expect(inverted.units).toBe(IMPERIAL_UNIT_SETTINGS);
    inverted.activateTool(LINE_TOOL_ID);
    const start = screenOf(1, 1);
    click(inverted, start.x, start.y);
    const end = screenOf(3, 1);
    inverted.tools.pointerMove(pointer(end.x, end.y, { buttons: 0 }));
    expect(inverted.tools.measurement?.value).toMatch(/'/);

    inverted.resetPreferences();
    expect(inverted.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(saved.at(-1)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('autosave interval', () => {
  it('restarts the timer when the interval changes, and stops it for 0', () => {
    const editor = createTestEditor();
    const setInterval = vi.fn(() => Symbol('timer'));
    const clearInterval = vi.fn();
    const autosave = new AutosaveController({
      session: editor.session,
      repository: new MemoryRecoveryRepository(),
      encode: () => editor.encodeDocument(),
      sessionId: 's',
      intervalMs: 60_000,
      timers: { setInterval, clearInterval },
    });
    autosave.setIntervalMs(120_000);
    expect(setInterval).not.toHaveBeenCalled();
    autosave.start();
    expect(setInterval).toHaveBeenLastCalledWith(expect.any(Function), 120_000);
    autosave.setIntervalMs(0);
    expect(clearInterval).toHaveBeenCalledTimes(1);
    expect(autosave.intervalMs).toBe(0);
    autosave.setIntervalMs(300_000);
    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(setInterval).toHaveBeenLastCalledWith(expect.any(Function), 300_000);
    autosave.stop();
    expect(clearInterval).toHaveBeenCalledTimes(2);
  });
});
