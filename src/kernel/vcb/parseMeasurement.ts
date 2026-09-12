import { vec3, type Vec3 } from '../math/vec3';
import { err, ok, type Result } from '../result';
import { parseAngle, parseLength, type UnitSettings } from '../units/units';

/** Typed meaning of text entered in the measurements box. Lengths are meters, angles radians. */
export type MeasurementIntent =
  | { readonly kind: 'length'; readonly value: number }
  /** `8',20'`, `3,` or `,3`. A `null` entry keeps the current value. */
  | { readonly kind: 'lengthPair'; readonly first: number | null; readonly second: number | null }
  /** `[x,y,z]`: a point in model coordinates. */
  | { readonly kind: 'absolutePoint'; readonly point: Vec3 }
  /** `<x,y,z>`: an offset from the operation's start point. */
  | { readonly kind: 'relativePoint'; readonly offset: Vec3 }
  /** `3x` / `3*` copies beyond the first, `3/` or `/3` copies evenly between the original and the first. */
  | { readonly kind: 'copies'; readonly count: number; readonly mode: 'external' | 'internal' }
  /** `12s`: number of curve segments. */
  | { readonly kind: 'segments'; readonly count: number }
  /** `20c`: segment count of the full circle the arc belongs to. */
  | { readonly kind: 'circleSegments'; readonly count: number }
  /** `24r`, `5mr`: radius. */
  | { readonly kind: 'radius'; readonly value: number }
  | { readonly kind: 'angle'; readonly radians: number }
  /** `2`, `50%`, `2,3` or `2,3,4`: scale factors. */
  | { readonly kind: 'scale'; readonly factors: readonly number[] };

export type MeasurementKind = MeasurementIntent['kind'];

export const MAX_TYPED_COUNT = 9999;
const MIN_CIRCLE_SEGMENTS = 3;
const PERCENT = 100;

const COPIES_EXTERNAL_RE = /^(\d+)\s*[x*]$/i;
const COPIES_INTERNAL_RE = /^(?:(\d+)\s*\/|\/\s*(\d+))$/;
const SEGMENTS_RE = /^(\d+)\s*s$/i;
const CIRCLE_SEGMENTS_RE = /^(\d+)\s*c$/i;
const RADIUS_RE = /^(.+?)\s*r$/i;
const SCALE_RE = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(%)?$/;

function parseCount(text: string | undefined, minimum: number): number | null {
  const count = Number(text);
  return Number.isInteger(count) && count >= minimum && count <= MAX_TYPED_COUNT ? count : null;
}

function parseScaleFactor(text: string, settings: UnitSettings): number | null {
  const body = settings.decimalSeparator === ',' ? text.trim().replace(',', '.') : text.trim();
  const match = SCALE_RE.exec(body);
  if (!match) return null;
  const value = Number(match[1]) / (match[2] ? PERCENT : 1);
  return value !== 0 && Number.isFinite(value) ? value : null;
}

function parsePoint(inner: string, separator: string, settings: UnitSettings): Vec3 | null {
  const parts = inner.split(separator);
  if (parts.length !== 3) return null;
  const values = parts.map((part) => parseLength(part, settings));
  const [x, y, z] = values;
  if (!x?.ok || !y?.ok || !z?.ok) return null;
  return vec3(x.value, y.value, z.value);
}

/**
 * Interprets measurements box input for a tool that accepts the given kinds. A tool lists only what it understands:
 * Line accepts lengths and points, Rectangle length pairs, Move lengths, points and copies, and so on.
 */
export function parseMeasurement(
  text: string,
  accepts: readonly MeasurementKind[],
  settings: UnitSettings,
): Result<MeasurementIntent> {
  const input = text.trim();
  if (input === '') return err('Type a value, then press Enter');
  const can = (kind: MeasurementKind): boolean => accepts.includes(kind);
  const listSeparator = settings.decimalSeparator === ',' ? ';' : ',';

  if (input.startsWith('[') || input.startsWith('<')) {
    const absolute = input.startsWith('[') && input.endsWith(']');
    const relative = input.startsWith('<') && input.endsWith('>');
    if ((absolute && can('absolutePoint')) || (relative && can('relativePoint'))) {
      const point = parsePoint(input.slice(1, -1), listSeparator, settings);
      if (!point) return err('Enter three coordinates, for example [1m, 2m, 0]');
      return ok(absolute ? { kind: 'absolutePoint', point } : { kind: 'relativePoint', offset: point });
    }
    return err('Coordinates are not accepted here');
  }

  if (can('copies')) {
    const external = COPIES_EXTERNAL_RE.exec(input);
    const internal = COPIES_INTERNAL_RE.exec(input);
    if (external || internal) {
      const count = parseCount(external ? external[1] : (internal?.[1] ?? internal?.[2]), 1);
      if (count === null) return err(`Copies must be a whole number from 1 to ${String(MAX_TYPED_COUNT)}`);
      return ok({ kind: 'copies', count, mode: external ? 'external' : 'internal' });
    }
  }

  if (can('segments')) {
    const match = SEGMENTS_RE.exec(input);
    if (match) {
      const count = parseCount(match[1], 1);
      return count === null
        ? err('Segments must be a positive whole number')
        : ok({ kind: 'segments', count });
    }
  }

  if (can('circleSegments')) {
    const match = CIRCLE_SEGMENTS_RE.exec(input);
    if (match) {
      const count = parseCount(match[1], MIN_CIRCLE_SEGMENTS);
      return count === null
        ? err(`A circle needs at least ${String(MIN_CIRCLE_SEGMENTS)} segments`)
        : ok({ kind: 'circleSegments', count });
    }
  }

  if (can('radius')) {
    const match = RADIUS_RE.exec(input);
    if (match?.[1]) {
      const radius = parseLength(match[1], settings);
      if (!radius.ok) return radius;
      return radius.value > 0
        ? ok({ kind: 'radius', value: radius.value })
        : err('The radius must be positive');
    }
  }

  if (input.includes(listSeparator)) {
    const parts = input.split(listSeparator);
    if (can('lengthPair') && parts.length === 2) {
      const [firstText = '', secondText = ''] = parts;
      const read = (part: string): Result<number | null> =>
        part.trim() === '' ? ok(null) : parseLength(part, settings);
      const first = read(firstText);
      const second = read(secondText);
      if (!first.ok) return first;
      if (!second.ok) return second;
      if (first.value === null && second.value === null) return err('Enter at least one dimension');
      return ok({ kind: 'lengthPair', first: first.value, second: second.value });
    }
    if (can('scale') && (parts.length === 2 || parts.length === 3)) {
      const factors = parts.map((part) => parseScaleFactor(part, settings));
      if (factors.every((factor): factor is number => factor !== null)) return ok({ kind: 'scale', factors });
      return err('Scale factors must be non-zero numbers');
    }
    return err(`"${input}" is not accepted here`);
  }

  if (can('angle')) {
    const angle = parseAngle(input, settings);
    if (angle.ok) return ok({ kind: 'angle', radians: angle.value });
    if (!can('length') && !can('scale')) return angle;
  }

  if (can('scale')) {
    const factor = parseScaleFactor(input, settings);
    if (factor !== null) return ok({ kind: 'scale', factors: [factor] });
    if (!can('length')) return err('Enter a non-zero scale factor, for example 2 or 50%');
  }

  if (can('length')) {
    const length = parseLength(input, settings);
    return length.ok ? ok({ kind: 'length', value: length.value }) : length;
  }

  return err(`"${input}" is not accepted here`);
}
