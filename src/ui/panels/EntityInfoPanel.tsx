import { useMemo } from 'react';
import { describeSelection } from '../../app/selection/entityInfo';
import { useEditor, useEditorState } from '../EditorContext';

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

  return (
    <section className="panel" aria-labelledby="entity-info-title">
      <h2 className="panel__title" id="entity-info-title">
        Entity Info
      </h2>
      <div className="panel__body">
        <p className="entity-info__heading" data-testid="entity-info-heading">
          {info.title}
        </p>
        <dl className="entity-info__rows">
          {info.rows.map((row) => (
            <div className="entity-info__row" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
