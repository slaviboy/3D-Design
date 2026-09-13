import { useId, useMemo, useRef, useState } from 'react';
import { searchCommands } from '../../app/commands/search';
import { formatChord } from '../../app/shortcuts/shortcuts';
import { Dialog } from '../common/Dialog';
import { downloadText } from '../common/download';
import { useEditor, useEditorState } from '../EditorContext';
import { ShortcutCapture } from '../palette/ShortcutCapture';

const EXPORT_FILE_NAME = 'planar-shortcuts.json';

/** Every command with its shortcuts: add, remove or reset them, reset all, and import or export a shortcuts file. */
export function KeyboardShortcutsDialog({ onClose }: { readonly onClose: () => void }) {
  const editor = useEditor();
  useEditorState((state) => state.shortcutsVersion);
  const [query, setQuery] = useState('');
  const [capturing, setCapturing] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filterId = useId();
  const commands = useMemo(() => searchCommands(editor.commands.all(), query), [editor, query]);
  const overrides = editor.shortcutOverrides;

  const report = (action: () => void) => {
    try {
      action();
    } catch (error) {
      editor.notify('error', error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog title="Keyboard Shortcuts" onClose={onClose} className="shortcuts-dialog">
      <h2 className="dialog__title">Keyboard Shortcuts</h2>
      <label className="shortcuts-dialog__filter" htmlFor={filterId}>
        <span className="visually-hidden">Filter commands</span>
        <input
          id={filterId}
          className="palette__input"
          type="search"
          placeholder="Filter commands…"
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
      <ul className="shortcuts-dialog__list" aria-label="Commands and shortcuts">
        {commands.map((command) => {
          const chords = editor.shortcuts.chordsFor(command.id);
          const changed = command.id in overrides;
          return (
            <li className="shortcuts-dialog__row" key={command.id}>
              <span className="shortcuts-dialog__command">
                <span className="palette__category">{command.category}</span> {command.label}
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
        })}
      </ul>
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
      <div className="dialog__footer">
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
        <button type="button" className="button button--primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
