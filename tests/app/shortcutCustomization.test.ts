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
import {
  assignShortcut,
  buildShortcutMap,
  exportShortcuts,
  importShortcuts,
  parseStoredOverrides,
  removeShortcut,
  resetShortcut,
  validateUserChord,
  type ShortcutOverrides,
} from '../../src/app/shortcuts/customization';
import { createTestEditor } from './fixtures';

const commands = [
  { id: 'tool.line', defaultShortcuts: ['L'] },
  { id: 'edit.redo', defaultShortcuts: ['Mod+Shift+Z', 'Mod+Y'] },
  { id: 'tool.polygon' },
];

describe('shortcut customization', () => {
  it('builds the map from defaults with the user changes applied', () => {
    const map = buildShortcutMap(commands, { 'tool.line': ['Shift+L'], 'edit.redo': [] });
    expect(map.chordsFor('tool.line')).toEqual(['Shift+L']);
    expect(map.chordsFor('edit.redo')).toEqual([]);
    expect(map.commandFor('Mod+Y')).toBeUndefined();
    expect(map.chordsFor('tool.polygon')).toEqual([]);
  });

  it('refuses digits, Escape and invalid chords', () => {
    expect(validateUserChord('shift+l')).toEqual({ ok: true, value: 'Shift+L' });
    expect(validateUserChord('7').ok).toBe(false);
    expect(validateUserChord('Shift+7').ok).toBe(false);
    expect(validateUserChord('Mod+7')).toEqual({ ok: true, value: 'Mod+7' });
    expect(validateUserChord('Escape').ok).toBe(false);
    expect(validateUserChord('Hyper+Q').ok).toBe(false);
  });

  it('replaces or keeps conflicting shortcuts when assigning', () => {
    const map = buildShortcutMap(commands, {});
    const kept = assignShortcut({}, map, 'tool.polygon', 'L', 'keep');
    expect(kept).toEqual({});

    const replaced = assignShortcut({}, map, 'tool.polygon', 'L', 'replace');
    const after = buildShortcutMap(commands, replaced);
    expect(after.commandFor('L')).toBe('tool.polygon');
    expect(after.chordsFor('tool.line')).toEqual([]);

    const added = assignShortcut({}, map, 'edit.redo', 'Shift+R', 'keep');
    expect(buildShortcutMap(commands, added).chordsFor('edit.redo')).toEqual([
      'Mod+Shift+Z',
      'Mod+Y',
      'Shift+R',
    ]);

    const removed = removeShortcut(added, buildShortcutMap(commands, added), 'edit.redo', 'Mod+Y');
    expect(buildShortcutMap(commands, removed).chordsFor('edit.redo')).toEqual(['Mod+Shift+Z', 'Shift+R']);
    expect(buildShortcutMap(commands, resetShortcut(removed, 'edit.redo')).chordsFor('edit.redo')).toEqual([
      'Mod+Shift+Z',
      'Mod+Y',
    ]);
  });

  it('exports and imports shortcut files, refusing anything unexpected', () => {
    const overrides = { 'tool.line': ['Shift+L'], 'edit.redo': [] };
    expect(importShortcuts(exportShortcuts(overrides), commands)).toEqual({ ok: true, value: overrides });
    expect(importShortcuts('{', commands).ok).toBe(false);
    expect(importShortcuts('{"format":"other"}', commands).ok).toBe(false);
    expect(
      importShortcuts(JSON.stringify({ format: 'planar-shortcuts', version: 9, overrides: {} }), commands).ok,
    ).toBe(false);
    expect(importShortcuts(exportShortcuts({ 'tool.unknown': ['K'] }), commands).ok).toBe(false);
    expect(importShortcuts(exportShortcuts({ 'tool.line': ['9'] }), commands).ok).toBe(false);
    expect(parseStoredOverrides('not json', commands)).toEqual({});
    expect(parseStoredOverrides(null, commands)).toEqual({});
  });
});

describe('editor shortcuts', () => {
  const press = (key: string, shiftKey = false) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey,
  });

  it('rebinds, persists, resets and imports shortcuts', () => {
    const editor = createTestEditor();
    const saved: ShortcutOverrides[] = [];
    editor.setShortcutStorage({
      load: () => ({ 'tool.line': ['Shift+L'], 'tool.removed': ['K'] }),
      save: (overrides) => {
        saved.push(overrides);
      },
    });
    expect(editor.shortcuts.chordsFor('tool.line')).toEqual(['Shift+L']);
    expect(editor.shortcutOverrides).toEqual({ 'tool.line': ['Shift+L'] });
    expect(editor.handleKey(press('L', true))).toBe(true);
    expect(editor.tools.activeToolId).toBe('tool.line');

    expect(editor.shortcutConflicts('tool.polygon', 'Shift+L')).toEqual(['tool.line']);
    expect(editor.assignShortcut('tool.polygon', 'shift+l', 'keep')).toBe(false);
    expect(editor.assignShortcut('tool.polygon', 'shift+l', 'replace')).toBe(true);
    expect(editor.shortcuts.commandFor('Shift+L')).toBe('tool.polygon');
    expect(saved.at(-1)).toMatchObject({ 'tool.polygon': ['Shift+L'], 'tool.line': [] });
    expect(() => editor.assignShortcut('tool.polygon', '5', 'replace')).toThrow(/Digits/);
    expect(() => editor.assignShortcut('tool.nothing', 'K', 'replace')).toThrow(/Unknown command/);

    const exported = editor.exportShortcuts();
    editor.resetAllShortcuts();
    expect(editor.shortcuts.commandFor('L')).toBe('tool.line');
    editor.importShortcuts(exported);
    expect(editor.shortcuts.commandFor('Shift+L')).toBe('tool.polygon');
    editor.resetShortcut('tool.line');
    expect(editor.shortcuts.chordsFor('tool.line')).toEqual(['L']);
    editor.removeShortcut('tool.line', 'L');
    expect(editor.shortcuts.chordsFor('tool.line')).toEqual([]);
    expect(() => {
      editor.importShortcuts('{');
    }).toThrow();
  });
});
