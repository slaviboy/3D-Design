import { err, ok, type Result } from '../result';

export type LengthUnit = 'mm' | 'cm' | 'm' | 'km' | 'in' | 'ft' | 'yd' | 'mi';

export const METERS_PER_UNIT: Readonly<Record<LengthUnit, number>> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
  mi: 1609.344,
};

const UNIT_SYMBOL: Readonly<Record<LengthUnit, string>> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  km: 'km',
  in: '"',
  ft: "'",
  yd: 'yd',
  mi: 'mi',
};

/**
 * - `decimal`: a decimal number in the chosen unit (for example `250mm`)
 * - `architectural`: feet and fractional inches (`3' 6 1/2"`)
 * - `engineering`: decimal feet (`3.54'`)
 * - `fractional`: fractional inches (`42 1/2"`)
 */
export type LengthFormat = 'decimal' | 'architectural' | 'engineering' | 'fractional';

export type DecimalSeparator = '.' | ',';

export interface UnitSettings {
  readonly format: LengthFormat;
  /** Display unit for the decimal format. Architectural and fractional always use inches, engineering uses feet. */
  readonly lengthUnit: LengthUnit;
  /** Decimal and engineering: decimal places. Architectural and fractional: inches rounded to 1/2^precision. */
  readonly precision: number;
  /** Show the unit symbol for decimal and engineering values. */
  readonly showUnitSymbol: boolean;
  /** Architectural only: show `3' 0"` instead of `3'`. */
  readonly forceInchDisplay: boolean;
  /** Decimal places for angles in degrees. */
  readonly anglePrecision: number;
  readonly decimalSeparator: DecimalSeparator;
}

export const MAX_DECIMAL_PRECISION = 6;
export const MAX_FRACTION_PRECISION = 6;
export const MAX_ANGLE_PRECISION = 3;

export const METRIC_UNIT_SETTINGS: UnitSettings = Object.freeze({
  format: 'decimal',
  lengthUnit: 'mm',
  precision: 0,
  showUnitSymbol: true,
  forceInchDisplay: false,
  anglePrecision: 1,
  decimalSeparator: '.',
});

export const IMPERIAL_UNIT_SETTINGS: UnitSettings = Object.freeze({
  format: 'architectural',
  lengthUnit: 'in',
  precision: 4,
  showUnitSymbol: true,
  forceInchDisplay: false,
  anglePrecision: 1,
  decimalSeparator: '.',
});

const INCHES_PER_FOOT = 12;
const DEGREES_PER_RADIAN = 180 / Math.PI;
/** Relative difference above which a displayed value is marked approximate with "~". */
const APPROXIMATION_THRESHOLD = 1e-9;

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** The unit that bare numbers are measured in. */
export function baseLengthUnit(settings: UnitSettings): LengthUnit {
  switch (settings.format) {
    case 'decimal':
      return settings.lengthUnit;
    case 'engineering':
      return 'ft';
    case 'architectural':
    case 'fractional':
      return 'in';
  }
}

function isApproximate(displayed: number, exact: number): boolean {
  return Math.abs(displayed - exact) > APPROXIMATION_THRESHOLD * Math.max(1, Math.abs(exact));
}

