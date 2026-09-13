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

import { useCallback, useId } from 'react';
import { hexToRgb, rgbToHex } from '../../app/styles/stylePresets';
import type { Rgb } from '../../kernel/model/types';
import { useEditor } from '../EditorContext';
import { ColorInput, TextField } from './fields';

/** A labelled drop-down. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="field__control"
        value={value}
        onChange={(event) => {
          const next = options.find((option) => option.value === event.currentTarget.value);
          if (next) onChange(next.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A labelled color picker for an sRGB color; commits when the picker closes. */
export function ColorField({
  label,
  value,
  onCommit,
}: {
  readonly label: string;
  readonly value: Rgb;
  readonly onCommit: (color: Rgb) => void;
}) {
  const commit = useCallback(
    (hex: string) => {
      const color = hexToRgb(hex);
      if (color) onCommit(color);
    },
    [onCommit],
  );
  return (
    <div className="field">
      <span className="field__label" aria-hidden="true">
        {label}
      </span>
      <ColorInput label={label} value={rgbToHex(value)} onCommit={commit} />
    </div>
  );
}

/** A labelled number that commits on Enter or blur; text that isn't a number is refused with a notice. */
export function NumberField({
  label,
  value,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly onCommit: (value: number) => boolean;
}) {
  const editor = useEditor();
  return (
    <TextField
      label={label}
      value={String(value)}
      onCommit={(text) => {
        const number = Number(text.trim().replace(',', '.'));
        if (text.trim() === '' || !Number.isFinite(number)) {
          editor.notify('error', `${label} must be a number`);
          return false;
        }
        return onCommit(number);
      }}
    />
  );
}
