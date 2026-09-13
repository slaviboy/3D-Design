import { useId, useMemo } from 'react';
import { hexToRgb, listTags, rgbToHex, UNTAGGED_LABEL } from '../../app/tags/tags';
import { useEditor, useEditorState } from '../EditorContext';
import { ColorInput, CommitInput } from './fields';
import { Panel } from './Panel';

/** Tags: add, rename, recolor, show or hide, choose the active tag, assign the selection, delete, purge. */
export function TagsPanel() {
  const editor = useEditor();
  const revision = useEditorState((state) => state.revision);
  const activeTagId = useEditorState((state) => state.activeTagId);
  const selectionTotal = useEditorState((state) => state.selectionTotal);
  const tags = useMemo(
    () => listTags(editor.session.doc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, revision],
  );
  const radioGroup = useId();
  const hasSelection = selectionTotal > 0;

  return (
    <Panel id="tags" title="Tags">
      <div className="panel__toolbar">
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            editor.addTag();
          }}
        >
          Add Tag
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!tags.some((tag) => tag.usage === 0)}
          onClick={() => {
            editor.purgeUnusedTags();
          }}
        >
          Purge Unused
        </button>
      </div>
      <ul className="item-list" aria-label="Tags in the model">
        <li className="item-list__item tag-row">
          <input
            type="radio"
            name={radioGroup}
            aria-label={`Make ${UNTAGGED_LABEL} active`}
            checked={activeTagId === null}
            onChange={() => {
              editor.setActiveTag(null);
            }}
          />
          <span className="tag-row__spacer" aria-hidden="true" />
          <span className="tag-row__spacer" aria-hidden="true" />
          <span className="item-list__name item-list__name--static">{UNTAGGED_LABEL}</span>
          <button
            type="button"
            className="button button--small"
            aria-label={`Assign selection to ${UNTAGGED_LABEL}`}
            disabled={!hasSelection}
            onClick={() => {
              editor.assignSelectionToTag(null);
            }}
          >
            Assign
          </button>
          <span className="tag-row__spacer tag-row__spacer--wide" aria-hidden="true" />
        </li>
        {tags.map((tag) => (
          <li className={`item-list__item tag-row${tag.visible ? '' : ' tag-row--hidden'}`} key={tag.id}>
            <input
              type="radio"
              name={radioGroup}
              aria-label={`Make ${tag.name} active`}
              checked={activeTagId === tag.id}
              onChange={() => {
                editor.setActiveTag(tag.id);
              }}
            />
            <input
              type="checkbox"
              aria-label={`Show ${tag.name}`}
              title={tag.visible ? 'Visible' : 'Hidden'}
              checked={tag.visible}
              onChange={(event) => {
                editor.setTagVisible(tag.id, event.target.checked);
              }}
            />
            <ColorInput
              label={`Color of ${tag.name}`}
              value={rgbToHex(tag.color)}
              onCommit={(hex) => {
                const color = hexToRgb(hex);
                if (color) editor.setTagColor(tag.id, color);
              }}
            />
            <CommitInput
              className="item-list__name"
              label={`Name of ${tag.name}`}
              value={tag.name}
              onCommit={(name) => editor.renameTag(tag.id, name)}
            />
            <button
              type="button"
              className="button button--small"
              aria-label={`Assign selection to ${tag.name}`}
              disabled={!hasSelection}
              onClick={() => {
                editor.assignSelectionToTag(tag.id);
              }}
            >
              Assign
            </button>
            <button
              type="button"
              className="button button--small"
              aria-label={`Delete ${tag.name}`}
              title={tag.usage > 0 ? 'Delete; what uses it becomes untagged' : 'Delete'}
              onClick={() => {
                editor.deleteTag(tag.id);
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
