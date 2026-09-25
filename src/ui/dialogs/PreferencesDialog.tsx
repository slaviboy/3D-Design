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

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { CommandCategory } from '../../app/commands/CommandRegistry';
import {
  CORNER_IDS,
  CORNER_SIZE_RANGE,
  isGestureAction,
  MAX_HOLD_DELAY_MS,
  MIN_HOLD_DELAY_MS,
  type CornerId,
  type CornerSetting,
  type GestureAction,
  type TouchSettings,
  type TwoFingerSlide,
} from '../../app/gestures/gestureSettings';
import {
  AUTOSAVE_MINUTE_CHOICES,
  defaultsFor,
  precisionChoices,
  PREFERENCES_TABS,
  presetFor,
  NAVIGATION_SPEED_RANGE,
  UI_SCALES,
  UNIT_PRESETS,
  type NavigationSettings,
  type PointingDevice,
  type PreferencesTab,
  type SwipeAction,
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
  touch: 'Touch & Pen',
};

/** The preferences each page's Restore Defaults puts back (the Keyboard page resets shortcuts itself). */
const GENERAL_KEYS = ['theme', 'uiScale', 'toolTips', 'units', 'autosaveMinutes'] as const;
const NAVIGATION_KEYS = ['invertWheelZoom', 'navigation'] as const;
const TOUCH_KEYS = ['touch'] as const;
const HOLD_DELAY_STEP_MS = 50;
const CORNER_SIZE_STEP_PX = 8;

const CORNER_LABELS: Readonly<Record<CornerId, string>> = {
  topLeft: 'Top left',
  topRight: 'Top right',
  bottomLeft: 'Bottom left',
  bottomRight: 'Bottom right',
};

/** Speed sliders move in quarter steps of a doubling, so the middle is the usual speed. */
const SPEED_STEPS_PER_DOUBLING = 4;

function speedLabel(speed: number): string {
  return `×${String(Math.round(speed * 100) / 100)}`;
}

function SpeedSlider({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (speed: number) => void;
}) {
  const id = useId();
  const steps = (speed: number) => Math.round(Math.log2(speed) * SPEED_STEPS_PER_DOUBLING);
  return (
    <div className="preferences__field">
      <label htmlFor={id}>{label}</label>
      <span className="preferences__slider">
        <input
          id={id}
          type="range"
          min={steps(NAVIGATION_SPEED_RANGE.min)}
          max={steps(NAVIGATION_SPEED_RANGE.max)}
          step={1}
          value={steps(value)}
          aria-valuetext={speedLabel(value)}
          onChange={(event) => {
            onChange(2 ** (Number(event.currentTarget.value) / SPEED_STEPS_PER_DOUBLING));
          }}
        />
        <output htmlFor={id}>{speedLabel(value)}</output>
      </span>
    </div>
  );
}

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
  const navigation = preferences.navigation;
  const deviceId = useId();
  const swipeId = useId();
  const set = (patch: Partial<NavigationSettings>) => {
    editor.updatePreferences({ navigation: { ...navigation, ...patch } });
  };
  const trackpad = navigation.device === 'trackpad';
  const other = navigation.swipe === 'orbit' ? 'pans' : 'orbits';

  return (
    <>
      <fieldset className="preferences__group">
        <legend>Mouse and trackpad</legend>
        <div className="preferences__field">
          <label htmlFor={deviceId}>Pointing device</label>
          <select
            id={deviceId}
            value={navigation.device}
            onChange={(event) => {
              set({ device: event.currentTarget.value as PointingDevice });
            }}
          >
            <option value="mouse">Mouse</option>
            <option value="trackpad">Trackpad</option>
          </select>
        </div>
        {trackpad && (
          <div className="preferences__field">
            <label htmlFor={swipeId}>Two-finger swipe</label>
            <select
              id={swipeId}
              value={navigation.swipe}
              onChange={(event) => {
                set({ swipe: event.currentTarget.value as SwipeAction });
              }}
            >
              <option value="orbit">Orbits</option>
              <option value="pan">Pans</option>
            </select>
          </div>
        )}
        <p className="preferences__hint">
          {trackpad
            ? `Pinch to zoom. A two-finger swipe with Shift held ${other}.`
            : 'The wheel zooms at the pointer. Drag with the middle button to orbit, with Shift to pan.'}
        </p>
      </fieldset>

      <fieldset className="preferences__group">
        <legend>Direction</legend>
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
        <label className="preferences__check">
          <input
            type="checkbox"
            checked={navigation.invertOrbit}
            onChange={(event) => {
              set({ invertOrbit: event.currentTarget.checked });
            }}
          />
          Invert orbit
        </label>
        <label className="preferences__check">
          <input
            type="checkbox"
            checked={navigation.invertPan}
            onChange={(event) => {
              set({ invertPan: event.currentTarget.checked });
            }}
          />
          Invert pan
        </label>
      </fieldset>

      <fieldset className="preferences__group">
        <legend>Speed</legend>
        <SpeedSlider
          label="Zoom"
          value={navigation.zoomSpeed}
          onChange={(zoomSpeed) => {
            set({ zoomSpeed });
          }}
        />
        <SpeedSlider
          label="Orbit"
          value={navigation.orbitSpeed}
          onChange={(orbitSpeed) => {
            set({ orbitSpeed });
          }}
        />
        <SpeedSlider
          label="Pan"
          value={navigation.panSpeed}
          onChange={(panSpeed) => {
            set({ panSpeed });
          }}
        />
        <p className="preferences__hint">
          Direction and speed apply to the mouse wheel, middle-button drags and trackpad gestures, not to the
          Orbit, Pan and Zoom tools.
        </p>
      </fieldset>
    </>
  );
}