function formatDecimal(value: number, digits: number, separator: DecimalSeparator): string {
  let text = value.toFixed(digits);
  if (Number(text) === 0) text = (0).toFixed(digits);
  return separator === ',' ? text.replace('.', ',') : text;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

/** `units` counts inches in steps of 1/denominator. */
function fractionalInchesText(units: number, denominator: number): string {
  const whole = Math.floor(units / denominator);
  const remainder = units % denominator;
  if (remainder === 0) return String(whole);
  const divisor = gcd(remainder, denominator);
  const fraction = `${String(remainder / divisor)}/${String(denominator / divisor)}`;
  return whole === 0 ? fraction : `${String(whole)} ${fraction}`;
}

/** Formats a length given in meters. Values that were rounded for display get a "~ " prefix. */
export function formatLength(meters: number, settings: UnitSettings): string {
  if (settings.format === 'decimal' || settings.format === 'engineering') {
    const unit = baseLengthUnit(settings);
    const value = meters / METERS_PER_UNIT[unit];
    const digits = clampInteger(settings.precision, 0, MAX_DECIMAL_PRECISION);
    const text = formatDecimal(value, digits, settings.decimalSeparator);
    const approximate = isApproximate(Number(value.toFixed(digits)), value);
    return `${approximate ? '~ ' : ''}${text}${settings.showUnitSymbol ? UNIT_SYMBOL[unit] : ''}`;
  }

  const denominator = 2 ** clampInteger(settings.precision, 0, MAX_FRACTION_PRECISION);
  const inches = meters / METERS_PER_UNIT.in;
  const units = Math.round(Math.abs(inches) * denominator);
  const approximate = isApproximate(units / denominator, Math.abs(inches));
  const sign = inches < 0 && units !== 0 ? '-' : '';
  let text: string;
  if (settings.format === 'fractional') {
    text = `${fractionalInchesText(units, denominator)}"`;
  } else {
    const unitsPerFoot = INCHES_PER_FOOT * denominator;
    const feet = Math.floor(units / unitsPerFoot);
    const rest = units - feet * unitsPerFoot;
    if (feet === 0) text = `${fractionalInchesText(rest, denominator)}"`;
    else if (rest === 0 && !settings.forceInchDisplay) text = `${String(feet)}'`;
    else text = `${String(feet)}' ${fractionalInchesText(rest, denominator)}"`;
  }
  return `${approximate ? '~ ' : ''}${sign}${text}`;
}

function areaOrVolumeSuffix(unit: LengthUnit, power: 2 | 3): string {
  if (unit === 'in' || unit === 'ft') return `${power === 2 ? ' sq ' : ' cu '}${unit}`;
  return `${unit}${power === 2 ? '²' : '³'}`;
}

function formatPower(value: number, settings: UnitSettings, power: 2 | 3): string {
  const unit = baseLengthUnit(settings);
  const converted = value / METERS_PER_UNIT[unit] ** power;
  const digits =
    settings.format === 'decimal' || settings.format === 'engineering'
      ? clampInteger(settings.precision, 0, MAX_DECIMAL_PRECISION)
      : 2;
  const approximate = isApproximate(Number(converted.toFixed(digits)), converted);
  return `${approximate ? '~ ' : ''}${formatDecimal(converted, digits, settings.decimalSeparator)}${areaOrVolumeSuffix(unit, power)}`;
}

/** Formats an area given in square meters. */
export function formatArea(squareMeters: number, settings: UnitSettings): string {
  return formatPower(squareMeters, settings, 2);
}

/** Formats a volume given in cubic meters. */
export function formatVolume(cubicMeters: number, settings: UnitSettings): string {
  return formatPower(cubicMeters, settings, 3);
}

/** Formats an angle given in radians, in degrees. */
export function formatAngle(radians: number, settings: UnitSettings): string {
  const digits = clampInteger(settings.anglePrecision, 0, MAX_ANGLE_PRECISION);
  return `${formatDecimal(radians * DEGREES_PER_RADIAN, digits, settings.decimalSeparator)}°`;
}

// -------------------------------------------------------------------------------------------------- parsing

const DECIMAL_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
const FRACTION_RE = /^(?:(\d+)[\s-]+)?(\d+)\/(\d+)$/;
const FEET_INCHES_RE = /^([^'"]+?)\s*'\s*-?\s*([^'"]+?)\s*"?$/;
const UNIT_SUFFIX_RE = /^(.*?)\s*(mm|cm|km|m|in|ft|yd|mi|"|')$/i;
const SLOPE_RE = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*:\s*((?:\d+(?:\.\d*)?|\.\d+))$/;
const DEGREES_RE = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:°|deg)?$/i;

/** A non-negative magnitude: `12`, `12.5`, `.5`, `1/2`, `3 1/2`, `3-1/2`. */
function parseMagnitude(text: string): number | null {
  const trimmed = text.trim();
  if (DECIMAL_RE.test(trimmed)) return Number(trimmed);
  const fraction = FRACTION_RE.exec(trimmed);
  if (fraction) {
    const denominator = Number(fraction[3]);
    if (denominator === 0) return null;
    return Number(fraction[1] ?? 0) + Number(fraction[2]) / denominator;
  }
  return null;
}

function unitFromSuffix(suffix: string): LengthUnit {
  const lower = suffix.toLowerCase();
  if (lower === '"') return 'in';
  if (lower === "'") return 'ft';
  return lower as LengthUnit;
}

function normalizeDecimal(text: string, settings: UnitSettings): string {
  return settings.decimalSeparator === ',' ? text.replace(',', '.') : text;
}

/**
 * Parses a typed length and returns meters. Accepts an explicit unit (`250mm`, `2.5m`, `3ft`, `6"`), feet and
 * inches (`3' 6"`, `3'6-1/2"`), fractions, and a leading sign. A bare number is read in the display unit.
 */
export function parseLength(text: string, settings: UnitSettings): Result<number> {
  const raw = text.trim();
  if (raw === '') return err('Enter a length');
  let body = normalizeDecimal(raw, settings);
  let sign = 1;
  if (body.startsWith('-') || body.startsWith('+')) {
    sign = body.startsWith('-') ? -1 : 1;
    body = body.slice(1).trim();
  }

  const feetInches = FEET_INCHES_RE.exec(body);
  if (feetInches) {
    const feet = parseMagnitude(feetInches[1] ?? '');
    const inches = parseMagnitude(feetInches[2] ?? '');
    if (feet === null || inches === null) return err(`"${raw}" is not a valid length`);
    return ok(sign * (feet * METERS_PER_UNIT.ft + inches * METERS_PER_UNIT.in));
  }

  const withUnit = UNIT_SUFFIX_RE.exec(body);
  if (withUnit) {
    const magnitude = parseMagnitude(withUnit[1] ?? '');
    if (magnitude === null) return err(`"${raw}" is not a valid length`);
    return ok(sign * magnitude * METERS_PER_UNIT[unitFromSuffix(withUnit[2] ?? '')]);
  }

  const magnitude = parseMagnitude(body);
  if (magnitude === null) return err(`"${raw}" is not a valid length`);
  return ok(sign * magnitude * METERS_PER_UNIT[baseLengthUnit(settings)]);
}

/** Parses an angle in degrees (`45`, `-12.5°`) or as a slope `rise:run` (`8:12`), and returns radians. */
export function parseAngle(text: string, settings: UnitSettings): Result<number> {
  const raw = text.trim();
  if (raw === '') return err('Enter an angle');
  const body = normalizeDecimal(raw, settings);
  const slope = SLOPE_RE.exec(body);
  if (slope) {
    const rise = Number(slope[1]);
    const run = Number(slope[2]);
    if (rise === 0 && run === 0) return err('A slope needs a non-zero rise or run');
    return ok(Math.atan2(rise, run));
  }
  const degrees = DEGREES_RE.exec(body);
  if (degrees) return ok(Number(degrees[1]) / DEGREES_PER_RADIAN);
  return err(`"${raw}" is not a valid angle`);
}
