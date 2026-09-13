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

import { useId, useState } from 'react';
import {
  AUTOSAVE_MINUTE_CHOICES,
  precisionChoices,
  presetFor,
  UI_SCALES,
  UNIT_PRESETS,
  type ThemePreference,
} from '../../app/preferences/preferences';
import { Dialog } from '../common/Dialog';
import { useEditor, useEditorState } from '../EditorContext';
import { setStartScreenEnabled, startScreenEnabled } from './StartScreen';

const CUSTOM_UNITS = 'custom';

/** Settings kept on this device: appearance, units, navigation and files. Changes apply immediately. */
export function PreferencesDialog({ onClose }: { readonly onClose: () => void }) {
  const editor = useEditor();
  const preferences = useEditorState((state) => state.preferences);
  const [showStartScreen, setShowStartScreen] = useState(startScreenEnabled);
  const themeId = useId();
  const scaleId = useId();
  const unitsId = useId();
  const precisionId = useId();
  const autosaveId = useId();
  const preset = presetFor(preferences.units);

  return (
    <Dialog title="Preferences" onClose={onClose} className="preferences">
      <h2 className="dialog__title">Preferences</h2>

      <fieldset className="preferences__group">
        <legend>Appearance</legend>
        <div className="preferences__field">
          <label htmlFor={themeId}>Theme</label>
          <select
            id={themeId}
            value={preferences.theme}
            onChange={(event) => {
              editor.updatePreferences({ theme: event.currentTarget.value as ThemePreference });
            }}
          >
            <option value="system">Match the system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div className="preferences__field">
          <label htmlFor={scaleId}>Interface size</label>
          <select
            id={scaleId}
            value={String(preferences.uiScale)}
            onChange={(event) => {
              editor.updatePreferences({ uiScale: Number(event.currentTarget.value) });
            }}
          >
            {UI_SCALES.map((scale) => (
              <option key={scale} value={String(scale)}>{`${String(Math.round(scale * 100))}%`}</option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="preferences__group">
        <legend>Units</legend>
        <div className="preferences__field">
          <label htmlFor={unitsId}>Length</label>
          <select
            id={unitsId}
            value={preset?.id ?? CUSTOM_UNITS}
            onChange={(event) => {
              const next = UNIT_PRESETS.find((candidate) => candidate.id === event.currentTarget.value);
              if (next) editor.updatePreferences({ units: next.settings });
            }}
          >
            {!preset && <option value={CUSTOM_UNITS}>Custom</option>}
            {UNIT_PRESETS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </div>
        <div className="preferences__field">
          <label htmlFor={precisionId}>Precision</label>
          <select
            id={precisionId}
            value={String(preferences.units.precision)}
            onChange={(event) => {
              editor.updatePreferences({
                units: { ...preferences.units, precision: Number(event.currentTarget.value) },
              });
            }}
          >
            {precisionChoices(preferences.units.format).map((choice) => (
              <option key={choice.value} value={String(choice.value)}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="preferences__group">
        <legend>Navigation</legend>
        <label className="preferences__check">
          <input
            type="checkbox"
            checked={preferences.invertWheelZoom}
            onChange={(event) => {
              editor.updatePreferences({ invertWheelZoom: event.currentTarget.checked });
            }}
          />
          Invert mouse wheel zoom
        </label>
      </fieldset>

      <fieldset className="preferences__group">
        <legend>Files</legend>
        <div className="preferences__field">
          <label htmlFor={autosaveId}>Autosave</label>
          <select
            id={autosaveId}
            value={String(preferences.autosaveMinutes)}
            onChange={(event) => {
              editor.updatePreferences({ autosaveMinutes: Number(event.currentTarget.value) });
            }}
          >
            {AUTOSAVE_MINUTE_CHOICES.map((minutes) => (
              <option key={minutes} value={String(minutes)}>
                {minutes === 0 ? 'Off' : `Every ${String(minutes)} minute${minutes === 1 ? '' : 's'}`}
              </option>
            ))}
          </select>
        </div>
        <label className="preferences__check">
          <input
            type="checkbox"
            checked={showStartScreen}
            onChange={(event) => {
              setShowStartScreen(event.currentTarget.checked);
              setStartScreenEnabled(event.currentTarget.checked);
            }}
          />
          Show the start screen when Planar opens
        </label>
      </fieldset>

      <p className="dialog__text">Preferences are saved on this device and apply to every model.</p>
      <div className="dialog__footer">
        <button
          type="button"
          className="button"
          onClick={() => {
            editor.resetPreferences();
          }}
        >
          Restore Defaults
        </button>
        <button type="button" className="button button--primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
