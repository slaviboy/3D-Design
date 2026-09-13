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

import { MAX_TEXT_LENGTH, MIN_TEXT_HEIGHT, type Text3DOptions } from '../../kernel/ops/text3d';
import { err, ok, type Result } from '../../kernel/result';
import type { TextAlign } from '../../kernel/text/layout';
import { formatLength, parseLength, type UnitSettings } from '../../kernel/units/units';

/** What the 3D Text dialog edits. Lengths stay as typed until the user places the text. */
export interface Text3DForm {
  readonly text: string;
  readonly align: TextAlign;
  readonly height: string;
  readonly filled: boolean;
  readonly extruded: boolean;
  readonly depth: string;
  readonly component: boolean;
}

export const DEFAULT_TEXT_HEIGHT = 0.5;
export const DEFAULT_TEXT_DEPTH = 0.1;

export function defaultText3DForm(units: UnitSettings): Text3DForm {
  return {
    text: '',
    align: 'left',
    height: formatLength(DEFAULT_TEXT_HEIGHT, units),
    filled: true,
    extruded: true,
    depth: formatLength(DEFAULT_TEXT_DEPTH, units),
    component: false,
  };
}

/** Checks the dialog's values and turns them into options for `create3DText`. */
export function parseText3DForm(form: Text3DForm, units: UnitSettings): Result<Text3DOptions> {
  if (form.text.trim() === '') return err('Type the text to place');
  if (form.text.length > MAX_TEXT_LENGTH) {
    return err(`Text is limited to ${String(MAX_TEXT_LENGTH)} characters`);
  }
  const height = parseLength(form.height, units);
  if (!height.ok) return err(`Height: ${height.error}`);
  if (height.value < MIN_TEXT_HEIGHT)
    return err(`Height must be at least ${formatLength(MIN_TEXT_HEIGHT, units)}`);
  let depth = 0;
  if (form.filled && form.extruded) {
    const parsed = parseLength(form.depth, units);
    if (!parsed.ok) return err(`Extrusion: ${parsed.error}`);
    if (parsed.value <= 0) return err('Extrusion depth must be more than zero');
    depth = parsed.value;
  }
  return ok({
    text: form.text,
    height: height.value,
    align: form.align,
    filled: form.filled,
    depth,
    component: form.component,
  });
}
