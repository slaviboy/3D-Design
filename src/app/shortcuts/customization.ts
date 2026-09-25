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

import { err, ok, type Result } from '../../kernel/result';
import { normalizeChord, ShortcutMap } from './shortcuts';

/**
 * The user's shortcut changes: for each changed command, the chords that replace its defaults. An empty list means
 * the command has no shortcut. Commands not listed keep their defaults.
 */
export type ShortcutOverrides = Readonly<Record<string, readonly string[]>>;

export const SHORTCUTS_FILE_FORMAT = 'planar-shortcuts';
export const SHORTCUTS_FILE_VERSION = 1;

export interface CommandShortcutDefaults {
  readonly id: string;
  readonly defaultShortcuts?: readonly string[];
}

/** Where the user's shortcut changes are kept between sessions. */
export interface ShortcutStorage {
  load(): ShortcutOverrides;
  save(overrides: ShortcutOverrides): void;
}

/** What happens to other commands that already use a chord being assigned. */
export type ConflictResolution = 'replace' | 'keep';

export function buildShortcutMap(
  commands: Iterable<CommandShortcutDefaults>,
  overrides: ShortcutOverrides,
): ShortcutMap {
  return new ShortcutMap(
    [...commands].map(
      (command) => [command.id, overrides[command.id] ?? command.defaultShortcuts ?? []] as const,
    ),
  );
}

/**
 * Chords the browser keeps for itself (tabs and windows): a page never receives them, so a shortcut on one could
 * never run. In canonical form, where Mod is Command on macOS and Ctrl elsewhere, and Ctrl is the Mac Control key.
 */
const BROWSER_RESERVED_CHORDS: ReadonlySet<string> = new Set([
  'Mod+W',
  'Mod+T',
  'Mod+N',
  'Mod+Q',
  'Mod+Shift+T',
  'Mod+Shift+N',
  'Mod+Shift+W',
  'Mod+Tab',
  'Mod+Shift+Tab',
  'Ctrl+Tab',
  'Ctrl+Shift+Tab',
]);

/**
 * The canonical form of a chord the user wants to assign, or why it can't be used. Digits start typing in the
 * measurements box and Escape cancels tools, so neither may be bound on its own or with only Shift; and the browser
 * never passes on the chords it uses for tabs and windows.
 */
export function validateUserChord(chord: string): Result<string> {
  const canonical = normalizeChord(chord);
  if (!canonical) return err(`"${chord}" is not a valid shortcut`);
  const parts = canonical.split('+');
  const key = parts.at(-1) ?? '';
  const modifiers = parts.slice(0, -1);
  const onlyShift = modifiers.every((modifier) => modifier === 'Shift');
  if (onlyShift && /^[0-9]$/.test(key)) {
    return err('Digits are used for typing measurements; add Ctrl, Alt or Command to use them');
  }
  if (key === 'Escape') return err('Escape is reserved for cancelling the current operation');
  if (BROWSER_RESERVED_CHORDS.has(canonical)) {
    return err('The browser keeps this shortcut for its tabs and windows, so Planar never receives it');
  }
  return ok(canonical);
}

/** The other commands that already use a chord. */
export function commandsUsingChord(map: ShortcutMap, chord: string, exceptCommandId: string): string[] {
  return map.commandsFor(chord).filter((commandId) => commandId !== exceptCommandId);
}

/**
 * Assigns `chord` to a command in addition to its current shortcuts. With `replace`, the chord is removed from any
 * other command that used it; with `keep`, nothing changes when another command already uses it.
 */
export function assignShortcut(
  overrides: ShortcutOverrides,
  map: ShortcutMap,
  commandId: string,
  chord: string,
  resolution: ConflictResolution,
): ShortcutOverrides {
  const others = commandsUsingChord(map, chord, commandId);
  if (others.length > 0 && resolution === 'keep') return overrides;
  const next: Record<string, readonly string[]> = { ...overrides };
  for (const other of others) next[other] = map.chordsFor(other).filter((existing) => existing !== chord);
  const current = map.chordsFor(commandId);
  next[commandId] = current.includes(chord) ? current : [...current, chord];
  return next;
}

