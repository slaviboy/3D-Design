import { useEditor, useEditorState } from '../EditorContext';

/** The measurements box: shows the active tool's current value and takes typed values. */
function MeasurementsBox() {
  const editor = useEditor();
  const label = useEditorState((state) => state.measurementLabel);
  const value = useEditorState((state) => state.measurementValue);
  const text = useEditorState((state) => state.measurementText);
  if (label === null) return null;
  return (
    <label className="measurements">
      <span className="measurements__label">{label}</span>
      <input
        className="measurements__input"
        data-testid="measurements"
        aria-label={`Measurements: ${label}`}
        spellCheck={false}
        autoComplete="off"
        value={text !== '' ? text : value}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        onChange={(event) => {
          editor.setMeasurementText(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            editor.submitMeasurement();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            editor.setMeasurementText('');
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export function StatusBar() {
  const hint = useEditorState((state) => state.statusHint);
  const selectionTotal = useEditorState((state) => state.selectionTotal);
  const documentName = useEditorState((state) => state.documentName);
  const isDirty = useEditorState((state) => state.isDirty);
  const editDepth = useEditorState((state) => state.editDepth);
  return (
    <footer className="statusbar">
      <span className="statusbar__hint" aria-live="polite">
        {hint}
      </span>
      <MeasurementsBox />
      {editDepth > 0 && (
        <span className="statusbar__context" data-testid="edit-context">
          Editing group
        </span>
      )}
      <span className="statusbar__selection" data-testid="selection-count">
        {selectionTotal === 0 ? 'Nothing selected' : `${String(selectionTotal)} selected`}
      </span>
      <span className="statusbar__document">
        {documentName}
        {isDirty ? ' (unsaved changes)' : ''}
      </span>
    </footer>
  );
}
