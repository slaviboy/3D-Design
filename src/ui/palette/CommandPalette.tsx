import { useMemo, useRef, useState } from 'react';
import { searchCommands } from '../../app/commands/search';
import { formatChord } from '../../app/shortcuts/shortcuts';
import { Dialog } from '../common/Dialog';
import { useEditor, useEditorState } from '../EditorContext';
import { ShortcutCapture } from './ShortcutCapture';

export function CommandPalette({ onClose }: { readonly onClose: () => void }) {
  const editor = useEditor();
  useEditorState((state) => state.shortcutsVersion);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [capturing, setCapturing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchCommands(editor.commands.all(), query), [editor, query]);
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  const run = (commandId: string) => {
    onClose();
    void editor.runCommand(commandId);
  };

  return (
    <Dialog title="Search commands" onClose={onClose} className="palette">
      <input
        ref={inputRef}
        className="palette__input"
        type="search"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-results"
        aria-activedescendant={results[activeIndex] ? `palette-option-${String(activeIndex)}` : undefined}
        aria-label="Search commands"
        placeholder="Search commands…"
        value={query}
        autoFocus
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, results.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const command = results[activeIndex];
            if (command && editor.commands.isEnabled(command.id, editor)) run(command.id);
          }
        }}
      />
      {capturing && (
        <ShortcutCapture
          commandId={capturing}
          onDone={() => {
            setCapturing(null);
            inputRef.current?.focus();
          }}
        />
      )}
      <ul className="palette__results" id="palette-results" role="listbox" aria-label="Commands">
        {results.length === 0 && <li className="palette__empty">No matching commands</li>}
        {results.map((command, index) => {
          const enabled = editor.commands.isEnabled(command.id, editor);
          const chord = editor.shortcuts.chordsFor(command.id)[0];
          return (
            <li
              key={command.id}
              id={`palette-option-${String(index)}`}
              role="option"
              aria-selected={index === activeIndex}
              aria-disabled={!enabled}
              className={`palette__option${index === activeIndex ? ' palette__option--active' : ''}`}
              onPointerMove={() => {
                setActive(index);
              }}
              onClick={() => {
                if (enabled) run(command.id);
              }}
            >
              <span className="palette__category">{command.category}</span>
              <span className="palette__label">{command.label}</span>
              <span className="palette__shortcut">{chord ? formatChord(chord, editor.platform) : ''}</span>
              <button
                type="button"
                className="palette__edit-shortcut"
                aria-label={`Change shortcut for ${command.label}`}
                title="Change shortcut"
                onClick={(event) => {
                  event.stopPropagation();
                  setCapturing(command.id);
                }}
              >
                ⌨
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
