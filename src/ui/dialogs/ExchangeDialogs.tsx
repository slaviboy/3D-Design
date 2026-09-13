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

import { useId, useState, type ReactNode } from 'react';
import type { ExchangeRequest } from '../../app/io/ModelExchange';
import type { ExportFormatId } from '../../io/export/formats';
import type { LengthUnit } from '../../kernel/units/units';
import { Dialog } from '../common/Dialog';
import { useEditor } from '../EditorContext';

const UNIT_LABELS: Readonly<Record<LengthUnit, string>> = {
  mm: 'Millimeters',
  cm: 'Centimeters',
  m: 'Meters',
  km: 'Kilometers',
  in: 'Inches',
  ft: 'Feet',
  yd: 'Yards',
  mi: 'Miles',
};

const UNITS = Object.keys(UNIT_LABELS) as LengthUnit[];

type Request<K extends ExchangeRequest['kind']> = Extract<ExchangeRequest, { kind: K }>;

/** The dialog for an import or export request from the editor. */
export function ExchangeDialog({ request }: { readonly request: ExchangeRequest }) {
  switch (request.kind) {
    case 'import-options':
      return <ImportOptionsDialog request={request} />;
    case 'export-model':
      return <ExportModelDialog request={request} />;
    case 'export-image':
      return <ExportImageDialog request={request} />;
    case 'progress':
      return <ProgressDialog request={request} />;
  }
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="exchange-dialog__field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

function Check({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="exchange-dialog__check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      {label}
    </label>
  );
}

function UnitSelect({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: LengthUnit;
  readonly onChange: (unit: LengthUnit) => void;
}) {
  return (
    <select
      id={id}
      className="input-dialog__input"
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value as LengthUnit);
      }}
    >
      {UNITS.map((unit) => (
        <option key={unit} value={unit}>
          {UNIT_LABELS[unit]}
        </option>
      ))}
    </select>
  );
}

function Footer({
  onCancel,
  confirmLabel,
}: {
  readonly onCancel: () => void;
  readonly confirmLabel: string;
}) {
  return (
    <div className="dialog__footer">
      <button type="button" className="button" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="button button--primary">
        {confirmLabel}
      </button>
    </div>
  );
}

function ImportOptionsDialog({ request }: { readonly request: Request<'import-options'> }) {
  const editor = useEditor();
  const { format } = request;
  const [unit, setUnit] = useState<LengthUnit>(format.defaultUnit);
  const [swap, setSwap] = useState(format.defaultSwapYUpToZUp);
  const [merge, setMerge] = useState(true);
  const [as, setAs] = useState<'group' | 'component'>('group');
  const cancel = () => {
    editor.exchange.dismissRequest();
  };
  return (
    <Dialog title="Import Options" onClose={cancel} className="exchange-dialog">
      <h2 className="dialog__title">Import {request.fileName}</h2>
      <p className="dialog__text">{format.label}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          request.submit({ unit, swapYUpToZUp: swap, mergeCoplanar: merge, as });
        }}
      >
        {format.unitsFromFile ? (
          <p className="exchange-dialog__note">
            The file states its own units and up axis, and they are used.
          </p>
        ) : (
          <>
            <Field label="File units">{(id) => <UnitSelect id={id} value={unit} onChange={setUnit} />}</Field>
            <Check label="Y axis is up in the file (turn it to Z up)" checked={swap} onChange={setSwap} />
          </>
        )}
        <Check label="Merge coplanar faces" checked={merge} onChange={setMerge} />
        <Field label="Import as">
          {(id) => (
            <select
              id={id}
              className="input-dialog__input"
              value={as}
              onChange={(event) => {
                setAs(event.currentTarget.value === 'component' ? 'component' : 'group');
              }}
            >
              <option value="group">Group</option>
              <option value="component">Component</option>
            </select>
          )}
        </Field>
        <p className="exchange-dialog__note">The model is placed at the origin and selected.</p>
        <Footer onCancel={cancel} confirmLabel="Import" />
      </form>
    </Dialog>
  );
}

