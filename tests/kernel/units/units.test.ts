import { describe, expect, it } from 'vitest';
import {
  formatAngle,
  formatArea,
  formatLength,
  formatVolume,
  IMPERIAL_UNIT_SETTINGS,
  METRIC_UNIT_SETTINGS,
  parseAngle,
  parseLength,
  type UnitSettings,
} from '../../../src/kernel/units/units';

const meters: UnitSettings = { ...METRIC_UNIT_SETTINGS, lengthUnit: 'm', precision: 3 };

describe('formatLength', () => {
  it('formats decimal lengths, marking rounded values as approximate', () => {
    expect(formatLength(2.5, METRIC_UNIT_SETTINGS)).toBe('2500mm');
    expect(formatLength(0.0123456, meters)).toBe('~ 0.012m');
    expect(formatLength(-0.0000001, meters)).toBe('~ 0.000m');
    expect(formatLength(2.5, { ...meters, decimalSeparator: ',' })).toBe('2,500m');
    expect(formatLength(2.5, { ...meters, showUnitSymbol: false })).toBe('2.500');
  });

  it('formats architectural feet and inches', () => {
    expect(formatLength(1.0668, IMPERIAL_UNIT_SETTINGS)).toBe(`3' 6"`);
    expect(formatLength(0.9144, IMPERIAL_UNIT_SETTINGS)).toBe(`3'`);
    expect(formatLength(0.9144, { ...IMPERIAL_UNIT_SETTINGS, forceInchDisplay: true })).toBe(`3' 0"`);
    expect(formatLength(0.0127, IMPERIAL_UNIT_SETTINGS)).toBe(`1/2"`);
    expect(formatLength(-1.0795, IMPERIAL_UNIT_SETTINGS)).toBe(`-3' 6 1/2"`);
    expect(formatLength(1, IMPERIAL_UNIT_SETTINGS)).toBe(`~ 3' 3 3/8"`);
  });

  it('formats fractional inches and engineering feet', () => {
    expect(formatLength(0.0889, { ...IMPERIAL_UNIT_SETTINGS, format: 'fractional' })).toBe(`3 1/2"`);
    expect(formatLength(1.0668, { ...IMPERIAL_UNIT_SETTINGS, format: 'engineering', precision: 2 })).toBe(
      `3.50'`,
    );
  });

  it('formats areas, volumes and angles', () => {
    expect(formatArea(1, METRIC_UNIT_SETTINGS)).toBe('1000000mm²');
    expect(formatArea(0.09290304, IMPERIAL_UNIT_SETTINGS)).toBe('144.00 sq in');
    expect(formatVolume(1, { ...meters, precision: 1 })).toBe('1.0m³');
    expect(
      formatVolume(0.0283168466, { ...IMPERIAL_UNIT_SETTINGS, format: 'engineering', precision: 2 }),
    ).toBe('1.00 cu ft');
    expect(formatAngle(Math.PI / 4, METRIC_UNIT_SETTINGS)).toBe('45.0°');
  });
});

describe('parseLength', () => {
  it.each([
    ['2500', METRIC_UNIT_SETTINGS, 2.5],
    ['250cm', METRIC_UNIT_SETTINGS, 2.5],
    ['2.5m', METRIC_UNIT_SETTINGS, 2.5],
    ['2.5 M', METRIC_UNIT_SETTINGS, 2.5],
    ['.5m', METRIC_UNIT_SETTINGS, 0.5],
    ['1km', METRIC_UNIT_SETTINGS, 1000],
    [`3' 6"`, METRIC_UNIT_SETTINGS, 1.0668],
    [`3'6-1/2"`, METRIC_UNIT_SETTINGS, 1.0795],
    [`5'-6"`, METRIC_UNIT_SETTINGS, 1.6764],
    [`1/2"`, METRIC_UNIT_SETTINGS, 0.0127],
    ['3 1/2in', METRIC_UNIT_SETTINGS, 0.0889],
    ['2ft', METRIC_UNIT_SETTINGS, 0.6096],
    ['1yd', METRIC_UNIT_SETTINGS, 0.9144],
    ['1mi', METRIC_UNIT_SETTINGS, 1609.344],
    ['-35mm', METRIC_UNIT_SETTINGS, -0.035],
    ['+35mm', METRIC_UNIT_SETTINGS, 0.035],
    ['12', IMPERIAL_UNIT_SETTINGS, 0.3048],
    ['2,5m', { ...METRIC_UNIT_SETTINGS, decimalSeparator: ',' } satisfies UnitSettings, 2.5],
  ] satisfies [string, UnitSettings, number][])('parses %s', (text, settings, expected) => {
    const result = parseLength(text, settings);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeCloseTo(expected, 9);
  });

  it.each(['', 'abc', '1/0"', '3x', `3'x"`, '1..2m'])('rejects %j', (text) => {
    expect(parseLength(text, METRIC_UNIT_SETTINGS).ok).toBe(false);
  });
});

describe('parseAngle', () => {
  it('parses degrees and slopes into radians', () => {
    expect(parseAngle('45', METRIC_UNIT_SETTINGS)).toEqual({ ok: true, value: Math.PI / 4 });
    expect(parseAngle('30deg', METRIC_UNIT_SETTINGS)).toMatchObject({
      ok: true,
      value: expect.closeTo(Math.PI / 6),
    });
    expect(parseAngle('-12.5°', METRIC_UNIT_SETTINGS)).toMatchObject({
      ok: true,
      value: expect.closeTo((-12.5 * Math.PI) / 180),
    });
    expect(parseAngle('8:12', METRIC_UNIT_SETTINGS)).toEqual({ ok: true, value: Math.atan2(8, 12) });
  });

  it('rejects empty, malformed and zero slopes', () => {
    expect(parseAngle('', METRIC_UNIT_SETTINGS).ok).toBe(false);
    expect(parseAngle('abc', METRIC_UNIT_SETTINGS).ok).toBe(false);
    expect(parseAngle('0:0', METRIC_UNIT_SETTINGS).ok).toBe(false);
  });
});
