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

import { useEffect, useState } from 'react';
import { describeDroppableFiles } from '../../app/io/dropFiles';
import type { InputFile } from '../../io/import/fileSet';
import { useEditor } from '../EditorContext';

/** True while files are being dragged over the window, so the overlay can invite the drop. */
function useDraggedFiles(): boolean {
  const editor = useEditor();
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const carriesFiles = (event: DragEvent): boolean =>
      [...(event.dataTransfer?.types ?? [])].includes('Files');
    // Drag events fire for every element entered, so the overlay follows a counter rather than the last event.
    let depth = 0;
    const onEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      // Without this the browser opens the file itself and the model is lost.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const list = [...(event.dataTransfer?.files ?? [])];
      if (list.length === 0) return;
      void Promise.all(
        list.map(async (file): Promise<InputFile> => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      ).then(
        (files) => editor.openDroppedFiles(files),
        (error: unknown) => {
          editor.notify('error', `Could not read the dropped files: ${String(error)}`);
        },
      );
    };
    const endDrag = (): void => {
      depth = 0;
      setDragging(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', endDrag);
    window.addEventListener('blur', endDrag);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', endDrag);
      window.removeEventListener('blur', endDrag);
    };
  }, [editor]);

  return dragging;
}

/** Accepts files dropped anywhere on the window, and shows what a drop would do while one is in flight. */
export function FileDrop() {
  const dragging = useDraggedFiles();
  if (!dragging) return null;
  return (
    <div className="file-drop" data-testid="file-drop" role="status">
      <div className="file-drop__card">
        <p className="file-drop__title">Drop to open</p>
        <p className="file-drop__detail">
          Drop {describeDroppableFiles()}. A project replaces the open model; a model is imported into it.
        </p>
      </div>
    </div>
  );
}
