import { useMemo } from 'react';
import { listComponentDefinitions } from '../../app/components/componentList';
import { PLACE_COMPONENT_TOOL_ID } from '../../app/tools/ComponentPlacementTool';
import { useEditor, useEditorState } from '../EditorContext';
import { CommitInput } from './fields';
import { Panel } from './Panel';

/** Component definitions in the model: place, select instances, rename, purge unused. */
export function ComponentsPanel() {
  const editor = useEditor();
  const revision = useEditorState((state) => state.revision);
  const activeToolId = useEditorState((state) => state.activeToolId);
  const components = useMemo(
    () => listComponentDefinitions(editor.session.doc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, revision],
  );
  const placing = activeToolId === PLACE_COMPONENT_TOOL_ID ? editor.placementDefinition : null;

  return (
    <Panel id="components" title="Components">
      <div className="panel__toolbar">
        <span className="panel__caption">In Model</span>
        <button
          type="button"
          className="button button--small"
          disabled={!components.some((component) => component.instanceCount === 0)}
          onClick={() => {
            editor.purgeUnusedComponents();
          }}
        >
          Purge Unused
        </button>
      </div>
      {components.length === 0 ? (
        <p className="panel__empty">No components yet. Select geometry and choose Make Component.</p>
      ) : (
        <ul className="item-list" aria-label="Components in the model">
          {components.map((component) => (
            <li className="item-list__item" key={component.id}>
              <CommitInput
                className="item-list__name"
                label={`Name of ${component.name}`}
                value={component.name}
                onCommit={(name) => editor.renameDefinition(component.id, name)}
              />
              <span
                className="item-list__count"
                title="Instances in the model"
                aria-label={`${String(component.instanceCount)} ${component.instanceCount === 1 ? 'instance' : 'instances'}`}
              >
                {component.instanceCount}
              </span>
              <button
                type="button"
                className="button button--small"
                aria-label={`Place ${component.name}`}
                aria-pressed={placing === component.id}
                onClick={() => {
                  editor.placeComponent(component.id);
                }}
              >
                Place
              </button>
              <button
                type="button"
                className="button button--small"
                aria-label={`Select instances of ${component.name}`}
                onClick={() => {
                  editor.selectInstancesOf(component.id);
                }}
              >
                Select
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
