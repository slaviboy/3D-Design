import { instructorHint } from '../../app/instructor/instructor';
import { useEditor, useEditorState } from '../EditorContext';
import { Panel } from './Panel';

/** Help for the active tool: what it does, how to use it, its modifier keys and what it accepts when typing. */
export function InstructorPanel() {
  const editor = useEditor();
  const activeToolId = useEditorState((state) => state.activeToolId);
  const hint = instructorHint(activeToolId, editor.platform);
  return (
    <Panel id="instructor" title="Instructor">
      {hint ? (
        <div className="instructor" data-tool={activeToolId}>
          <h3 className="instructor__title">{hint.title}</h3>
          <p className="instructor__purpose">{hint.purpose}</p>
          <h4 className="instructor__heading">Steps</h4>
          <ol className="instructor__steps">
            {hint.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {hint.keys.length > 0 && (
            <>
              <h4 className="instructor__heading">Keys</h4>
              <dl className="instructor__keys">
                {hint.keys.map((key) => (
                  <div className="instructor__key" key={key.keys}>
                    <dt>
                      <kbd>{key.keys}</kbd>
                    </dt>
                    <dd>{key.effect}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <h4 className="instructor__heading">Measurements box</h4>
          <p className="instructor__measurements">
            {hint.measurements ?? 'This tool does not use the measurements box.'}
          </p>
        </div>
      ) : (
        <p className="panel__empty">There is no help for this tool yet.</p>
      )}
    </Panel>
  );
}
