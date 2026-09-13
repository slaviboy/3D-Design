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

import { vec3, type Vec3 } from '../math/vec3';

/*
 * Solar position after the NOAA Solar Calculator (the "General Solar Position" spreadsheet method, based on
 * Meeus, "Astronomical Algorithms"). Accuracy is well within a tenth of a degree for dates between 1800 and 2100,
 * which is far better than shadow studies need. Everything here is pure math; no location service is involved.
 */

const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JULIAN_DAY = 2_440_587.5;
const J2000_JULIAN_DAY = 2_451_545;
const DAYS_PER_JULIAN_CENTURY = 36_525;
const MINUTES_PER_DAY = 1440;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;
const wrap = (value: number, period: number): number => ((value % period) + period) % period;
const clampUnit = (value: number): number => Math.min(1, Math.max(-1, value));

export interface SolarPosition {
  /** Degrees clockwise from true north: 90 is east, 180 south, 270 west. */
  readonly azimuth: number;
  /** Degrees above the horizon, corrected for atmospheric refraction. Negative below the horizon. */
  readonly altitude: number;
  /** Apparent declination of the sun, in degrees. */
  readonly declination: number;
  /** Equation of time: apparent minus mean solar time, in minutes. */
  readonly equationOfTime: number;
}

/** Julian day number of a UTC instant. */
export function julianDay(dateUtc: Date): number {
  return dateUtc.getTime() / MS_PER_DAY + UNIX_EPOCH_JULIAN_DAY;
}

/** Atmospheric refraction in degrees for an elevation in degrees (NOAA's piecewise approximation). */
function refraction(elevation: number): number {
  if (elevation > 85) return 0;
  const te = Math.tan(toRadians(elevation));
  let seconds: number;
  if (elevation > 5) {
    seconds = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  } else if (elevation > -0.575) {
    seconds = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  } else {
    seconds = -20.772 / te;
  }
  return seconds / 3600;
}

/**
 * Where the sun is seen from a place on Earth at an instant.
 *
 * @param dateUtc the instant (a `Date` is always a UTC instant)
 * @param latitude degrees, positive north
 * @param longitude degrees, positive east
 */
export function solarPosition(dateUtc: Date, latitude: number, longitude: number): SolarPosition {
  const jd = julianDay(dateUtc);
  const t = (jd - J2000_JULIAN_DAY) / DAYS_PER_JULIAN_CENTURY;

  const meanLongitude = wrap(280.46646 + t * (36000.76983 + t * 0.0003032), 360);
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = toRadians(meanAnomaly);
  const center =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const trueLongitude = meanLongitude + center;
  const omega = toRadians(125.04 - 1934.136 * t);
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = toRadians(meanObliquity + 0.00256 * Math.cos(omega));
  const declinationRad = Math.asin(clampUnit(Math.sin(obliquity) * Math.sin(toRadians(apparentLongitude))));

  const y = Math.tan(obliquity / 2) ** 2;
  const l0 = toRadians(meanLongitude);
  const equationOfTime =
    4 *
    toDegrees(
      y * Math.sin(2 * l0) -
        2 * eccentricity * Math.sin(m) +
        4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
        0.5 * y * y * Math.sin(4 * l0) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * m),
    );

  const minutesOfDay = wrap(dateUtc.getTime() / 60_000, MINUTES_PER_DAY);
  const trueSolarTime = wrap(minutesOfDay + equationOfTime + 4 * longitude, MINUTES_PER_DAY);
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;

  const lat = toRadians(latitude);
  const cosZenith = clampUnit(
    Math.sin(lat) * Math.sin(declinationRad) +
      Math.cos(lat) * Math.cos(declinationRad) * Math.cos(toRadians(hourAngle)),
  );
  const zenithRad = Math.acos(cosZenith);
  const elevation = 90 - toDegrees(zenithRad);

  const denominator = Math.cos(lat) * Math.sin(zenithRad);
  let azimuth: number;
  if (denominator === 0) {
    // At a pole or with the sun overhead the azimuth is undefined; report due south (north in the south).
    azimuth = latitude >= 0 ? 180 : 0;
  } else {
    const angle = toDegrees(
      Math.acos(clampUnit((Math.sin(lat) * Math.cos(zenithRad) - Math.sin(declinationRad)) / denominator)),
    );
    azimuth = hourAngle > 0 ? wrap(angle + 180, 360) : wrap(540 - angle, 360);
  }

  return {
    azimuth,
    altitude: elevation + refraction(elevation),
    declination: toDegrees(declinationRad),
    equationOfTime,
  };
}

/**
 * Unit vector from the model toward the sun, in world coordinates (Z up).
 *
 * @param northAngle degrees clockwise, seen from above, from the world +Y axis to true north
 */
export function sunDirection(
  position: Pick<SolarPosition, 'azimuth' | 'altitude'>,
  northAngle: number,
): Vec3 {
  const azimuth = toRadians(position.azimuth);
  const altitude = toRadians(position.altitude);
  const theta = toRadians(northAngle);
  const towardEast = Math.sin(azimuth) * Math.cos(altitude);
  const towardNorth = Math.cos(azimuth) * Math.cos(altitude);
  // North is +Y turned clockwise by theta; east is north turned clockwise by another 90 degrees.
  const north = vec3(Math.sin(theta), Math.cos(theta), 0);
  const east = vec3(Math.cos(theta), -Math.sin(theta), 0);
  return vec3(
    east.x * towardEast + north.x * towardNorth,
    east.y * towardEast + north.y * towardNorth,
    Math.sin(altitude),
  );
}

// -------------------------------------------------------------------------------------------------- local date-times

/** `YYYY-MM-DDTHH:MM[:SS]` followed by `Z` or `±HH:MM`. */
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/** Largest UTC offsets in use, in minutes. */
export const MIN_UTC_OFFSET_MINUTES = -12 * 60;
export const MAX_UTC_OFFSET_MINUTES = 14 * 60;

export interface LocalDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** Minutes east of UTC. */
  readonly utcOffsetMinutes: number;
}

const pad = (value: number, width = 2): string => String(Math.trunc(Math.abs(value))).padStart(width, '0');

/** Parses a local date-time with a UTC offset. Returns null for malformed or impossible values. */
export function parseLocalDateTime(text: string): LocalDateTime | null {
  const match = LOCAL_DATE_TIME.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, zone, sign, oh, om] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);
  const offset = zone === 'Z' ? 0 : (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    Number(om ?? 0) > 59 ||
    offset < MIN_UTC_OFFSET_MINUTES ||
    offset > MAX_UTC_OFFSET_MINUTES
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second, utcOffsetMinutes: offset };
}

/** The canonical `YYYY-MM-DDTHH:MM:SS±HH:MM` form. */
export function formatLocalDateTime(value: LocalDateTime): string {
  const sign = value.utcOffsetMinutes < 0 ? '-' : '+';
  const offset = Math.abs(value.utcOffsetMinutes);
  return (
    `${pad(value.year, 4)}-${pad(value.month)}-${pad(value.day)}T${pad(value.hour)}:${pad(value.minute)}:` +
    `${pad(value.second)}${sign}${pad(Math.floor(offset / 60))}:${pad(offset % 60)}`
  );
}

/** The UTC instant of a local date-time. */
export function localDateTimeToUtc(value: LocalDateTime): Date {
  return new Date(
    Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second) -
      value.utcOffsetMinutes * 60_000,
  );
}
