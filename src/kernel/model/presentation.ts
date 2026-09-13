import { KernelError } from '../errors';
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  DEFAULT_FOG_SETTINGS,
  DEFAULT_STYLE_SETTINGS,
  EDGE_COLOR_MODES,
  ENVIRONMENT_ID_PATTERN,
  FACE_STYLES,
  MAX_ENVIRONMENT_EXPOSURE,
  STYLE_EXTENSION_RANGE,
  STYLE_WIDTH_RANGE,
  type EnvironmentSettings,
  type FogSettings,
  type NamedStyle,
  type Rgb,
  type StyleSettings,
} from './types';

/*
 * Checks, canonical copies and comparisons for the document's presentation settings: style, in-model styles, fog
 * and environment. Mutations throw on invalid values, the validator reports them, and snapshots write the copies.
 */

/** Longest name of an in-model style. */
export const MAX_STYLE_NAME_LENGTH = 80;

const isUnit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export function rgbValid(color: Rgb): boolean {
  return isUnit(color.r) && isUnit(color.g) && isUnit(color.b);
}

const rgbCopy = (c: Rgb): Rgb => ({ r: c.r, g: c.g, b: c.b });
const sameRgb = (a: Rgb, b: Rgb): boolean =>
  Object.is(a.r, b.r) && Object.is(a.g, b.g) && Object.is(a.b, b.b);

const inRange = (value: number, range: { readonly min: number; readonly max: number }): boolean =>
  Number.isFinite(value) && value >= range.min && value <= range.max;

// -------------------------------------------------------------------------------------------------- style

const STYLE_COLOR_KEYS = [
  'frontColor',
  'backColor',
  'edgeColor',
  'backgroundColor',
  'skyColor',
  'groundColor',
] as const;

/** The first problem with style settings, or null when they are valid. */
export function styleProblem(style: StyleSettings): string | null {
  if (!FACE_STYLES.includes(style.faceStyle)) return 'unknown face style';
  if (!EDGE_COLOR_MODES.includes(style.edgeColorMode)) return 'unknown edge color mode';
  if (STYLE_COLOR_KEYS.some((key) => !rgbValid(style[key]))) return 'colors need channels from 0 to 1';
  if (!inRange(style.profileWidth, STYLE_WIDTH_RANGE) || !inRange(style.depthCueWidth, STYLE_WIDTH_RANGE)) {
    return `edge widths must be ${String(STYLE_WIDTH_RANGE.min)} to ${String(STYLE_WIDTH_RANGE.max)} pixels`;
  }
  if (!inRange(style.extensionLength, STYLE_EXTENSION_RANGE)) {
    return `extension length must be ${String(STYLE_EXTENSION_RANGE.min)} to ${String(STYLE_EXTENSION_RANGE.max)} pixels`;
  }
  return null;
}

/** A copy with a fixed key order, so equal settings serialize identically. */
export function styleCopy(s: StyleSettings): StyleSettings {
  return {
    faceStyle: s.faceStyle,
    xRay: s.xRay,
    frontColor: rgbCopy(s.frontColor),
    backColor: rgbCopy(s.backColor),
    showEdges: s.showEdges,
    backEdges: s.backEdges,
    profiles: s.profiles,
    profileWidth: s.profileWidth,
    depthCue: s.depthCue,
    depthCueWidth: s.depthCueWidth,
    extensions: s.extensions,
    extensionLength: s.extensionLength,
    endpoints: s.endpoints,
    edgeColorMode: s.edgeColorMode,
    edgeColor: rgbCopy(s.edgeColor),
    backgroundColor: rgbCopy(s.backgroundColor),
    sky: s.sky,
    skyColor: rgbCopy(s.skyColor),
    ground: s.ground,
    groundColor: rgbCopy(s.groundColor),
    groundFromBelow: s.groundFromBelow,
  };
}

export function sameStyle(a: StyleSettings, b: StyleSettings): boolean {
  return (Object.keys(DEFAULT_STYLE_SETTINGS) as (keyof StyleSettings)[]).every((key) => {
    const x = a[key];
    const y = b[key];
    return typeof x === 'object' && typeof y === 'object' ? sameRgb(x, y) : Object.is(x, y);
  });
}

export const isDefaultStyle = (s: StyleSettings): boolean => sameStyle(s, DEFAULT_STYLE_SETTINGS);

/** Checks style settings and returns a canonical copy; throws a KernelError for invalid values. */
export function normalizeStyleSettings(style: StyleSettings): StyleSettings {
  const problem = styleProblem(style);
  if (problem !== null) throw new KernelError('invalid-operation', `Invalid style: ${problem}`);
  return styleCopy(style);
}