function ExportModelDialog({ request }: { readonly request: Request<'export-model'> }) {
  const editor = useEditor();
  const [formatId, setFormatId] = useState<ExportFormatId>(request.formats[0]?.id ?? 'glb');
  const format = request.formats.find((candidate) => candidate.id === formatId) ?? request.formats[0];
  const [fileName, setFileName] = useState(request.fileName);
  const [unit, setUnit] = useState<LengthUnit>(format?.defaultUnit ?? 'm');
  const [swap, setSwap] = useState(format?.defaultSwapZUpToYUp ?? false);
  const [selectionOnly, setSelectionOnly] = useState(false);
  const cancel = () => {
    editor.exchange.dismissRequest();
  };
  if (!format) return null;
  return (
    <Dialog title="Export 3D Model" onClose={cancel} className="exchange-dialog">
      <h2 className="dialog__title">Export 3D Model</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          request.submit({ format: format.id, fileName, selectionOnly, unit, swapZUpToYUp: swap });
        }}
      >
        <Field label="File name">
          {(id) => (
            <input
              id={id}
              className="input-dialog__input"
              value={fileName}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                setFileName(event.currentTarget.value);
              }}
            />
          )}
        </Field>
        <Field label="Format">
          {(id) => (
            <select
              id={id}
              className="input-dialog__input"
              value={format.id}
              onChange={(event) => {
                const next = request.formats.find((candidate) => candidate.id === event.currentTarget.value);
                if (!next) return;
                setFormatId(next.id);
                setUnit(next.defaultUnit);
                setSwap(next.defaultSwapZUpToYUp);
              }}
            >
              {request.formats.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        {format.allowsUnits ? (
          <Field label="File units">{(id) => <UnitSelect id={id} value={unit} onChange={setUnit} />}</Field>
        ) : (
          <p className="exchange-dialog__note">glTF files are always written in meters with Y up.</p>
        )}
        {format.allowsSwap && <Check label="Y axis up (swap Y and Z)" checked={swap} onChange={setSwap} />}
        <Check
          label="Selection only"
          checked={selectionOnly && request.hasSelection}
          disabled={!request.hasSelection}
          onChange={setSelectionOnly}
        />
        <p className="exchange-dialog__note">
          Faces are exported as triangles. Hidden entities and entities on hidden tags are left out.
        </p>
        <Footer onCancel={cancel} confirmLabel="Export" />
      </form>
    </Dialog>
  );
}

function ExportImageDialog({ request }: { readonly request: Request<'export-image'> }) {
  const editor = useEditor();
  const [fileName, setFileName] = useState(request.fileName);
  const [width, setWidth] = useState(String(request.width));
  const [height, setHeight] = useState(String(request.height));
  const [transparent, setTransparent] = useState(false);
  const cancel = () => {
    editor.exchange.dismissRequest();
  };
  const sizeField = (label: string, value: string, set: (value: string) => void) => (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          className="input-dialog__input"
          type="number"
          min={1}
          max={request.maxEdge}
          step={1}
          value={value}
          onChange={(event) => {
            set(event.currentTarget.value);
          }}
        />
      )}
    </Field>
  );
  return (
    <Dialog title="Export 2D Graphic" onClose={cancel} className="exchange-dialog">
      <h2 className="dialog__title">Export 2D Graphic</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          request.submit({
            fileName,
            width: Number(width),
            height: Number(height),
            transparentBackground: transparent,
          });
        }}
      >
        <Field label="File name">
          {(id) => (
            <input
              id={id}
              className="input-dialog__input"
              value={fileName}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                setFileName(event.currentTarget.value);
              }}
            />
          )}
        </Field>
        <div className="exchange-dialog__row">
          {sizeField('Width (pixels)', width, setWidth)}
          {sizeField('Height (pixels)', height, setHeight)}
        </div>
        <Check label="Transparent background" checked={transparent} onChange={setTransparent} />
        <p className="exchange-dialog__note">
          PNG image of the current view, up to {String(request.maxEdge)} pixels on each side.
        </p>
        <Footer onCancel={cancel} confirmLabel="Export" />
      </form>
    </Dialog>
  );
}

function ProgressDialog({ request }: { readonly request: Request<'progress'> }) {
  const editor = useEditor();
  const cancel = () => {
    editor.exchange.dismissRequest();
  };
  return (
    <Dialog title={request.title} onClose={cancel} className="exchange-dialog">
      <h2 className="dialog__title">{request.title}</h2>
      <p className="dialog__text" role="status">
        {request.message}
      </p>
      <progress className="exchange-dialog__progress" />
      <div className="dialog__footer">
        <button type="button" className="button" disabled={!request.cancel} onClick={cancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
