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
        // The on-screen keyboard's return key enters the value.
        enterKeyHint="done"
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
