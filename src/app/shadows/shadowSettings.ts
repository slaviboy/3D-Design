import type { ShadowSettings } from '../../kernel/model/types';
import {
  formatLocalDateTime,
  localDateTimeToUtc,
  MAX_UTC_OFFSET_MINUTES,
  MIN_UTC_OFFSET_MINUTES,
  parseLocalDateTime,
  solarPosition,
  type LocalDateTime,
} from '../../kernel/sun/solar';

/** The parts of a shadow date-time as the Shadows panel edits them. */
export interface ShadowDateTimeParts {
  /** `YYYY-MM-DD`, the format of a date input. */
  readonly date: string;
  /** `HH:MM`, the format of a time input. */
  readonly time: string;
  /** Minutes east of UTC. */
  readonly utcOffsetMinutes: number;
}

const pad = (value: number): string => String(value).padStart(2, '0');

export function splitShadowDateTime(dateTime: string): ShadowDateTimeParts | null {
  const value = parseLocalDateTime(dateTime);
  if (!value) return null;
  return {
    date: `${String(value.year).padStart(4, '0')}-${pad(value.month)}-${pad(value.day)}`,
    time: `${pad(value.hour)}:${pad(value.minute)}`,
    utcOffsetMinutes: value.utcOffsetMinutes,
  };
}

/** Replaces some parts of a shadow date-time. Returns null when the result is not a valid date and time. */
export function joinShadowDateTime(dateTime: string, patch: Partial<ShadowDateTimeParts>): string | null {
  const current = parseLocalDateTime(dateTime);
  if (!current) return null;
  const date = patch.date === undefined ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(patch.date);
  const time = patch.time === undefined ? null : /^(\d{2}):(\d{2})$/.exec(patch.time);
  if ((patch.date !== undefined && !date) || (patch.time !== undefined && !time)) return null;
  const next: LocalDateTime = {
    ...current,
    ...(date ? { year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) } : {}),
    ...(time ? { hour: Number(time[1]), minute: Number(time[2]), second: 0 } : {}),
    ...(patch.utcOffsetMinutes !== undefined ? { utcOffsetMinutes: patch.utcOffsetMinutes } : {}),
  };
  const text = formatLocalDateTime(next);
  return parseLocalDateTime(text) ? text : null;
}

/** Minutes after midnight of `HH:MM`. */
export function minutesOfDay(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** `HH:MM` for minutes after midnight. */
export function timeOfDay(minutes: number): string {
  const clamped = Math.min(24 * 60 - 1, Math.max(0, Math.round(minutes)));
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

/** `UTC+02:00`, `UTC−05:30`. */
export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const magnitude = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(magnitude / 60))}:${pad(magnitude % 60)}`;
}

/** Offsets in use around the world: every half hour, plus the three quarter-hour zones. */
export const UTC_OFFSET_CHOICES: readonly number[] = (() => {
  const choices = new Set<number>([5 * 60 + 45, 8 * 60 + 45, 12 * 60 + 45]);
  for (let minutes = MIN_UTC_OFFSET_MINUTES; minutes <= MAX_UTC_OFFSET_MINUTES; minutes += 30)
    choices.add(minutes);
  return [...choices].sort((a, b) => a - b);
})();

/** The sun's azimuth and altitude for the settings, in degrees, or null for an invalid date. */
export function sunForSettings(settings: ShadowSettings): { azimuth: number; altitude: number } | null {
  const local = parseLocalDateTime(settings.dateTime);
  if (!local) return null;
  const { azimuth, altitude } = solarPosition(
    localDateTimeToUtc(local),
    settings.latitude,
    settings.longitude,
  );
  return { azimuth, altitude };
}