/** Removes one chord from a command. */
export function removeShortcut(
  overrides: ShortcutOverrides,
  map: ShortcutMap,
  commandId: string,
  chord: string,
): ShortcutOverrides {
  return { ...overrides, [commandId]: map.chordsFor(commandId).filter((existing) => existing !== chord) };
}

/** Restores one command's default shortcuts. */
export function resetShortcut(overrides: ShortcutOverrides, commandId: string): ShortcutOverrides {
  return Object.fromEntries(Object.entries(overrides).filter(([id]) => id !== commandId));
}

/** The user's shortcut changes as a JSON file. */
export function exportShortcuts(overrides: ShortcutOverrides): string {
  return JSON.stringify(
    { format: SHORTCUTS_FILE_FORMAT, version: SHORTCUTS_FILE_VERSION, overrides },
    null,
    2,
  );
}

/** The shortcut list of a shortcuts file, or why the text isn't one. */
function readShortcutList(text: string): Result<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err('The file is not valid JSON');
  }
  if (typeof value !== 'object' || value === null) return err('The file is not a shortcuts file');
  const file = value as Record<string, unknown>;
  if (file.format !== SHORTCUTS_FILE_FORMAT) return err('The file is not a Planar shortcuts file');
  if (file.version !== SHORTCUTS_FILE_VERSION) {
    return err(`Unsupported shortcuts file version ${String(file.version)}`);
  }
  if (typeof file.overrides !== 'object' || file.overrides === null || Array.isArray(file.overrides)) {
    return err('The file has no shortcut list');
  }
  return ok(file.overrides as Record<string, unknown>);
}

/**
 * Reads shortcut changes from a JSON file. Unknown commands and invalid chords are refused, so a file from another
 * version can't leave broken bindings behind.
 */
export function importShortcuts(
  text: string,
  commands: Iterable<CommandShortcutDefaults>,
): Result<ShortcutOverrides> {
  const list = readShortcutList(text);
  if (!list.ok) return list;
  const known = new Set([...commands].map((command) => command.id));
  const overrides: Record<string, readonly string[]> = {};
  for (const [commandId, chords] of Object.entries(list.value)) {
    if (!known.has(commandId)) return err(`Unknown command "${commandId}"`);
    if (!Array.isArray(chords)) return err(`The shortcuts for "${commandId}" are not a list`);
    const canonical: string[] = [];
    for (const chord of chords) {
      if (typeof chord !== 'string') return err(`A shortcut for "${commandId}" is not text`);
      const result = validateUserChord(chord);
      if (!result.ok) return err(`${commandId}: ${result.error}`);
      canonical.push(result.value);
    }
    overrides[commandId] = canonical;
  }
  return ok(overrides);
}

/**
 * Reads the stored overrides defensively, one entry at a time. A command renamed or removed since, or a chord that is
 * no longer allowed, is dropped on its own and every other change the user made is kept; a malformed store is ignored
 * and the defaults apply.
 */
export function parseStoredOverrides(
  text: string | null,
  commands: Iterable<CommandShortcutDefaults>,
): ShortcutOverrides {
  if (text === null) return {};
  const list = readShortcutList(text);
  if (!list.ok) return {};
  const known = new Set([...commands].map((command) => command.id));
  const overrides: Record<string, readonly string[]> = {};
  for (const [commandId, chords] of Object.entries(list.value)) {
    if (!known.has(commandId) || !Array.isArray(chords)) continue;
    const canonical = chords.flatMap((chord: unknown) => {
      if (typeof chord !== 'string') return [];
      const result = validateUserChord(chord);
      return result.ok ? [result.value] : [];
    });
    // An entry whose chords were all dropped would take away the command's defaults; the defaults win instead.
    if (canonical.length === 0 && chords.length > 0) continue;
    overrides[commandId] = canonical;
  }
  return overrides;
}