// -------------------------------------------------------------------------------------------------- in-model styles

export function namedStylesProblem(styles: readonly NamedStyle[]): string | null {
  const names = new Set<string>();
  for (const style of styles) {
    const name = style.name.trim();
    if (name === '' || name !== style.name || name.length > MAX_STYLE_NAME_LENGTH) {
      return `style names must be 1 to ${String(MAX_STYLE_NAME_LENGTH)} characters without surrounding spaces`;
    }
    if (names.has(name)) return `the style name "${name}" is used more than once`;
    names.add(name);
    const problem = styleProblem(style.settings);
    if (problem !== null) return `style "${name}": ${problem}`;
  }
  return null;
}

export const namedStylesCopy = (styles: readonly NamedStyle[]): NamedStyle[] =>
  styles.map((style) => ({ name: style.name, settings: styleCopy(style.settings) }));

export function sameNamedStyles(a: readonly NamedStyle[], b: readonly NamedStyle[]): boolean {
  return (
    a.length === b.length &&
    a.every((style, i) => {
      const other = b[i];
      return other?.name === style.name && sameStyle(style.settings, other.settings);
    })
  );
}

// -------------------------------------------------------------------------------------------------- fog

export function fogProblem(fog: FogSettings): string | null {
  if (!rgbValid(fog.color)) return 'the color needs channels from 0 to 1';
  if (!Number.isFinite(fog.start) || !Number.isFinite(fog.end) || fog.start < 0 || fog.end <= fog.start) {
    return 'fog needs a start distance of 0 or more and an end distance beyond it';
  }
  return null;
}

export const fogCopy = (f: FogSettings): FogSettings => ({
  enabled: f.enabled,
  start: f.start,
  end: f.end,
  useBackgroundColor: f.useBackgroundColor,
  color: rgbCopy(f.color),
});

export const sameFog = (a: FogSettings, b: FogSettings): boolean =>
  a.enabled === b.enabled &&
  Object.is(a.start, b.start) &&
  Object.is(a.end, b.end) &&
  a.useBackgroundColor === b.useBackgroundColor &&
  sameRgb(a.color, b.color);

export const isDefaultFog = (f: FogSettings): boolean => sameFog(f, DEFAULT_FOG_SETTINGS);

export function normalizeFogSettings(fog: FogSettings): FogSettings {
  const problem = fogProblem(fog);
  if (problem !== null) throw new KernelError('invalid-operation', `Invalid fog: ${problem}`);
  return fogCopy(fog);
}

// -------------------------------------------------------------------------------------------------- environment

export function environmentProblem(env: EnvironmentSettings): string | null {
  if (!ENVIRONMENT_ID_PATTERN.test(env.environmentId)) return 'the environment id is not valid';
  if (!Number.isFinite(env.rotationDegrees) || env.rotationDegrees < 0 || env.rotationDegrees >= 360) {
    return 'rotation must be at least 0 and below 360 degrees';
  }
  if (!Number.isFinite(env.exposure) || env.exposure < 0 || env.exposure > MAX_ENVIRONMENT_EXPOSURE) {
    return `exposure must be 0 to ${String(MAX_ENVIRONMENT_EXPOSURE)}`;
  }
  return null;
}

export const environmentCopy = (e: EnvironmentSettings): EnvironmentSettings => ({
  enabled: e.enabled,
  environmentId: e.environmentId,
  rotationDegrees: e.rotationDegrees,
  exposure: e.exposure,
  showAsBackground: e.showAsBackground,
  useForReflections: e.useForReflections,
});

export const sameEnvironment = (a: EnvironmentSettings, b: EnvironmentSettings): boolean =>
  (Object.keys(DEFAULT_ENVIRONMENT_SETTINGS) as (keyof EnvironmentSettings)[]).every((key) =>
    Object.is(a[key], b[key]),
  );

export const isDefaultEnvironment = (e: EnvironmentSettings): boolean =>
  sameEnvironment(e, DEFAULT_ENVIRONMENT_SETTINGS);

/** Checks environment settings, turning the rotation into [0, 360); throws a KernelError for invalid values. */
export function normalizeEnvironmentSettings(env: EnvironmentSettings): EnvironmentSettings {
  const rotation = Number.isFinite(env.rotationDegrees) ? ((env.rotationDegrees % 360) + 360) % 360 : NaN;
  const normalized = environmentCopy({ ...env, rotationDegrees: rotation === 360 ? 0 : rotation });
  const problem = environmentProblem(normalized);
  if (problem !== null) throw new KernelError('invalid-operation', `Invalid environment: ${problem}`);
  return normalized;
}
