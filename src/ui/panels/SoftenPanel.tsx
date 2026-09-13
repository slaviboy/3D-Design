import { useId, useState } from 'react';
import { useEditor, useEditorState } from '../EditorContext';
import { Panel } from './Panel';

const DEFAULT_ANGLE_DEGREES = 20;
const MAX_ANGLE_DEGREES = 180;

/** Softens selected edges, and the edges of selected faces, by the angle between their faces. */
export function SoftenPanel() {
  const editor = useEditor();
  const selectedEdges = useEditorState((state) => state.selectionEdges);
  const selectedFaces = useEditorState((state) => state.selectionFaces);
  const [angle, setAngle] = useState(DEFAULT_ANGLE_DEGREES);
  const [smooth, setSmooth] = useState(true);
  const [softenCoplanar, setSoftenCoplanar] = useState(true);
  const angleId = useId();
  const canApply = selectedEdges + selectedFaces > 0;

  return (
    <Panel id="soften" title="Soften Edges">
      <div className="soften">
        <div className="soften__row">
          <label htmlFor={angleId}>Angle between normals</label>
          <output htmlFor={angleId}>{`${String(angle)}°`}</output>
        </div>
        <input
          id={angleId}
          type="range"
          min={0}
          max={MAX_ANGLE_DEGREES}
          step={1}
          value={angle}
          onChange={(event) => {
            setAngle(Number(event.currentTarget.value));
          }}
        />
        <label className="soften__check">
          <input
            type="checkbox"
            checked={smooth}
            onChange={(event) => {
              setSmooth(event.currentTarget.checked);
            }}
          />
          Smooth normals
        </label>
        <label className="soften__check">
          <input
            type="checkbox"
            checked={softenCoplanar}
            onChange={(event) => {
              setSoftenCoplanar(event.currentTarget.checked);
            }}
          />
          Soften coplanar
        </label>
        <button
          type="button"
          className="button button--small"
          disabled={!canApply}
          onClick={() => {
            try {
              const changed = editor.softenSelection({ maxAngleDegrees: angle, softenCoplanar, smooth });
              editor.notify('info', `${String(changed)} ${changed === 1 ? 'edge' : 'edges'} changed`);
            } catch (error) {
              editor.notify('error', error instanceof Error ? error.message : String(error));
            }
          }}
        >
          Apply to Selection
        </button>
      </div>
    </Panel>
  );
}
