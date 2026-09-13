import { useEffect, useRef, useState } from 'react';
import { validateUserChord } from '../../app/shortcuts/customization';
import { chordFromKeyboard, formatChord } from '../../app/shortcuts/shortcuts';
import { useEditor } from '../EditorContext';

interface Conflict {
  readonly chord: string;
  readonly others: readonly string[];
}

/**
 * Records the next key chord as a shortcut for a command. When another command already uses it, asks whether to
 * replace that binding or keep it. Escape cancels.
 */
export function ShortcutCapture({
  commandId,
  onDone,
}: {
  readonly commandId: string;
  readonly onDone: () => void;
}) {
  const editor = useEditor();
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const replaceRef = useRef<HTMLButtonElement>(null);
  const label = editor.commands.get(commandId)?.label ?? commandId;
  const labelOf = (id: string) => editor.commands.get(id)?.label ?? id;

  useEffect(() => {
    if (conflict) replaceRef.current?.focus();
    else captureRef.current?.focus();
  }, [conflict]);

  const assign = (chord: string, resolution: 'replace' | 'keep') => {
    try {
      editor.assignShortcut(commandId, chord, resolution);
      onDone();
    } catch (caught) {
      setConflict(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (conflict) {
    return (
      <div
        className="shortcut-capture shortcut-capture--conflict"
        role="group"
        aria-label="Shortcut conflict"
      >
        <span className="shortcut-capture__text" aria-live="polite">
          {formatChord(conflict.chord, editor.platform)} is used by {conflict.others.map(labelOf).join(', ')}.
        </span>
        <button
          type="button"
          className="button button--small button--primary"
          ref={replaceRef}
          onClick={() => {
            assign(conflict.chord, 'replace');
          }}
        >
          Replace
        </button>
        <button type="button" className="button button--small" onClick={onDone}>
          Keep
        </button>
      </div>
    );
  }

  return (
    <div
      ref={captureRef}
      className="shortcut-capture"
      role="application"
      tabIndex={0}
      aria-label={`Press the new shortcut for ${label}`}
      onKeyDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') {
          onDone();
          return;
        }
        const chord = chordFromKeyboard(event, editor.platform);
        if (!chord) return;
        const valid = validateUserChord(chord);
        if (!valid.ok) {
          setError(valid.error);
          return;
        }
        const others = editor.shortcutConflicts(commandId, valid.value);
        if (others.length > 0) setConflict({ chord: valid.value, others });
        else assign(valid.value, 'replace');
      }}
    >
      <span className="shortcut-capture__text" aria-live="polite">
        {error ?? `Press the new shortcut for ${label}, or Esc to cancel`}
      </span>
    </div>
  );
}
