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

import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { Editor } from '../app/Editor';
import type { EditorStore, EditorViewState } from '../app/stores/editorStore';

interface EditorContextValue {
  readonly editor: Editor;
  readonly store: EditorStore;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({ editor, store, children }: EditorContextValue & { children: ReactNode }) {
  return <EditorContext.Provider value={{ editor, store }}>{children}</EditorContext.Provider>;
}

function useEditorContext(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error('Editor components must be rendered inside <EditorProvider>');
  return value;
}

export function useEditor(): Editor {
  return useEditorContext().editor;
}

/** Subscribes to one slice of editor state; the component re-renders only when that slice changes. */
export function useEditorState<T>(selector: (state: EditorViewState) => T): T {
  return useStore(useEditorContext().store, selector);
}
