import { useId, useMemo, useRef, useState } from 'react';
import { MATERIAL_LIBRARY, type MaterialRow } from '../../app/materials/materials';
import { hexToRgb, rgbToHex } from '../../app/tags/tags';
import { DEFAULT_MATERIAL_LABEL } from '../../app/tools/PaintBucketTool';
import { formatArea, formatLength } from '../../kernel/units/units';
import { parseMeasurement } from '../../kernel/vcb/parseMeasurement';
import { useEditor, useEditorState } from '../EditorContext';
import { ColorInput, CommitInput } from './fields';
import { Panel } from './Panel';

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg'];

/** A color swatch; textured materials get a hatched overlay. */
export function MaterialSwatch({
  row,
}: {
  readonly row: Pick<MaterialRow, 'color' | 'opacity' | 'texture'> | null;
}) {
  const className = `material-swatch${row === null ? ' material-swatch--default' : ''}${row?.texture ? ' material-swatch--texture' : ''}`;
  return (
    <span
      className={className}
      aria-hidden="true"
      style={row ? { backgroundColor: rgbToHex(row.color), opacity: Math.max(0.25, row.opacity) } : undefined}
    />
  );
}

/** A labelled number field that commits on Enter or blur. `parse` returns null to reject the text. */
function NumberField({
  label,
  value,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly onCommit: (text: string) => boolean;
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

const round = (value: number, digits: number): string => String(Number(value.toFixed(digits)));

function MaterialEditor({ row }: { readonly row: MaterialRow }) {
  const editor = useEditor();
  const fileInput = useRef<HTMLInputElement>(null);
  const [aspectLocked, setAspectLocked] = useState(true);
  const unit = (text: string, scale: number): number | null => {
    const value = Number(text.trim().replace(/%$/, '')) / scale;
    return Number.isFinite(value) && text.trim() !== '' ? value : null;
  };
  const length = (text: string): number | null => {
    const parsed = parseMeasurement(text, ['length'], editor.units);
    return parsed.ok && parsed.value.kind === 'length' ? parsed.value.value : null;
  };
  const reject = (message: string): false => {
    editor.notify('error', message);
    return false;
  };

  const importFile = async (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      editor.notify('error', `${file.name} is not a PNG or JPEG image`);
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const bitmap = await createImageBitmap(file);
      const aspect = bitmap.height / bitmap.width;
      bitmap.close();
      editor.importMaterialTexture(row.id, file.name, bytes, { width: 1, height: aspect });
    } catch (error) {
      editor.notify(
        'error',
        `Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return (
    <div className="material-editor" aria-label={`Edit ${row.name}`} role="group">
      <div className="field">
        <span className="field__label" aria-hidden="true">
          Name
        </span>
        <CommitInput
          label="Material name"
          value={row.name}
          onCommit={(name) => editor.renameMaterial(row.id, name)}
        />
      </div>
      <div className="field">
        <span className="field__label" aria-hidden="true">
          Color
        </span>
        <span className="material-editor__color">
          <ColorInput
            label="Material color"
            value={rgbToHex(row.color)}
            onCommit={(hex) => {
              const color = hexToRgb(hex);
              if (color) editor.updateMaterial(row.id, { color });
            }}
          />
          <CommitInput
            label="Material color hex"
            value={rgbToHex(row.color)}
            onCommit={(hex) => {
              const color = hexToRgb(hex.startsWith('#') ? hex : `#${hex}`);
              return color ? editor.updateMaterial(row.id, { color }) : reject('Enter a color as #rrggbb');
            }}
          />
        </span>
      </div>
      <NumberField
        label="Opacity (%)"
        value={round(row.opacity * 100, 1)}
        onCommit={(text) => {
          const value = unit(text, 100);
          return value === null
            ? reject('Enter an opacity from 0 to 100')
            : editor.updateMaterial(row.id, { opacity: value });
        }}
      />
      <NumberField
        label="Metalness"
        value={round(row.metalness, 3)}
        onCommit={(text) => {
          const value = unit(text, 1);
          return value === null
            ? reject('Enter a metalness from 0 to 1')
            : editor.updateMaterial(row.id, { metalness: value });
        }}
      />
      <NumberField
        label="Roughness"
        value={round(row.roughness, 3)}
        onCommit={(text) => {
          const value = unit(text, 1);
          return value === null
            ? reject('Enter a roughness from 0 to 1')
            : editor.updateMaterial(row.id, { roughness: value });
        }}
      />

      <div className="material-editor__texture">
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          hidden
          data-testid="texture-file-input"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importFile(file);
          }}
        />
        {row.texture && row.image ? (
          <>
            <p className="panel__caption">
              {`Texture: ${row.image.name} (${String(row.image.width)} × ${String(row.image.height)} px)`}
            </p>
            <NumberField
              label="Texture width"
              value={formatLength(row.texture.width, editor.units)}
              onCommit={(text) => {
                const width = length(text);
                const texture = row.texture;
                if (width === null || !texture) return reject('Enter a texture width');
                const height = aspectLocked ? (width * texture.height) / texture.width : texture.height;
                return editor.setMaterialTextureSize(row.id, width, height);
              }}
            />
            <NumberField
              label="Texture height"
              value={formatLength(row.texture.height, editor.units)}
              onCommit={(text) => {
                const height = length(text);
                const texture = row.texture;
                if (height === null || !texture) return reject('Enter a texture height');
                const width = aspectLocked ? (height * texture.width) / texture.height : texture.width;
                return editor.setMaterialTextureSize(row.id, width, height);
              }}
            />
            <label className="field field--check">
              <input
                type="checkbox"
                checked={aspectLocked}
                onChange={(event) => {
                  setAspectLocked(event.currentTarget.checked);
                }}
              />
              <span>Keep aspect ratio</span>
            </label>
          </>
        ) : null}
        <div className="panel__toolbar">
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            {row.texture ? 'Replace Texture…' : 'Import Texture…'}
          </button>
          {row.texture && (
            <button
              type="button"
              className="button button--small"
              onClick={() => {
                editor.removeMaterialTexture(row.id);
              }}
            >
              Remove Texture
            </button>
          )}
        </div>
      </div>

      <dl className="entity-info__rows">
        <div className="entity-info__row">
          <dt>Area</dt>
          <dd data-testid="material-area">{formatArea(row.area, editor.units)}</dd>
        </div>
        <div className="entity-info__row">
          <dt>Uses</dt>
          <dd>{String(row.usage)}</dd>
        </div>
      </dl>
      <div className="panel__toolbar">
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            editor.selectFacesWithMaterial(row.id);
          }}
        >
          Select Faces
        </button>
        <button
          type="button"
          className="button button--small"
          aria-label={`Delete ${row.name}`}
          onClick={() => {
            editor.deleteMaterial(row.id);
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** Materials in the model: choose the active material, create, edit, texture, delete and purge. */
export function MaterialsPanel() {
  const editor = useEditor();
  const revision = useEditorState((state) => state.revision);
  const activeMaterialId = useEditorState((state) => state.activeMaterialId);
  const selectionTotal = useEditorState((state) => state.selectionTotal);
  const rows = useMemo(
    () => editor.materialRows(),
    // revision is the change signal for the mutable document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, revision],
  );
  const radioGroup = useId();
  const active = rows.find((row) => row.id === activeMaterialId) ?? null;

  return (
    <Panel id="materials" title="Materials">
      <div className="panel__toolbar">
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            editor.addMaterial();
          }}
        >
          New Material
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={selectionTotal === 0}
          onClick={() => {
            editor.paintSelection();
          }}
        >
          Paint Selection
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!rows.some((row) => row.usage === 0)}
          onClick={() => {
            editor.purgeUnusedMaterials();
          }}
        >
          Purge Unused
        </button>
      </div>
      <ul className="item-list" aria-label="Materials in the model">
        <li className="item-list__item">
          <label className="material-row">
            <input
              type="radio"
              name={radioGroup}
              checked={activeMaterialId === null}
              onChange={() => {
                editor.setActiveMaterial(null);
              }}
            />
            <MaterialSwatch row={null} />
            <span className="material-row__name">{DEFAULT_MATERIAL_LABEL}</span>
          </label>
        </li>
        {rows.map((row) => (
          <li className="item-list__item" key={row.id}>
            <label className="material-row">
              <input
                type="radio"
                name={radioGroup}
                checked={activeMaterialId === row.id}
                onChange={() => {
                  editor.setActiveMaterial(row.id);
                }}
              />
              <MaterialSwatch row={row} />
              <span className="material-row__name">{row.name}</span>
            </label>
            <span className="item-list__count" title="Area">
              {row.area > 0 ? formatArea(row.area, editor.units) : ''}
            </span>
          </li>
        ))}
      </ul>
      {active && <MaterialEditor row={active} key={active.id} />}
      <details className="material-library">
        <summary>Library</summary>
        <ul className="item-list" aria-label="Material library">
          {MATERIAL_LIBRARY.map((entry) => (
            <li className="item-list__item" key={entry.name}>
              <button
                type="button"
                className="material-row material-row--button"
                aria-label={`Add ${entry.name} to the model`}
                onClick={() => {
                  editor.addLibraryMaterial(entry);
                }}
              >
                <MaterialSwatch
                  row={{
                    color: hexToRgb(entry.hex) ?? { r: 0.5, g: 0.5, b: 0.5 },
                    opacity: entry.opacity ?? 1,
                    texture: null,
                  }}
                />
                <span className="material-row__name">{entry.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </Panel>
  );
}
