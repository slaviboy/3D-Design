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
import { length } from '../../../src/kernel/math/vec3';
import {
  formatLocalDateTime,
  localDateTimeToUtc,
  parseLocalDateTime,
  solarPosition,
  sunDirection,
} from '../../../src/kernel/sun/solar';

const WITHIN = 0.5;

describe('solar position', () => {
  it('matches the NREL Solar Position Algorithm reference case (Golden, Colorado, 17 October 2003)', () => {
    // Reda & Andreas, "Solar Position Algorithm for Solar Radiation Applications" (NREL/TP-560-34302), Table A5-1:
    // 2003-10-17 12:30:30 local time at UTC−7, latitude 39.742476°, longitude −105.1786°.
    // Topocentric zenith 50.11162°, azimuth 194.34024° (clockwise from north).
    const position = solarPosition(new Date('2003-10-17T19:30:30Z'), 39.742476, -105.1786);
    expect(Math.abs(position.altitude - (90 - 50.11162))).toBeLessThan(WITHIN);
    expect(Math.abs(position.azimuth - 194.34024)).toBeLessThan(WITHIN);
  });

  it("matches Meeus's worked examples for declination and the equation of time", () => {
    // Meeus, Astronomical Algorithms, example 25.a: 1992 October 13.0, apparent declination −7.78507°.
    expect(
      Math.abs(solarPosition(new Date('1992-10-13T00:00:00Z'), 0, 0).declination + 7.78507),
    ).toBeLessThan(WITHIN);
    // Example 28.b: the same instant, equation of time +13 min 42.7 s.
    const equation = solarPosition(new Date('1992-10-13T00:00:00Z'), 0, 0).equationOfTime;
    expect(Math.abs(equation - (13 + 42.7 / 60))).toBeLessThan(0.2);
  });

  it('puts the June solstice sun overhead at the Tropic of Cancer at local solar noon', () => {
    // 2024-06-20: declination +23.44°; solar noon at longitude 0 is about 12:02 UTC (equation of time −1.7 min).
    const position = solarPosition(new Date('2024-06-20T12:02:00Z'), 23.44, 0);
    expect(Math.abs(position.declination - 23.44)).toBeLessThan(WITHIN);
    expect(position.altitude).toBeGreaterThan(89);
  });

  it('is below the horizon at night and rises in the east', () => {
    expect(solarPosition(new Date('2026-03-20T00:00:00Z'), 51.48, 0).altitude).toBeLessThan(-30);
    const morning = solarPosition(new Date('2026-03-20T08:00:00Z'), 51.48, 0);
    expect(morning.altitude).toBeGreaterThan(0);
    expect(morning.azimuth).toBeGreaterThan(90);
    expect(morning.azimuth).toBeLessThan(135);
  });
});

describe('sun direction', () => {
  it('turns azimuth and altitude into a world vector that follows the north angle', () => {
    const south = sunDirection({ azimuth: 180, altitude: 0 }, 0);
    expect(south.x).toBeCloseTo(0, 12);
    expect(south.y).toBeCloseTo(-1, 12);
    const east = sunDirection({ azimuth: 90, altitude: 0 }, 0);
    expect(east.x).toBeCloseTo(1, 12);
    // With north turned 90° clockwise (toward +X), east points to −Y.
    const turned = sunDirection({ azimuth: 90, altitude: 0 }, 90);
    expect(turned.x).toBeCloseTo(0, 12);
    expect(turned.y).toBeCloseTo(-1, 12);
    const high = sunDirection({ azimuth: 123, altitude: 40 }, 17);
    expect(length(high)).toBeCloseTo(1, 12);
    expect(high.z).toBeCloseTo(Math.sin((40 * Math.PI) / 180), 12);
  });
});

describe('local date-times', () => {
  it('parse, normalize and convert to UTC', () => {
    const parsed = parseLocalDateTime('2026-06-21T14:05+02:00');
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(formatLocalDateTime(parsed)).toBe('2026-06-21T14:05:00+02:00');
    expect(localDateTimeToUtc(parsed).toISOString()).toBe('2026-06-21T12:05:00.000Z');
    expect(formatLocalDateTime(parseLocalDateTime('2026-01-02T03:04:05Z') ?? parsed)).toBe(
      '2026-01-02T03:04:05+00:00',
    );
    expect(formatLocalDateTime({ ...parsed, utcOffsetMinutes: -330 })).toBe('2026-06-21T14:05:00-05:30');
  });

  it('reject malformed and impossible values', () => {
    for (const text of [
      '',
      '2026-06-21',
      '2026-06-21T14:05',
      '2026-02-30T10:00:00Z',
      '2026-13-01T10:00:00Z',
      '2026-06-21T24:00:00Z',
      '2026-06-21T10:00:00+15:00',
      '2026-06-21T10:00:00+02:75',
    ]) {
      expect(parseLocalDateTime(text), text).toBeNull();
    }
  });
});
