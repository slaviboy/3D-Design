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

import {
  IMPERIAL_UNIT_SETTINGS,
  MAX_ANGLE_PRECISION,
  MAX_DECIMAL_PRECISION,
  MAX_FRACTION_PRECISION,
  METERS_PER_UNIT,
  METRIC_UNIT_SETTINGS,
  type LengthFormat,
  type LengthUnit,
  type UnitSettings,
} from '../../kernel/units/units';

export type ThemePreference = 'system' | 'light' | 'dark';

/** Settings that belong to this device rather than to a model. */
export interface Preferences {
  readonly theme: ThemePreference;
  /** Size of the interface chrome relative to the default. */
  readonly uiScale: number;
  /** Show the name of a tool when the pointer rests on its button. */
  readonly toolTips: boolean;
  /** Zoom in when scrolling toward you instead of away. */
  readonly invertWheelZoom: boolean;
  /** Minutes between autosaves of unsaved work; 0 turns autosave off. */
  readonly autosaveMinutes: number;
  /** How lengths and angles are shown and how typed values are read. */
  readonly units: UnitSettings;
}

export const UI_SCALES: readonly number[] = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
export const AUTOSAVE_MINUTE_CHOICES: readonly number[] = [0, 1, 2, 5, 10, 15, 30];
export const MILLISECONDS_PER_MINUTE = 60_000;
const MAX_AUTOSAVE_MINUTES = 120;

export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  theme: 'system',
  uiScale: 1,
  toolTips: true,
  invertWheelZoom: false,
  autosaveMinutes: 5,
  units: METRIC_UNIT_SETTINGS,
});

export interface PreferenceStorage {
  load(): Preferences;
  save(preferences: Preferences): void;
}

export interface UnitPreset {
  readonly id: string;
  readonly label: string;
  readonly settings: UnitSettings;
}

export const UNIT_PRESETS: readonly UnitPreset[] = [
  { id: 'mm', label: 'Millimeters', settings: METRIC_UNIT_SETTINGS },
  { id: 'cm', label: 'Centimeters', settings: { ...METRIC_UNIT_SETTINGS, lengthUnit: 'cm', precision: 1 } },
  { id: 'm', label: 'Meters', settings: { ...METRIC_UNIT_SETTINGS, lengthUnit: 'm', precision: 3 } },
  { id: 'architectural', label: 'Feet and inches', settings: IMPERIAL_UNIT_SETTINGS },
  {
    id: 'fractional',
    label: 'Fractional inches',
    settings: { ...IMPERIAL_UNIT_SETTINGS, format: 'fractional' },
  },
  {
    id: 'inches',
    label: 'Decimal inches',
    settings: { ...IMPERIAL_UNIT_SETTINGS, format: 'decimal', lengthUnit: 'in', precision: 2 },
  },
  {
    id: 'engineering',
    label: 'Decimal feet',
    settings: { ...IMPERIAL_UNIT_SETTINGS, format: 'engineering', lengthUnit: 'ft', precision: 2 },
  },
];

/** The preset these unit settings were based on, matched by format and unit. */
export function presetFor(units: UnitSettings): UnitPreset | undefined {
  return UNIT_PRESETS.find(
    (preset) =>
      preset.settings.format === units.format &&
      (units.format !== 'decimal' || preset.settings.lengthUnit === units.lengthUnit),
  );
}

/** Precision choices for a format: decimal places, or the smallest fraction of an inch. */
export function precisionChoices(format: LengthFormat): { value: number; label: string }[] {
  if (format === 'decimal' || format === 'engineering') {
    return Array.from({ length: MAX_DECIMAL_PRECISION + 1 }, (_, value) => ({
      value,
      label: value === 0 ? '0' : `0.${'0'.repeat(value)}`,
    }));
  }
  return Array.from({ length: MAX_FRACTION_PRECISION + 1 }, (_, value) => ({
    value,
    label: value === 0 ? '1"' : `1/${String(2 ** value)}"`,
  }));
}

export function serializePreferences(preferences: Preferences): string {
  return JSON.stringify({ format: 'planar-preferences', version: 1, preferences });
}

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const FORMATS: readonly LengthFormat[] = ['decimal', 'architectural', 'engineering', 'fractional'];

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function readUnits(value: unknown): UnitSettings | null {
  if (typeof value !== 'object' || value === null) return null;
  const units = value as Record<string, unknown>;
  const format = units.format as LengthFormat;
  const lengthUnit = units.lengthUnit as LengthUnit;
  if (!FORMATS.includes(format) || typeof lengthUnit !== 'string' || !(lengthUnit in METERS_PER_UNIT))
    return null;
  const maxPrecision =
    format === 'decimal' || format === 'engineering' ? MAX_DECIMAL_PRECISION : MAX_FRACTION_PRECISION;
  if (
    !isInteger(units.precision, 0, maxPrecision) ||
    !isInteger(units.anglePrecision, 0, MAX_ANGLE_PRECISION)
  ) {
    return null;
  }
  if (typeof units.showUnitSymbol !== 'boolean' || typeof units.forceInchDisplay !== 'boolean') return null;
  if (units.decimalSeparator !== '.' && units.decimalSeparator !== ',') return null;
  return {
    format,
    lengthUnit,
    precision: units.precision,
    showUnitSymbol: units.showUnitSymbol,
    forceInchDisplay: units.forceInchDisplay,
    anglePrecision: units.anglePrecision,
    decimalSeparator: units.decimalSeparator,
  };
}

/** Reads stored preferences. Each invalid or missing setting falls back to its default. */
export function parsePreferences(text: string | null): Preferences {
  if (text === null) return DEFAULT_PREFERENCES;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  const stored =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>).preferences : undefined;
  if (typeof stored !== 'object' || stored === null) return DEFAULT_PREFERENCES;
  const p = stored as Record<string, unknown>;
  return {
    theme: THEMES.includes(p.theme as ThemePreference)
      ? (p.theme as ThemePreference)
      : DEFAULT_PREFERENCES.theme,
    uiScale:
      typeof p.uiScale === 'number' && UI_SCALES.includes(p.uiScale)
        ? p.uiScale
        : DEFAULT_PREFERENCES.uiScale,
    // Settings saved before tool tips existed get the default, which shows them.
    toolTips: typeof p.toolTips === 'boolean' ? p.toolTips : DEFAULT_PREFERENCES.toolTips,
    invertWheelZoom:
      typeof p.invertWheelZoom === 'boolean' ? p.invertWheelZoom : DEFAULT_PREFERENCES.invertWheelZoom,
    autosaveMinutes: isInteger(p.autosaveMinutes, 0, MAX_AUTOSAVE_MINUTES)
      ? p.autosaveMinutes
      : DEFAULT_PREFERENCES.autosaveMinutes,
    units: readUnits(p.units) ?? DEFAULT_PREFERENCES.units,
  };
}
