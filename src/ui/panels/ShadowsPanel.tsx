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

import { useEffect, useId, useRef, useState } from 'react';
import {
  formatUtcOffset,
  minutesOfDay,
  splitShadowDateTime,
  sunForSettings,
  timeOfDay,
  UTC_OFFSET_CHOICES,
} from '../../app/shadows/shadowSettings';
import { useEditor, useEditorState } from '../EditorContext';
import { CheckField, TextField } from './fields';
import { Panel } from './Panel';

const MINUTES_PER_DAY = 24 * 60;
const TIME_STEP_MINUTES = 5;

/** A slider that previews while dragging and commits once, when released (or per key press). */
function RangeField({
  label,
  value,
  min,
  max,
  step,
  format,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
  readonly onCommit: (value: number) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setDraft(value);
  }
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const onChange = () => {
      onCommit(Number(input.value));
    };
    input.addEventListener('change', onChange);
    return () => {
      input.removeEventListener('change', onChange);
    };
  }, [onCommit]);
  return (
    <div className="shadows__range">
      <div className="shadows__range-label">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(draft)}</output>
      </div>
      <input
        ref={ref}
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => {
          setDraft(Number(event.currentTarget.value));
        }}
      />
    </div>
  );
}

const degrees = (value: number): string => `${value.toFixed(1)}°`;

/** Sun and shadows: on/off, date and time, a hand-entered location, light levels and where shadows fall. */
export function ShadowsPanel() {
  const editor = useEditor();
  const settings = useEditorState((state) => state.shadows);
  const parts = splitShadowDateTime(settings.dateTime);
  const sun = sunForSettings(settings);
  const dateId = useId();
  const timeId = useId();
  const offsetId = useId();

  const parseNumber = (text: string, label: string): number | null => {
    const value = Number(text.trim().replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(value)) {
      editor.notify('error', `${label} must be a number`);
      return null;
    }
    return value;
  };

  return (
    <Panel id="shadows" title="Shadows">
      <div className="shadows">
        <button
          type="button"
          className="button button--small shadows__toggle"
          aria-pressed={settings.enabled}
          onClick={() => {
            editor.updateShadowSettings({ enabled: !settings.enabled });
          }}
        >
          {settings.enabled ? 'Shadows On' : 'Shadows Off'}
        </button>
        <p className="shadows__sun" data-testid="sun-position">
          {sun === null
            ? 'The date or time is invalid'
            : sun.altitude > 0
              ? `Sun at ${degrees(sun.azimuth)} azimuth, ${degrees(sun.altitude)} altitude`
              : 'The sun is below the horizon'}
        </p>
        {parts && (
          <>
            <div className="field">
              <label className="field__label" htmlFor={dateId}>
                Date
              </label>
              <input
                id={dateId}
                type="date"
                className="field__control"
                value={parts.date}
                onChange={(event) => {
                  if (event.currentTarget.value !== '')
                    editor.setShadowDateTime({ date: event.currentTarget.value });
                }}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor={timeId}>
                Time
              </label>
              <input
                id={timeId}
                type="time"
                className="field__control"
                value={parts.time}
                onChange={(event) => {
                  if (event.currentTarget.value !== '')
                    editor.setShadowDateTime({ time: event.currentTarget.value });
                }}
              />
            </div>
            <RangeField
              label="Time of day"
              value={minutesOfDay(parts.time)}
              min={0}
              max={MINUTES_PER_DAY - TIME_STEP_MINUTES}
              step={TIME_STEP_MINUTES}
              format={timeOfDay}
              onCommit={(minutes) => {
                editor.setShadowDateTime({ time: timeOfDay(minutes) });
              }}
            />
            <div className="field">
              <label className="field__label" htmlFor={offsetId}>
                Time zone
              </label>
              <select
                id={offsetId}
                className="field__control"
                value={String(parts.utcOffsetMinutes)}
                onChange={(event) => {
                  editor.setShadowDateTime({ utcOffsetMinutes: Number(event.currentTarget.value) });
                }}
              >
                {UTC_OFFSET_CHOICES.map((minutes) => (
                  <option key={minutes} value={String(minutes)}>
                    {formatUtcOffset(minutes)}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <TextField
          label="Latitude"
          value={String(settings.latitude)}
          onCommit={(text) => {
            const latitude = parseNumber(text, 'Latitude');
            return latitude !== null && editor.updateShadowSettings({ latitude });
          }}
        />
        <TextField
          label="Longitude"
          value={String(settings.longitude)}
          onCommit={(text) => {
            const longitude = parseNumber(text, 'Longitude');
            return longitude !== null && editor.updateShadowSettings({ longitude });
          }}
        />
        <TextField
          label="North angle"
          value={String(settings.northAngle)}
          onCommit={(text) => {
            const northAngle = parseNumber(text, 'North angle');
            return northAngle !== null && editor.updateShadowSettings({ northAngle });
          }}
        />
        <RangeField
          label="Light"
          value={Math.round(settings.light * 100)}
          min={0}
          max={100}
          step={1}
          format={(value) => `${String(value)}%`}
          onCommit={(value) => {
            editor.updateShadowSettings({ light: value / 100 });
          }}
        />
        <RangeField
          label="Dark"
          value={Math.round(settings.dark * 100)}
          min={0}
          max={100}
          step={1}
          format={(value) => `${String(value)}%`}
          onCommit={(value) => {
            editor.updateShadowSettings({ dark: value / 100 });
          }}
        />
        <CheckField
          label="Use sun for shading"
          value={settings.useSunForShading}
          onChange={(useSunForShading) => {
            editor.updateShadowSettings({ useSunForShading });
          }}
        />
        <CheckField
          label="On faces"
          value={settings.onFaces}
          onChange={(onFaces) => {
            editor.updateShadowSettings({ onFaces });
          }}
        />
        <CheckField
          label="On ground"
          value={settings.onGround}
          onChange={(onGround) => {
            editor.updateShadowSettings({ onGround });
          }}
        />
      </div>
    </Panel>
  );
}
