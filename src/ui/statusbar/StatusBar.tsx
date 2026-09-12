import { useEditorState } from '../EditorContext';

export function StatusBar() {
  const hint = useEditorState((state) => state.statusHint);
  const selectionTotal = useEditorState((state) => state.selectionTotal);
  const documentName = useEditorState((state) => state.documentName);
  const isDirty = useEditorState((state) => state.isDirty);
  return (
    <footer className="statusbar">
      <span className="statusbar__hint" aria-live="polite">
        {hint}
      </span>
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
