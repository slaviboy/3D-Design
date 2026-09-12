import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../../src/app/commands/CommandRegistry';
import { registerDefaultCommands } from '../../src/app/commands/defaultCommands';
import { matchScore, searchCommands } from '../../src/app/commands/search';
import type { Editor } from '../../src/app/Editor';
import {
  chordFromKeyboard,
  formatChord,
  isEditableTarget,
  normalizeChord,
  ShortcutMap,
  type KeyChordInput,
} from '../../src/app/shortcuts/shortcuts';

const key = (overrides: Partial<KeyChordInput> & { key: string }): KeyChordInput => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe('keyboard chords', () => {
  it('maps the platform command key to Mod', () => {
    expect(chordFromKeyboard(key({ key: 'z', metaKey: true }), 'mac')).toBe('Mod+Z');
    expect(chordFromKeyboard(key({ key: 'z', ctrlKey: true }), 'other')).toBe('Mod+Z');
    expect(chordFromKeyboard(key({ key: 'z', ctrlKey: true }), 'mac')).toBe('Ctrl+Z');
    expect(chordFromKeyboard(key({ key: 'Z', ctrlKey: true, shiftKey: true }), 'other')).toBe('Mod+Shift+Z');
  });

  it('normalizes special keys, symbols and Option-modified letters', () => {
    expect(chordFromKeyboard(key({ key: ' ' }), 'other')).toBe('Space');
    expect(chordFromKeyboard(key({ key: '?', shiftKey: true }), 'other')).toBe('?');
    expect(chordFromKeyboard(key({ key: 'å', code: 'KeyA', altKey: true }), 'mac')).toBe('Alt+A');
    expect(chordFromKeyboard(key({ key: '¡', code: 'Digit1', altKey: true }), 'mac')).toBe('Alt+1');
    expect(chordFromKeyboard(key({ key: 'Esc' }), 'other')).toBe('Escape');
    expect(chordFromKeyboard(key({ key: 'Shift', shiftKey: true }), 'other')).toBeNull();
  });

  it('parses chords in any order and rejects invalid ones', () => {
    expect(normalizeChord('shift+mod+z')).toBe('Mod+Shift+Z');
    expect(normalizeChord('Alt + Delete')).toBe('Alt+Delete');
    expect(normalizeChord('Mod++')).toBe('Mod++');
    expect(normalizeChord('Hyper+Z')).toBeNull();
    expect(normalizeChord('Shift+Shift+Z')).toBeNull();
    expect(normalizeChord('Mod+Shift')).toBeNull();
    expect(normalizeChord('')).toBeNull();
  });

  it('formats chords for each platform', () => {
    expect(formatChord('Mod+Shift+Z', 'mac')).toBe('⇧⌘Z');
    expect(formatChord('Mod+Shift+Z', 'other')).toBe('Ctrl+Shift+Z');
    expect(formatChord('Delete', 'other')).toBe('Del');
  });

  it('recognizes text-entry targets', () => {
    expect(isEditableTarget({ tagName: 'input' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'CANVAS' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('maps commands to chords and reports conflicts', () => {
    const map = new ShortcutMap([
      ['a', ['mod+z']],
      ['b', ['Mod+Z', 'Delete']],
    ]);
    expect(map.commandFor('Mod+Z')).toBe('a');
    expect(map.chordsFor('b')).toEqual(['Mod+Z', 'Delete']);
    expect(map.chordsFor('unknown')).toEqual([]);
    expect(map.conflicts()).toEqual([{ chord: 'Mod+Z', commandIds: ['a', 'b'] }]);
    expect(() => new ShortcutMap([['bad', ['Hyper+Q']]])).toThrow();
  });

  it('has no conflicting default shortcuts', () => {
    const registry = new CommandRegistry<Editor>();
    registerDefaultCommands(registry);
    expect(ShortcutMap.fromCommands(registry.all()).conflicts()).toEqual([]);
  });
});

describe('command registry', () => {
  it('runs enabled commands and reports state', async () => {
    const registry = new CommandRegistry<{ enabled: boolean }>();
    const run = vi.fn();
    registry.register({
      id: 'x',
      label: 'X',
      category: 'Edit',
      isEnabled: (c) => c.enabled,
      isChecked: () => true,
      run,
    });
    expect(() => {
      registry.register({ id: 'x', label: 'X', category: 'Edit', run });
    }).toThrow();
    expect(await registry.execute('x', { enabled: false })).toBe(false);
    expect(await registry.execute('x', { enabled: true })).toBe(true);
    expect(await registry.execute('missing', { enabled: true })).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(registry.isChecked('x', { enabled: true })).toBe(true);
    expect(registry.isEnabled('missing', { enabled: true })).toBe(false);
  });

  it('searches commands by label, alias and loose spelling', () => {
    const registry = new CommandRegistry<Editor>();
    registerDefaultCommands(registry);
    const commands = registry.all();
    expect(searchCommands(commands, 'zoom ext')[0]?.id).toBe('camera.zoomExtents');
    expect(searchCommands(commands, 'orthographic')[0]?.id).toBe('camera.parallel');
    expect(searchCommands(commands, 'svas')[0]?.id).toBe('file.saveAs');
    expect(searchCommands(commands, '')).toHaveLength(commands.length);
    expect(searchCommands(commands, 'qqqqq')).toEqual([]);
    expect(matchScore('ab', 'a b')).toBeGreaterThan(0);
    expect(matchScore('ba', 'ab')).toBe(0);
  });
});