/** A choice of what a gesture does: nothing, the context menu, switching to a tool and back, or any command. */
function GestureActionSelect({
  label,
  value,
  onChange,
  contextMenu = false,
}: {
  readonly label: string;
  readonly value: GestureAction;
  readonly onChange: (action: GestureAction) => void;
  readonly contextMenu?: boolean;
}) {
  const editor = useEditor();
  const id = useId();
  const { tools, groups } = useMemo(() => {
    const commands = editor.commands.all();
    const byCategory = new Map<CommandCategory, { readonly id: string; readonly label: string }[]>();
    for (const command of commands) {
      const group = byCategory.get(command.category) ?? [];
      group.push({ id: command.id, label: command.label });
      byCategory.set(command.category, group);
    }
    // The tools a user can choose, in the order their commands are listed.
    const choosable = commands.filter((command) => editor.tools.has(command.id));
    return { tools: choosable, groups: [...byCategory] };
  }, [editor]);
  const known = new Set<string>([
    'none',
    ...(contextMenu ? ['contextMenu'] : []),
    ...tools.map((tool) => `toggleTool:${tool.id}`),
    ...groups.flatMap(([, commands]) => commands.map((command) => `command:${command.id}`)),
  ]);
  return (
    <div className="preferences__field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (isGestureAction(next)) onChange(next);
        }}
      >
        <option value="none">Nothing</option>
        {contextMenu && <option value="contextMenu">Open the context menu</option>}
        {!known.has(value) && <option value={value}>(no longer available)</option>}
        <optgroup label="Switch to a tool and back">
          {tools.map((tool) => (
            <option key={tool.id} value={`toggleTool:${tool.id}`}>
              {`${tool.label} and back`}
            </option>
          ))}
        </optgroup>
        {groups.map(([category, commands]) => (
          <optgroup key={category} label={category}>
            {commands.map((command) => (
              <option key={command.id} value={`command:${command.id}`}>
                {command.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function CornerRow({
  corner,
  setting,
  onChange,
}: {
  readonly corner: CornerId;
  readonly setting: CornerSetting;
  readonly onChange: (setting: CornerSetting) => void;
}) {
  const triggerId = useId();
  const label = CORNER_LABELS[corner];
  return (
    <div className="preferences__corner">
      <GestureActionSelect
        label={`${label} corner`}
        value={setting.action}
        onChange={(action) => {
          onChange({ ...setting, action });
        }}
      />
      <div className="preferences__field">
        <label htmlFor={triggerId}>
          <span className="visually-hidden">{label} corner </span>Runs on
        </label>
        <select
          id={triggerId}
          value={setting.trigger}
          disabled={setting.action === 'none'}
          onChange={(event) => {
            onChange({
              ...setting,
              trigger: event.currentTarget.value === 'doubleTap' ? 'doubleTap' : 'tap',
            });
          }}
        >
          <option value="tap">A tap</option>
          <option value="doubleTap">A double tap</option>
        </select>
      </div>
    </div>
  );
}

function TouchPage() {
  const editor = useEditor();
  const preferences = useEditorState((state) => state.preferences);
  const touch = preferences.touch;
  const delayId = useId();
  const slideId = useId();
  const cornerSizeId = useId();
  const set = (patch: Partial<TouchSettings>) => {
    editor.updatePreferences({ touch: { ...touch, ...patch } });
  };

  return (
    <>
      <p className="preferences__hint">
        One finger uses the active tool, like a mouse: a tap clicks and a drag presses and drags. With Orbit
        it turns the view, with Pan it moves it.
      </p>
      <fieldset className="preferences__group">
        <legend>Gestures</legend>
        <GestureActionSelect
          label="Two-finger tap"
          value={touch.twoFingerTap}
          onChange={(twoFingerTap) => {
            set({ twoFingerTap });
          }}
        />
        <GestureActionSelect
          label="Three-finger tap"
          value={touch.threeFingerTap}
          onChange={(threeFingerTap) => {
            set({ threeFingerTap });
          }}
        />
        <GestureActionSelect
          label="Four-finger tap"
          value={touch.fourFingerTap}
          onChange={(fourFingerTap) => {
            set({ fourFingerTap });
          }}
        />
        <GestureActionSelect
          label="Touch and hold"
          value={touch.longPress}
          contextMenu
          onChange={(longPress) => {
            set({ longPress });
          }}
        />
        <label className="preferences__check">
          <input
            type="checkbox"
            checked={touch.holdRepeat}
            onChange={(event) => {
              set({ holdRepeat: event.currentTarget.checked });
            }}
          />
          Hold two or three fingers to repeat their tap, like rapid undo and redo
        </label>
        <div className="preferences__field">
          <label htmlFor={delayId}>Delay before repeating</label>
          <span className="preferences__slider">
            <input
              id={delayId}
              type="range"
              min={MIN_HOLD_DELAY_MS}
              max={MAX_HOLD_DELAY_MS}
              step={HOLD_DELAY_STEP_MS}
              value={touch.holdDelayMs}
              disabled={!touch.holdRepeat}
              aria-valuetext={`${String(touch.holdDelayMs / 1000)} seconds`}
              onChange={(event) => {
                set({ holdDelayMs: Number(event.currentTarget.value) });
              }}
            />
            <output htmlFor={delayId}>{`${String(touch.holdDelayMs / 1000)} s`}</output>
          </span>
        </div>
        <p className="preferences__hint">
          Undo takes back an operation that is underway first, like Escape. Some systems keep multi-finger
          gestures for themselves (three-finger undo on iPad, for one); turn those off in the system settings,
          or choose other gestures here.
        </p>
      </fieldset>

      <fieldset className="preferences__group">
        <legend>Two fingers</legend>
        <label className="preferences__check">
          <input
            type="checkbox"
            checked={touch.pinchZoom}
            onChange={(event) => {
              set({ pinchZoom: event.currentTarget.checked });
            }}
          />
          Pinch to zoom about the spot between the fingers
        </label>
        <div className="preferences__field">
          <label htmlFor={slideId}>Moving together</label>
          <select
            id={slideId}
            value={touch.twoFingerSlide}
            onChange={(event) => {
              set({ twoFingerSlide: event.currentTarget.value as TwoFingerSlide });
            }}
          >
            <option value="none">Does nothing</option>
            <option value="pan">Pans the view</option>
            <option value="orbit">Orbits the view</option>
          </select>
        </div>
      </fieldset>

      <fieldset className="preferences__group">
        <legend>Corners</legend>
        <p className="preferences__hint">
          Tapping a corner of the view with a finger or a pen runs what it is set to; a drag that starts there
          is an ordinary one. With a mouse the corners do nothing.
        </p>
        {CORNER_IDS.map((corner) => (
          <CornerRow
            key={corner}
            corner={corner}
            setting={touch.corners[corner]}
            onChange={(setting) => {
              set({ corners: { ...touch.corners, [corner]: setting } });
            }}
          />
        ))}
        <div className="preferences__field">
          <label htmlFor={cornerSizeId}>Corner size</label>
          <span className="preferences__slider">
            <input
              id={cornerSizeId}
              type="range"
              min={CORNER_SIZE_RANGE.min}
              max={CORNER_SIZE_RANGE.max}
              step={CORNER_SIZE_STEP_PX}
              value={touch.cornerSizePx}
              aria-valuetext={`${String(touch.cornerSizePx)} pixels`}
              onChange={(event) => {
                set({ cornerSizePx: Number(event.currentTarget.value) });
              }}
            />
            <output htmlFor={cornerSizeId}>{`${String(touch.cornerSizePx)} px`}</output>
          </span>
        </div>
        <label className="preferences__check">
          <input
            type="checkbox"
            checked={touch.showCornerHints}
            onChange={(event) => {
              set({ showCornerHints: event.currentTarget.checked });
            }}
          />
          Show the corners on the view
        </label>
      </fieldset>

      <fieldset className="preferences__group">
        <legend>Pen</legend>
        <GestureActionSelect
          label="Side button"
          value={touch.penButton}
          contextMenu
          onChange={(penButton) => {
            set({ penButton });
          }}
        />
        <p className="preferences__hint">
          For pens with a side button, such as the S Pen, Wacom pens and the Surface Pen. A pen otherwise
          works like a mouse. Apple Pencil's double-tap and squeeze aren't available to web pages.
        </p>
      </fieldset>
    </>
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
        {tab === 'touch' && <TouchPage />}
      </div>
      <p className="dialog__text">Preferences are saved on this device and apply to every model.</p>
      <div className="dialog__footer">
        {tab !== 'keyboard' && (
          <button
            type="button"
            className="button"
            onClick={() => {
              editor.updatePreferences(
                tab === 'general'
                  ? defaultsFor(GENERAL_KEYS)
                  : tab === 'navigation'
                    ? defaultsFor(NAVIGATION_KEYS)
                    : defaultsFor(TOUCH_KEYS),
              );
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
