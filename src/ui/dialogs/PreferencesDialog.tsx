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

import { useId, useState, type KeyboardEvent } from 'react';
import {
  AUTOSAVE_MINUTE_CHOICES,
  defaultsFor,
  precisionChoices,
  PREFERENCES_TABS,
  presetFor,
  UI_SCALES,
  UNIT_PRESETS,
  type PreferencesTab,
  type ThemePreference,
} from '../../app/preferences/preferences';
import { Dialog } from '../common/Dialog';
import { useEditor, useEditorState } from '../EditorContext';
import { KeyboardShortcutsEditor } from './KeyboardShortcutsEditor';
import { setStartScreenEnabled, startScreenEnabled } from './StartScreen';

const CUSTOM_UNITS = 'custom';

const TAB_LABELS: Readonly<Record<PreferencesTab, string>> = {
  general: 'General',
  navigation: 'Navigation',
  keyboard: 'Keyboard',
};

/** The preferences each page's Restore Defaults puts back (the Keyboard page resets shortcuts itself). */
const GENERAL_KEYS = ['theme', 'uiScale', 'toolTips', 'units', 'autosaveMinutes'] as const;
const NAVIGATION_KEYS = ['invertWheelZoom'] as const;

function GeneralPage() {
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
    <>
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
        <label className="preferences__check">
          <input
            type="checkbox"
            checked={preferences.toolTips}
            onChange={(event) => {
              editor.updatePreferences({ toolTips: event.currentTarget.checked });
            }}
          />
          Show tool tips on the toolbar buttons
        </label>
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
    </>
  );
}

function NavigationPage() {
  const editor = useEditor();
  const preferences = useEditorState((state) => state.preferences);
  return (
    <fieldset className="preferences__group">
      <legend>Mouse</legend>
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
  );
}

/**
 * Settings kept on this device, on pages: General (appearance, units, files), Navigation and Keyboard (shortcuts).
 * Changes apply immediately. Arrow keys move between the pages.
 */
export function PreferencesDialog({
  tab,
  onTabChange,
  onClose,
}: {
  readonly tab: PreferencesTab;
  readonly onTabChange: (tab: PreferencesTab) => void;
  readonly onClose: () => void;
}) {
  const editor = useEditor();
  const baseId = useId();
  const tabId = (id: PreferencesTab) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = PREFERENCES_TABS.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % PREFERENCES_TABS.length
        : event.key === 'ArrowLeft'
          ? (index + last) % PREFERENCES_TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    const next = target === null ? undefined : PREFERENCES_TABS[target];
    if (!next) return;
    event.preventDefault();
    onTabChange(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <Dialog title="Preferences" onClose={onClose} className="preferences">
      <h2 className="dialog__title">Preferences</h2>
      <div className="preferences__tabs" role="tablist" aria-label="Preferences pages">
        {PREFERENCES_TABS.map((id, index) => (
          <button
            key={id}
            id={tabId(id)}
            type="button"
            role="tab"
            className="preferences__tab"
            aria-selected={id === tab}
            aria-controls={panelId}
            tabIndex={id === tab ? 0 : -1}
            {...(id === tab ? { 'data-autofocus': '' } : {})}
            onClick={() => {
              onTabChange(id);
            }}
            onKeyDown={(event) => {
              onTabKeyDown(event, index);
            }}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>
      <div className="preferences__panel" role="tabpanel" id={panelId} aria-labelledby={tabId(tab)}>
        {tab === 'general' && <GeneralPage />}
        {tab === 'navigation' && <NavigationPage />}
        {tab === 'keyboard' && <KeyboardShortcutsEditor />}
      </div>
      <p className="dialog__text">Preferences are saved on this device and apply to every model.</p>
      <div className="dialog__footer">
        {tab !== 'keyboard' && (
          <button
            type="button"
            className="button"
            onClick={() => {
              editor.updatePreferences(defaultsFor(tab === 'general' ? GENERAL_KEYS : NAVIGATION_KEYS));
            }}
          >
            Restore Defaults
          </button>
        )}
        <button type="button" className="button button--primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
