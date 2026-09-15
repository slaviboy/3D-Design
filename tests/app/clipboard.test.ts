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

import { describe, expect, it } from 'vitest';
import { describeClipboard } from '../../src/app/clipboard/clipboard';
import { Selection, type EntityRef } from '../../src/app/selection/Selection';
import { PASTE_TOOL_ID } from '../../src/app/tools/PasteTool';
import { SELECT_TOOL_ID } from '../../src/app/tools/Tool';
import type { FaceId, InstanceId } from '../../src/kernel/ids';
import { validateDocument } from '../../src/kernel/model/validate';
import { makeGroup } from '../../src/kernel/ops/hierarchy';
import { draw, rectangle } from '../kernel/helpers';
import { click, createTestEditor, pointer, screenOf, TOP_CAMERA } from './fixtures';

/** An editor holding one 4 x 4 m rectangle, seen from above. */
function editorWithRectangle() {
  const editor = createTestEditor();
  editor.session.setCamera(TOP_CAMERA);
  const doc = editor.session.doc;
  draw(doc, rectangle(-2, -2, 2, 2));
  const faceId = [...doc.rootStore.faces()][0]?.id ?? (0 as FaceId);
  return { editor, doc, faceId };
}

/** The same rectangle, made into a group. */
function editorWithGroup() {
  const { editor, doc } = editorWithRectangle();
  const store = doc.rootStore;
  const made = doc.transact('Group', () =>
    makeGroup(doc, doc.rootDefinitionId, {
      faces: [...store.faces()].map((face) => face.id),
      edges: [...store.edges()].map((edge) => edge.id),
    }),
  );
  return { editor, doc, instanceId: made.instance };
}

const instanceRef = (id: InstanceId): EntityRef => ({ kind: 'instance', id });

describe('clipboard', () => {
  it('copies a group and pastes a second one where the next click lands', () => {
    const { editor, doc, instanceId } = editorWithGroup();
    editor.session.setSelection(Selection.of([instanceRef(instanceId)]));

    expect(editor.copySelection()).toBe(true);
    expect(editor.canPaste()).toBe(true);
    editor.pasteFromClipboard();
    expect(editor.tools.activeToolId).toBe(PASTE_TOOL_ID);

    const drop = screenOf(4, 0);
    editor.tools.pointerMove(pointer(drop.x, drop.y));
    click(editor, drop.x, drop.y);

    expect(doc.rootStore.instanceCount).toBe(2);
    expect(editor.tools.activeToolId).toBe(SELECT_TOOL_ID);
    expect(editor.session.selection.size).toBe(1);
    expect(validateDocument(doc).ok).toBe(true);
    // The original group is untouched and the pasted one sits where it was dropped.
    const definitions = [...doc.rootStore.instances()].map((instance) => instance.definitionId);
    expect(new Set(definitions).size).toBe(1);
  });

  it('cuts the selection, removing it until it is pasted again', () => {
    const { editor, doc, instanceId } = editorWithGroup();
    editor.session.setSelection(Selection.of([instanceRef(instanceId)]));

    editor.cutSelection();
    expect(doc.rootStore.instanceCount).toBe(0);
    expect(editor.canPaste()).toBe(true);

    editor.pasteInPlace();
    expect(doc.rootStore.instanceCount).toBe(1);
    expect(editor.session.selection.size).toBe(1);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('pastes into the group that is open, not the model root', () => {
    const { editor, doc, instanceId } = editorWithGroup();
    // A second rectangle, well clear of the group's own geometry.
    draw(doc, rectangle(6, 6, 8, 8));
    const looseFace = [...doc.rootStore.faces()][0]?.id ?? (0 as FaceId);
    editor.session.setSelection(Selection.of([{ kind: 'face', id: looseFace }]));
    expect(editor.copySelection()).toBe(true);

    editor.openGroup(instanceId);
    const inside = editor.session.activeContext;
    const before = [...doc.store(inside).faces()].length;
    editor.pasteInPlace();

    expect([...doc.store(inside).faces()].length).toBe(before + 1);
    expect([...doc.rootStore.faces()].length).toBe(1);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('disables Paste while the copied group is open, since it cannot contain itself', () => {
    const { editor, instanceId } = editorWithGroup();
    editor.session.setSelection(Selection.of([instanceRef(instanceId)]));
    editor.copySelection();
    expect(editor.canPaste()).toBe(true);

    editor.openGroup(instanceId);
    expect(editor.canPaste()).toBe(false);
    editor.closeGroup();
    expect(editor.canPaste()).toBe(true);
  });

  it('refuses to cut a locked group and keeps the clipboard as it was', () => {
    const { editor, doc, instanceId } = editorWithGroup();
    editor.session.setSelection(Selection.of([instanceRef(instanceId)]));
    editor.updateSelectionAttributes({ locked: true });

    editor.cutSelection();
    expect(doc.rootStore.instanceCount).toBe(1);
    expect(editor.clipboard).toBeNull();
    expect(editor.notifications.at(-1)?.kind).toBe('error');
  });

  it('has nothing to copy or paste without a selection', () => {
    const { editor } = editorWithRectangle();
    expect(editor.copySelection()).toBe(false);
    expect(editor.canPaste()).toBe(false);
    editor.pasteFromClipboard();
    expect(editor.tools.activeToolId).toBe(SELECT_TOOL_ID);
  });

  it('describes what it holds', () => {
    expect(describeClipboard({ faces: 1, edges: 4, instances: 0 })).toBe('1 face, 4 edges');
    expect(describeClipboard({ faces: 0, edges: 0, instances: 2 })).toBe('2 groups and components');
  });
});
