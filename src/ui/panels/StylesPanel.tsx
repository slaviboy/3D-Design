import { useId } from 'react';
import {
  EDGE_COLOR_MODE_LABELS,
  FACE_STYLE_LABELS,
  matchingInModelStyle,
  matchingPreset,
  STYLE_PRESETS,
} from '../../app/styles/stylePresets';
import { EDGE_COLOR_MODES, FACE_STYLES } from '../../kernel/model/types';
import { useEditor, useEditorState } from '../EditorContext';
import { CheckField } from './fields';
import { Panel } from './Panel';
import { ColorField, NumberField, SelectField } from './styleFields';

const FACE_STYLE_OPTIONS = FACE_STYLES.map((value) => ({ value, label: FACE_STYLE_LABELS[value] }));
const EDGE_COLOR_OPTIONS = EDGE_COLOR_MODES.map((value) => ({ value, label: EDGE_COLOR_MODE_LABELS[value] }));

/** Built-in and in-model styles, and the face, edge and background settings of the current style. */
export function StylesPanel() {
  const editor = useEditor();
  const style = useEditorState((state) => state.style);
  const inModelStyles = useEditorState((state) => state.inModelStyles);
  const presetsId = useId();
  const savedId = useId();
  const activePreset = matchingPreset(style);
  const activeSaved = matchingInModelStyle(inModelStyles, style);
  const update = editor.updateStyleSettings.bind(editor);

  return (
    <Panel id="styles" title="Styles">
      <div className="styles">
        <h3 className="styles__heading" id={presetsId}>
          Built-in styles
        </h3>
        <ul className="styles__list" aria-labelledby={presetsId}>
          {STYLE_PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                className="button button--small styles__choice"
                aria-pressed={activePreset?.id === preset.id}
                title={preset.description}
                onClick={() => {
                  editor.applyStylePreset(preset.id);
                }}
              >
                {preset.name}
              </button>
            </li>
          ))}
        </ul>

        <h3 className="styles__heading" id={savedId}>
          In-model styles
        </h3>
        {inModelStyles.length === 0 ? (
          <p className="styles__note">No styles are saved in this model.</p>
        ) : (
          <ul className="styles__list" aria-labelledby={savedId}>
            {inModelStyles.map((named) => (
              <li key={named.name} className="styles__row">
                <button
                  type="button"
                  className="button button--small styles__choice"
                  aria-pressed={activeSaved?.name === named.name}
                  onClick={() => {
                    editor.applyInModelStyle(named.name);
                  }}
                >
                  {named.name}
                </button>
                <button
                  type="button"
                  className="button button--small"
                  aria-label={`Update ${named.name} from the current settings`}
                  onClick={() => {
                    editor.updateInModelStyle(named.name);
                  }}
                >
                  Update
                </button>
                <button
                  type="button"
                  className="button button--small"
                  aria-label={`Delete ${named.name}`}
                  onClick={() => {
                    editor.deleteInModelStyle(named.name);
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="button button--small styles__save"
          onClick={() => {
            editor.promptSaveInModelStyle();
          }}
        >
          Save as In-Model Style…
        </button>

        <fieldset className="styles__group">
          <legend>Faces</legend>
          <SelectField
            label="Face style"
            value={style.faceStyle}
            options={FACE_STYLE_OPTIONS}
            onChange={(faceStyle) => {
              update({ faceStyle }, 'Face Style');
            }}
          />
          <CheckField
            label="X-ray"
            value={style.xRay}
            onChange={(xRay) => {
              update({ xRay }, 'X-Ray');
            }}
          />
          <ColorField
            label="Front color"
            value={style.frontColor}
            onCommit={(frontColor) => {
              update({ frontColor });
            }}
          />
          <ColorField
            label="Back color"
            value={style.backColor}
            onCommit={(backColor) => {
              update({ backColor });
            }}
          />
        </fieldset>

        <fieldset className="styles__group">
          <legend>Edges</legend>
          <CheckField
            label="Edges"
            value={style.showEdges}
            onChange={(showEdges) => {
              update({ showEdges });
            }}
          />
          <CheckField
            label="Back edges"
            value={style.backEdges}
            onChange={(backEdges) => {
              update({ backEdges });
            }}
          />
          <CheckField
            label="Profiles"
            value={style.profiles}
            onChange={(profiles) => {
              update({ profiles });
            }}
          />
          <NumberField
            label="Profile width (px)"
            value={style.profileWidth}
            onCommit={(profileWidth) => update({ profileWidth })}
          />
          <CheckField
            label="Depth cue"
            value={style.depthCue}
            onChange={(depthCue) => {
              update({ depthCue });
            }}
          />
          <NumberField
            label="Depth cue width (px)"
            value={style.depthCueWidth}
            onCommit={(depthCueWidth) => update({ depthCueWidth })}
          />
          <CheckField
            label="Extensions"
            value={style.extensions}
            onChange={(extensions) => {
              update({ extensions });
            }}
          />
          <NumberField
            label="Extension length (px)"
            value={style.extensionLength}
            onCommit={(extensionLength) => update({ extensionLength })}
          />
          <CheckField
            label="Endpoints"
            value={style.endpoints}
            onChange={(endpoints) => {
              update({ endpoints });
            }}
          />
          <SelectField
            label="Color edges"
            value={style.edgeColorMode}
            options={EDGE_COLOR_OPTIONS}
            onChange={(edgeColorMode) => {
              update({ edgeColorMode });
            }}
          />
          <ColorField
            label="Edge color"
            value={style.edgeColor}
            onCommit={(edgeColor) => {
              update({ edgeColor });
            }}
          />
        </fieldset>

        <fieldset className="styles__group">
          <legend>Background</legend>
          <ColorField
            label="Background"
            value={style.backgroundColor}
            onCommit={(backgroundColor) => {
              update({ backgroundColor });
            }}
          />
          <CheckField
            label="Sky"
            value={style.sky}
            onChange={(sky) => {
              update({ sky });
            }}
          />
          <ColorField
            label="Sky color"
            value={style.skyColor}
            onCommit={(skyColor) => {
              update({ skyColor });
            }}
          />
          <CheckField
            label="Ground"
            value={style.ground}
            onChange={(ground) => {
              update({ ground });
            }}
          />
          <ColorField
            label="Ground color"
            value={style.groundColor}
            onCommit={(groundColor) => {
              update({ groundColor });
            }}
          />
          <CheckField
            label="Show ground from below"
            value={style.groundFromBelow}
            onChange={(groundFromBelow) => {
              update({ groundFromBelow });
            }}
          />
        </fieldset>
      </div>
    </Panel>
  );
}
