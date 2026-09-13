import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { SceneId } from '../../kernel/ids';
import type { SceneSaves } from '../../kernel/model/types';
import { useEditor, useEditorState } from '../EditorContext';
import { CheckField, CommitInput, TextField } from './fields';
import { Panel } from './Panel';

const SAVE_FLAGS: readonly { readonly key: keyof SceneSaves; readonly label: string }[] = [
  { key: 'camera', label: 'Camera' },
  { key: 'visibleTags', label: 'Visible tags' },
  { key: 'activeSections', label: 'Active section planes' },
  { key: 'shadows', label: 'Shadow settings' },
  { key: 'axes', label: 'Axes location' },
  { key: 'style', label: 'Style' },
  { key: 'fog', label: 'Fog' },
];

/** A multi-line text area that commits when it loses focus. */
function DescriptionField({
  value,
  onCommit,
}: {
  readonly value: string;
  readonly onCommit: (text: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setDraft(value);
  }
  return (
    <div className="field field--stacked">
      <label className="field__label" htmlFor={id}>
        Description
      </label>
      <textarea
        id={id}
        className="field__control scenes__description"
        rows={2}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
      />
    </div>
  );
}

/** Scenes: add, update, delete, reorder and apply saved views, edit their details, and play them as an animation. */
export function ScenesPanel() {
  const editor = useEditor();
  const scenes = useEditorState((state) => state.scenes);
  const activeSceneId = useEditorState((state) => state.activeSceneId);
  const playing = useEditorState((state) => state.animationPlaying);
  const transition = useEditorState((state) => state.sceneTransitionSeconds);
  const delay = useEditorState((state) => state.sceneDelaySeconds);
  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  const active = scenes.find((scene) => scene.id === activeSceneId);
  const activeIndex = scenes.findIndex((scene) => scene.id === activeSceneId);

  const focusScene = (index: number) => {
    const scene = scenes[Math.min(Math.max(index, 0), scenes.length - 1)];
    if (scene) rowRefs.current.get(scene.id)?.focus();
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number, id: SceneId) => {
    switch (event.key) {
      case 'ArrowDown':
        focusScene(index + 1);
        break;
      case 'ArrowUp':
        focusScene(index - 1);
        break;
      case 'Home':
        focusScene(0);
        break;
      case 'End':
        focusScene(scenes.length - 1);
        break;
      case 'Enter':
      case ' ':
        editor.applyScene(id);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const seconds = (text: string, apply: (value: number) => void): boolean => {
    const value = Number(text.trim().replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(value) || value < 0) {
      editor.notify('error', 'Enter a number of seconds, 0 or more');
      return false;
    }
    apply(value);
    return true;
  };

  return (
    <Panel id="scenes" title="Scenes">
      <div className="scenes__actions" role="toolbar" aria-label="Scene actions">
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            editor.addScene();
          }}
        >
          Add
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!active}
          onClick={() => {
            editor.updateSceneFromView();
          }}
        >
          Update
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!active}
          onClick={() => {
            editor.removeScene();
          }}
        >
          Delete
        </button>
        <button
          type="button"
          className="button button--small"
          aria-label="Move scene up"
          disabled={!active || activeIndex <= 0}
          onClick={() => {
            if (active) editor.moveScene(active.id, -1);
          }}
        >
          ↑
        </button>
        <button
          type="button"
          className="button button--small"
          aria-label="Move scene down"
          disabled={!active || activeIndex >= scenes.length - 1}
          onClick={() => {
            if (active) editor.moveScene(active.id, 1);
          }}
        >
          ↓
        </button>
      </div>
      {scenes.length === 0 ? (
        <p className="panel__empty">No scenes yet. Set up a view and add a scene.</p>
      ) : (
        <ul className="scenes__list" role="listbox" aria-label="Scenes">
          {scenes.map((scene, index) => {
            const selected = scene.id === activeSceneId;
            return (
              <li
                key={scene.id}
                ref={(element) => {
                  if (element) rowRefs.current.set(scene.id, element);
                  else rowRefs.current.delete(scene.id);
                }}
                role="option"
                aria-selected={selected}
                tabIndex={selected || (activeIndex < 0 && index === 0) ? 0 : -1}
                className={`scenes__row${selected ? ' scenes__row--active' : ''}`}
                onClick={() => {
                  editor.applyScene(scene.id);
                }}
                onKeyDown={(event) => {
                  onRowKeyDown(event, index, scene.id);
                }}
              >
                <span className="scenes__name">{scene.name}</span>
                {!scene.includeInAnimation && <span className="scenes__badge">not animated</span>}
              </li>
            );
          })}
        </ul>
      )}
      {active && (
        <div className="scenes__details" aria-label={`Details of ${active.name}`} role="group">
          <TextField
            label="Name"
            value={active.name}
            onCommit={(name) => editor.updateSceneDetails(active.id, { name })}
          />
          <DescriptionField
            value={active.description}
            onCommit={(description) => {
              editor.updateSceneDetails(active.id, { description });
            }}
          />
          <CheckField
            label="Include in animation"
            value={active.includeInAnimation}
            onChange={(includeInAnimation) => {
              editor.updateSceneDetails(active.id, { includeInAnimation });
            }}
          />
          <fieldset className="scenes__saves">
            <legend>Properties to save</legend>
            {SAVE_FLAGS.map(({ key, label }) => (
              <CheckField
                key={key}
                label={label}
                value={active.saves[key]}
                onChange={(checked) => {
                  editor.setSceneSaves(active.id, { [key]: checked });
                }}
              />
            ))}
          </fieldset>
        </div>
      )}
      <div className="scenes__animation" role="group" aria-label="Animation">
        <div className="field">
          <span className="field__label" aria-hidden="true">
            Transition (s)
          </span>
          <CommitInput
            label="Scene transition in seconds"
            value={String(transition)}
            onCommit={(text) =>
              seconds(text, (transitionSeconds) => {
                editor.setSceneTiming({ transitionSeconds });
              })
            }
          />
        </div>
        <div className="field">
          <span className="field__label" aria-hidden="true">
            Delay (s)
          </span>
          <CommitInput
            label="Scene delay in seconds"
            value={String(delay)}
            onCommit={(text) =>
              seconds(text, (delaySeconds) => {
                editor.setSceneTiming({ delaySeconds });
              })
            }
          />
        </div>
        <button
          type="button"
          className="button button--small"
          aria-pressed={playing}
          disabled={!playing && !scenes.some((scene) => scene.includeInAnimation)}
          onClick={() => {
            if (playing) editor.stopAnimation();
            else editor.playAnimation();
          }}
        >
          {playing ? 'Stop Animation' : 'Play Animation'}
        </button>
      </div>
    </Panel>
  );
}
