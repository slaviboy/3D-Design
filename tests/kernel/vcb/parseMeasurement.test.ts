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
import { vec3 } from '../../../src/kernel/math/vec3';
import { METRIC_UNIT_SETTINGS, type UnitSettings } from '../../../src/kernel/units/units';
import { parseMeasurement, type MeasurementKind } from '../../../src/kernel/vcb/parseMeasurement';

const settings: UnitSettings = { ...METRIC_UNIT_SETTINGS, lengthUnit: 'm' };
const LINE: MeasurementKind[] = ['length', 'absolutePoint', 'relativePoint'];
const RECTANGLE: MeasurementKind[] = ['lengthPair'];
const MOVE: MeasurementKind[] = ['length', 'absolutePoint', 'relativePoint', 'copies'];
const ARC: MeasurementKind[] = ['length', 'radius', 'segments', 'circleSegments'];
const ROTATE: MeasurementKind[] = ['angle', 'copies'];
const SCALE: MeasurementKind[] = ['scale', 'length'];

/** Section I of docs/BEHAVIOR_MATRIX.md. */
describe('behavior matrix I: measurements box parsing', () => {
  it.each([
    ['2.5', LINE, { kind: 'length', value: 2.5 }],
    ['250cm', LINE, { kind: 'length', value: 2.5 }],
    [`3' 6"`, LINE, { kind: 'length', value: expect.closeTo(1.0668, 9) }],
    [`3'6-1/2"`, LINE, { kind: 'length', value: expect.closeTo(1.0795, 9) }],
    [`1/2"`, LINE, { kind: 'length', value: expect.closeTo(0.0127, 9) }],
    ['-35mm', MOVE, { kind: 'length', value: -0.035 }],
    [
      `8',20'`,
      RECTANGLE,
      { kind: 'lengthPair', first: expect.closeTo(2.4384, 9), second: expect.closeTo(6.096, 9) },
    ],
    ['3,', RECTANGLE, { kind: 'lengthPair', first: 3, second: null }],
    [',3', RECTANGLE, { kind: 'lengthPair', first: null, second: 3 }],
    ['3x', MOVE, { kind: 'copies', count: 3, mode: 'external' }],
    ['3*', MOVE, { kind: 'copies', count: 3, mode: 'external' }],
    ['3/', MOVE, { kind: 'copies', count: 3, mode: 'internal' }],
    ['/3', MOVE, { kind: 'copies', count: 3, mode: 'internal' }],
    ['[1,2,3]', LINE, { kind: 'absolutePoint', point: vec3(1, 2, 3) }],
    ['<1m, 20cm, -3>', MOVE, { kind: 'relativePoint', offset: vec3(1, 0.2, -3) }],
    ['12s', ARC, { kind: 'segments', count: 12 }],
    ['20c', ARC, { kind: 'circleSegments', count: 20 }],
    ['20cm', ARC, { kind: 'length', value: 0.2 }],
    ['24r', ARC, { kind: 'radius', value: 24 }],
    ['5mr', ARC, { kind: 'radius', value: 5 }],
    ['45', ROTATE, { kind: 'angle', radians: Math.PI / 4 }],
    ['8:12', ROTATE, { kind: 'angle', radians: Math.atan2(8, 12) }],
    ['4x', ROTATE, { kind: 'copies', count: 4, mode: 'external' }],
    ['2', SCALE, { kind: 'scale', factors: [2] }],
    ['50%', SCALE, { kind: 'scale', factors: [0.5] }],
    ['2,3', SCALE, { kind: 'scale', factors: [2, 3] }],
    ['2,3,4', SCALE, { kind: 'scale', factors: [2, 3, 4] }],
    ['-1', SCALE, { kind: 'scale', factors: [-1] }],
    ['3m', SCALE, { kind: 'length', value: 3 }],
  ])('%s → %o', (input, accepts, expected) => {
    expect(parseMeasurement(input, accepts, settings)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['', LINE],
    ['abc', LINE],
    ['3xx', MOVE],
    ['[1,2]', LINE],
    ['[1,2,3]', RECTANGLE],
    [',', RECTANGLE],
    ['1,2,3', RECTANGLE],
    ['0', ['scale'] as MeasurementKind[]],
    ['0,1', SCALE],
    ['2c', ARC],
    ['0x', MOVE],
    ['0s', ARC],
    ['-2r', ARC],
    ['xr', ARC],
    ['abc', ['angle'] as MeasurementKind[]],
    ['3x', LINE],
    ['5', [] as MeasurementKind[]],
  ])('rejects %j', (input, accepts) => {
    expect(parseMeasurement(input, accepts, settings).ok).toBe(false);
  });

  it('uses ";" to separate values when the decimal separator is a comma', () => {
    const comma: UnitSettings = { ...settings, decimalSeparator: ',' };
    expect(parseMeasurement('2,5;3', RECTANGLE, comma)).toEqual({
      ok: true,
      value: { kind: 'lengthPair', first: 2.5, second: 3 },
    });
    expect(parseMeasurement('[1;2,5;0]', LINE, comma)).toEqual({
      ok: true,
      value: { kind: 'absolutePoint', point: vec3(1, 2.5, 0) },
    });
    expect(parseMeasurement('1,5;2', SCALE, comma)).toEqual({
      ok: true,
      value: { kind: 'scale', factors: [1.5, 2] },
    });
  });
});
