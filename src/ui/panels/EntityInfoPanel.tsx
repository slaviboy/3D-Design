import { useMemo } from 'react';
import { describeSelection } from '../../app/selection/entityInfo';
import { listTags, UNTAGGED_LABEL } from '../../app/tags/tags';
import type { InstanceId, TagId } from '../../kernel/ids';
import { useEditor, useEditorState } from '../EditorContext';
import { CheckField, TextField } from './fields';
import { MaterialField, TexturePlacementFields } from './materialFields';
import { Panel } from './Panel';

const UNTAGGED_VALUE = 'untagged';
const MIXED_VALUE = 'mixed';

export function EntityInfoPanel() {
  const editor = useEditor();
  const revision = useEditorState((state) => state.revision);
  const selectionVersion = useEditorState((state) => state.selectionVersion);
  const info = useMemo(() => {
    const { session } = editor;
    return describeSelection(session.doc, session.activeContext, session.selection, editor.units);
    // revision and selectionVersion are the change signals for the mutable session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, revision, selectionVersion]);
  const tags = useMemo(
    () => listTags(editor.session.doc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, revision],
  );
  const { fields } = info;
  const [selectedInstance] = editor.session.selection.ids('instance');

  return (
    <Panel id="entityInfo" title="Entity Info">
      <p className="entity-info__heading" data-testid="entity-info-heading">
        {info.title}
      </p>
      <div className="entity-info__fields">
        {fields.section && (
          <>
            <TextField
              label="Section plane name"
              value={fields.section.name}
              onCommit={(name) =>
                fields.section ? editor.renameSectionPlane(fields.section.id, name) : false
              }
            />
            <CheckField
              label="Active cut"
              value={fields.section.active}
              onChange={() => {
                if (fields.section) editor.toggleSectionPlaneActive(fields.section.id);
              }}
            />
          </>
        )}
        {fields.name !== undefined && selectedInstance !== undefined && (
          <TextField
            label="Instance name"
            value={fields.name}
            onCommit={(name) => {
              editor.updateInstanceAt(editor.session.editPath, selectedInstance as InstanceId, { name });
            }}
          />
        )}
        {fields.definition && (
          <TextField
            label="Definition name"
            value={fields.definition.name}
            onCommit={(name) =>
              fields.definition ? editor.renameDefinition(fields.definition.id, name) : false
            }
          />
        )}
        {fields.tag !== undefined && (
          <label className="field">
            <span className="field__label">Tag</span>
            <select
              className="field__control"
              value={
                fields.tag === MIXED_VALUE
                  ? MIXED_VALUE
                  : fields.tag === null
                    ? UNTAGGED_VALUE
                    : String(fields.tag)
              }
              onChange={(event) => {
                const { value } = event.target;
                if (value === MIXED_VALUE) return;
                editor.assignSelectionToTag(value === UNTAGGED_VALUE ? null : (Number(value) as TagId));
              }}
            >
              {fields.tag === MIXED_VALUE && (
                <option value={MIXED_VALUE} disabled>
                  Mixed
                </option>
              )}
              <option value={UNTAGGED_VALUE}>{UNTAGGED_LABEL}</option>
              {tags.map((tag) => (
                <option key={tag.id} value={String(tag.id)}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {fields.hidden !== undefined && (
          <CheckField
            label="Hidden"
            value={fields.hidden}
            onChange={(hidden) => {
              editor.updateSelectionAttributes({ hidden });
            }}
          />
        )}
        {fields.locked !== undefined && (
          <CheckField
            label="Locked"
            value={fields.locked}
            onChange={(locked) => {
              editor.updateSelectionAttributes({ locked });
            }}
          />
        )}
        {fields.soft !== undefined && (
          <CheckField
            label="Soft"
            value={fields.soft}
            onChange={(soft) => {
              editor.updateSelectionAttributes({ soft });
            }}
          />
        )}
        {fields.smooth !== undefined && (
          <CheckField
            label="Smooth"
            value={fields.smooth}
            onChange={(smooth) => {
              editor.updateSelectionAttributes({ smooth });
            }}
          />
        )}
        {fields.frontMaterial !== undefined && (
          <MaterialField
            label="Front material"
            value={fields.frontMaterial}
            onUseActive={() => {
              editor.setSelectionMaterial('front', editor.activeMaterialId);
            }}
          />
        )}
        {fields.backMaterial !== undefined && (
          <MaterialField
            label="Back material"
            value={fields.backMaterial}
            onUseActive={() => {
              editor.setSelectionMaterial('back', editor.activeMaterialId);
            }}
          />
        )}
        {fields.instanceMaterial !== undefined && (
          <MaterialField
            label="Material"
            value={fields.instanceMaterial}
            onUseActive={() => {
              editor.setSelectionMaterial('instance', editor.activeMaterialId);
            }}
          />
        )}
        {fields.texturePlacement?.front !== undefined && (
          <TexturePlacementFields
            faceId={fields.texturePlacement.faceId}
            side="front"
            placement={fields.texturePlacement.front}
          />
        )}
        {fields.texturePlacement?.back !== undefined && (
          <TexturePlacementFields
            faceId={fields.texturePlacement.faceId}
            side="back"
            placement={fields.texturePlacement.back}
          />
        )}
      </div>
      <dl className="entity-info__rows">
        {info.rows.map((row) => (
          <div className="entity-info__row" key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
