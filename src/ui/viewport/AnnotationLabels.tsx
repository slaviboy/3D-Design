/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
