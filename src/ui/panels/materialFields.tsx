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

import { DEFAULT_MATERIAL_LABEL } from '../../app/tools/PaintBucketTool';
import type { FaceId, MaterialId } from '../../kernel/ids';
import { DEFAULT_TEXTURE_PLACEMENT, type TexturePlacement } from '../../kernel/model/types';
import type { FaceSide } from '../../kernel/ops/materials';
import { formatLength } from '../../kernel/units/units';
import { parseMeasurement } from '../../kernel/vcb/parseMeasurement';
import { useEditor } from '../EditorContext';
import { CommitInput } from './fields';

/** A material shown in Entity Info, with a button that applies the active material instead. */
export function MaterialField({
  label,
  value,
  onUseActive,
}: {
  readonly label: string;
  readonly value: MaterialId | null | 'mixed';
  readonly onUseActive: () => void;
}) {
  const editor = useEditor();
  const name =
    value === 'mixed'
      ? 'Mixed'
      : value === null
        ? DEFAULT_MATERIAL_LABEL
        : (editor.session.doc.material(value)?.name ?? DEFAULT_MATERIAL_LABEL);
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <span className="material-field">
        <span className="material-field__name" data-testid={`material-field-${label}`}>
          {name}
        </span>
        <button
          type="button"
          className="button button--small"
          aria-label={`Set ${label.toLowerCase()} to the active material`}
          title="Set to the active material"
          onClick={onUseActive}
        >
          Use Active
        </button>
      </span>
    </div>
  );
}

const DEGREES = 180 / Math.PI;

/** Numeric texture position for one side of a face: offset, rotation and scale. */
export function TexturePlacementFields({
  faceId,
  side,
  placement,
}: {
  readonly faceId: FaceId;
  readonly side: FaceSide;
  readonly placement: TexturePlacement | null;
}) {
  const editor = useEditor();
  const current = placement ?? DEFAULT_TEXTURE_PLACEMENT;
  const sideLabel = side === 'front' ? 'Front' : 'Back';
  const commit = (patch: Partial<TexturePlacement>): boolean =>
    editor.setFaceTexturePlacement(faceId, side, { ...current, ...patch });
  const reject = (message: string): false => {
    editor.notify('error', message);
    return false;
  };
  const length = (text: string): number | null => {
    const parsed = parseMeasurement(text, ['length'], editor.units);
    return parsed.ok && parsed.value.kind === 'length' ? parsed.value.value : null;
  };
  const number = (text: string): number | null => {
    const value = Number(text.trim());
    return text.trim() !== '' && Number.isFinite(value) ? value : null;
  };
  const row = (label: string, value: string, onCommit: (text: string) => boolean) => (
    <div className="field" key={label}>
      <span className="field__label" aria-hidden="true">
        {label}
      </span>
      <CommitInput label={`${sideLabel} texture ${label.toLowerCase()}`} value={value} onCommit={onCommit} />
    </div>
  );
  return (
    <div className="material-placement" role="group" aria-label={`${sideLabel} texture position`}>
      <p className="panel__caption">{`${sideLabel} texture position`}</p>
      {row('Offset X', formatLength(current.offsetX, editor.units), (text) => {
        const value = length(text);
        return value === null ? reject('Enter an offset length') : commit({ offsetX: value });
      })}
      {row('Offset Y', formatLength(current.offsetY, editor.units), (text) => {
        const value = length(text);
        return value === null ? reject('Enter an offset length') : commit({ offsetY: value });
      })}
      {row('Rotation (°)', String(Number((current.rotation * DEGREES).toFixed(3))), (text) => {
        const value = number(text);
        return value === null ? reject('Enter an angle in degrees') : commit({ rotation: value / DEGREES });
      })}
      {row('Scale X', String(current.scaleX), (text) => {
        const value = number(text);
        return value === null || value === 0 ? reject('Enter a non-zero scale') : commit({ scaleX: value });
      })}
      {row('Scale Y', String(current.scaleY), (text) => {
        const value = number(text);
        return value === null || value === 0 ? reject('Enter a non-zero scale') : commit({ scaleY: value });
      })}
      {placement && (
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            editor.setFaceTexturePlacement(faceId, side, null);
          }}
        >
          Reset Position
        </button>
      )}
    </div>
  );
}
