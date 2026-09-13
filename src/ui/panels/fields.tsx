import { useEffect, useRef, useState } from 'react';
import type { Tristate } from '../../app/selection/entityInfo';

/**
 * A text input that commits on Enter or when it loses focus, and reverts on Escape. `onCommit` may return false to
 * reject the value, which restores the current one.
 */
export function CommitInput({
  value,
  label,
  className = 'field__control',
  onCommit,
}: {
  readonly value: string;
  readonly label: string;
  readonly className?: string;
  readonly onCommit: (value: string) => unknown;
}) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  const cancelled = useRef(false);
  if (value !== shown) {
    setShown(value);
    setDraft(value);
  }
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft.trim() === value.trim()) {
      setDraft(value);
      return;
    }
    if (onCommit(draft) === false) setDraft(value);
  };
  return (
    <input
      type="text"
      className={className}
      aria-label={label}
      value={draft}
      spellCheck={false}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelled.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** A labelled text field row. */
export function TextField({
  label,
  value,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly onCommit: (value: string) => unknown;
}) {
  return (
    <div className="field">
      <span className="field__label" aria-hidden="true">
        {label}
      </span>
      <CommitInput label={label} value={value} onCommit={onCommit} />
    </div>
  );
}

/** A checkbox whose `mixed` state is shown as indeterminate. */
export function CheckField({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: Tristate;
  readonly onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = value === 'mixed';
  }, [value]);
  return (
    <label className="field field--check">
      <input
        ref={ref}
        type="checkbox"
        checked={value === true}
        aria-checked={value === 'mixed' ? 'mixed' : value}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <span>{label}</span>
    </label>
  );
}

/** A color input that commits when the picker is closed, not on every intermediate color. */
export function ColorInput({
  value,
  label,
  onCommit,
}: {
  readonly value: string;
  readonly label: string;
  readonly onCommit: (hex: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setDraft(value);
  }
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const onChange = () => {
      onCommit(input.value);
    };
    input.addEventListener('change', onChange);
    return () => {
      input.removeEventListener('change', onChange);
    };
  }, [onCommit]);
  return (
    <input
      ref={ref}
      type="color"
      className="color-input"
      aria-label={label}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
    />
  );
}
