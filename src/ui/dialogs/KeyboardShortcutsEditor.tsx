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

import { useId, useMemo, useRef, useState } from 'react';
import type { CommandCategory, CommandDefinition } from '../../app/commands/CommandRegistry';
import { searchCommands } from '../../app/commands/search';
import type { Editor } from '../../app/Editor';
import { chordFromSearchText, formatChord } from '../../app/shortcuts/shortcuts';
import { downloadText } from '../common/download';
import { useEditor, useEditorState } from '../EditorContext';
import { ShortcutCapture } from '../palette/ShortcutCapture';

const EXPORT_FILE_NAME = 'planar-shortcuts.json';

type Command = CommandDefinition<Editor>;

/**
 * The commands a filter finds: those whose shortcut it names ("ctrl+z", "⇧⌘Z", "L") first, then those whose name,
 * category, aliases or description match.
 */
function filterCommands(editor: Editor, query: string): Command[] {
  const all = editor.commands.all();
  const chord = query.trim() === '' ? null : chordFromSearchText(query, editor.platform);
  const byKeys = chord ? all.filter((command) => editor.shortcuts.chordsFor(command.id).includes(chord)) : [];
  return [...new Set([...byKeys, ...searchCommands(all, query)])];
}

/** Commands in their categories, in the order the categories first appear. */
function byCategory(commands: readonly Command[]): [CommandCategory, Command[]][] {
  const groups = new Map<CommandCategory, Command[]>();
  for (const command of commands) {
    const group = groups.get(command.category);
    if (group) group.push(command);
    else groups.set(command.category, [command]);
  }
  return [...groups];
}

/**
 * Every command with its shortcuts: add, remove or reset them, reset all, and import or export a shortcuts file.
 * Shown on the Keyboard page of Preferences.
 */
export function KeyboardShortcutsEditor() {
  const editor = useEditor();
  useEditorState((state) => state.shortcutsVersion);
  const [query, setQuery] = useState('');
  const [capturing, setCapturing] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filterId = useId();
  const commands = useMemo(() => filterCommands(editor, query), [editor, query]);
  const overrides = editor.shortcutOverrides;
  // Without a filter the list is grouped by category; with one, the best matches come first.
  const groups: [CommandCategory | null, Command[]][] =
    query.trim() === '' ? byCategory(commands) : [[null, commands]];

  const report = (action: () => void) => {
    try {
      action();
    } catch (error) {
      editor.notify('error', error instanceof Error ? error.message : String(error));
    }
  };

  const row = (command: Command) => {
    const chords = editor.shortcuts.chordsFor(command.id);
    const changed = command.id in overrides;
    return (
      <li className="shortcuts-dialog__row" key={command.id}>
        <span className="shortcuts-dialog__command">
          {query.trim() !== '' && <span className="palette__category">{command.category}</span>}{' '}
          {command.label}
          {changed && <span className="shortcuts-dialog__changed">Changed</span>}
        </span>
        <span className="shortcuts-dialog__chords">
          {chords.map((chord) => (
            <span className="shortcuts-dialog__chord" key={chord}>
              {formatChord(chord, editor.platform)}
              <button
                type="button"
                className="shortcuts-dialog__remove"
                aria-label={`Remove ${formatChord(chord, editor.platform)} from ${command.label}`}
                onClick={() => {
                  report(() => {
                    editor.removeShortcut(command.id, chord);
                  });
                }}
              >
                ×
              </button>
            </span>
          ))}
        </span>
        <span className="shortcuts-dialog__actions">
          <button
            type="button"
            className="button button--small"
            aria-label={`Add a shortcut for ${command.label}`}
            onClick={() => {
              setCapturing(command.id);
            }}
          >
            Add
          </button>
          {changed && (
            <button
              type="button"
              className="button button--small"
              aria-label={`Reset shortcuts for ${command.label}`}
              onClick={() => {
                editor.resetShortcut(command.id);
              }}
            >
              Reset
            </button>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="shortcuts-dialog">
      <label className="shortcuts-dialog__filter" htmlFor={filterId}>
        <span className="visually-hidden">Filter commands or keys</span>
        <input
          id={filterId}
          className="palette__input"
          type="search"
          placeholder="Filter by name or keys, such as “move” or “ctrl+z”…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </label>
      {capturing && (
        <ShortcutCapture
          commandId={capturing}
          onDone={() => {
            setCapturing(null);
          }}
        />
      )}
      <div className="shortcuts-dialog__list" role="list" aria-label="Commands and shortcuts">
        {groups.map(([category, members]) => (
          <section className="shortcuts-dialog__group" key={category ?? 'matches'} role="listitem">
            {category && <h3 className="shortcuts-dialog__category">{category}</h3>}
            <ul className="shortcuts-dialog__rows" aria-label={category ?? 'Matching commands'}>
              {members.map(row)}
            </ul>
          </section>
        ))}
        {commands.length === 0 && <p className="dialog__text">No command matches “{query}”.</p>}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          file.text().then(
            (text) => {
              report(() => {
                editor.importShortcuts(text);
                editor.notify('info', `Imported shortcuts from ${file.name}`);
              });
            },
            () => {
              editor.notify('error', `Could not read ${file.name}`);
            },
          );
        }}
      />
      <div className="shortcuts-dialog__footer">
        <button
          type="button"
          className="button"
          onClick={() => {
            fileInputRef.current?.click();
          }}
        >
          Import…
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            downloadText(editor.exportShortcuts(), EXPORT_FILE_NAME, 'application/json');
          }}
        >
          Export…
        </button>
        <button
          type="button"
          className="button"
          disabled={Object.keys(overrides).length === 0}
          onClick={() => {
            editor.resetAllShortcuts();
          }}
        >
          Reset All
        </button>
      </div>
    </div>
  );
}
