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

import { useEffect, useId, useRef, useState } from 'react';
import { defaultText3DForm, type Text3DForm } from '../../app/text3d/text3dForm';
import type { TextAlign } from '../../kernel/text/layout';
import { Dialog } from '../common/Dialog';
import { useEditor } from '../EditorContext';

const ALIGN_LABELS: readonly { readonly value: TextAlign; readonly label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

/** Asks for the text, size and style of 3D text, then hands over to the placement tool. */
export function Text3DDialog({ onClose }: { readonly onClose: () => void }) {
  const editor = useEditor();
  const [form, setForm] = useState<Text3DForm>(() => editor.text3DForm ?? defaultText3DForm(editor.units));
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const textId = useId();
  const alignId = useId();
  const heightId = useId();
  const depthId = useId();
  const errorId = useId();
  const update = (patch: Partial<Text3DForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
  };

  // Runs after the dialog focuses its first input, so typing starts in the text box.
  useEffect(() => {
    textRef.current?.focus();
    textRef.current?.select();
  }, []);

  return (
    <Dialog title="3D Text" onClose={onClose} className="text3d-dialog">
      <h2 className="dialog__title">3D Text</h2>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const message = editor.submitText3DForm(form);
          if (message === null) onClose();
          else setError(message);
        }}
      >
        <div className="input-dialog__field">
          <label htmlFor={textId}>Text</label>
          <textarea
            id={textId}
            ref={textRef}
            className="input-dialog__input text3d-dialog__text"
            rows={3}
            value={form.text}
            spellCheck={false}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              update({ text: event.currentTarget.value });
            }}
          />
        </div>

        <fieldset className="preferences__group">
          <legend>Size and style</legend>
          <div className="preferences__field">
            <label htmlFor={alignId}>Alignment</label>
            <select
              id={alignId}
              value={form.align}
              onChange={(event) => {
                update({ align: event.currentTarget.value as TextAlign });
              }}
            >
              {ALIGN_LABELS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="preferences__field">
            <label htmlFor={heightId}>Height</label>
            <input
              id={heightId}
              className="input-dialog__input"
              value={form.height}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                update({ height: event.currentTarget.value });
              }}
            />
          </div>
          <label className="preferences__check">
            <input
              type="checkbox"
              checked={form.filled}
              onChange={(event) => {
                update({ filled: event.currentTarget.checked });
              }}
            />
            Filled letters (faces)
          </label>
          <label className="preferences__check">
            <input
              type="checkbox"
              checked={form.extruded}
              disabled={!form.filled}
              onChange={(event) => {
                update({ extruded: event.currentTarget.checked });
              }}
            />
            Extruded
          </label>
          <div className="preferences__field">
            <label htmlFor={depthId}>Extrusion depth</label>
            <input
              id={depthId}
              className="input-dialog__input"
              value={form.depth}
              disabled={!form.filled || !form.extruded}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                update({ depth: event.currentTarget.value });
              }}
            />
          </div>
          <label className="preferences__check">
            <input
              type="checkbox"
              checked={form.component}
              onChange={(event) => {
                update({ component: event.currentTarget.checked });
              }}
            />
            Make a component
          </label>
        </fieldset>

        {error && (
          <p id={errorId} className="text3d-dialog__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__footer text3d-dialog__footer">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary">
            Place
          </button>
        </div>
      </form>
    </Dialog>
  );
}
