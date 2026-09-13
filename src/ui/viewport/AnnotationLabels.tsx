import { useEditor, useEditorState } from '../EditorContext';

/** Dimension and text labels drawn over the 3D view. Clicking one edits its text. */
export function AnnotationLabels() {
  const editor = useEditor();
  const labels = useEditorState((state) => state.annotationLabels);
  return (
    <>
      {labels.map((label) => (
        <button
          key={label.key}
          type="button"
          className={`annotation-label annotation-label--${label.kind}`}
          style={{ left: label.x, top: label.y }}
          data-testid="annotation-label"
          title="Edit text"
          onPointerDown={(event) => {
            // Keep the click on the label from reaching the viewport's tools.
            event.stopPropagation();
          }}
          onClick={() => {
            editor.editAnnotation(label.context, label.id);
          }}
        >
          {label.text}
        </button>
      ))}
    </>
  );
}
