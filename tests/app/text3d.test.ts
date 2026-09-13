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
import { transformDirection, transformPoint } from '../../src/kernel/math/mat4';
import { vec3 } from '../../src/kernel/math/vec3';
import { hashDocument } from '../../src/kernel/model/snapshot';
import { insertSegments } from '../../src/kernel/ops/insertSegments';
import { IMPERIAL_UNIT_SETTINGS, METRIC_UNIT_SETTINGS } from '../../src/kernel/units/units';
import { createEditorStore } from '../../src/app/stores/editorStore';
import { defaultText3DForm, parseText3DForm, type Text3DForm } from '../../src/app/text3d/text3dForm';
import { TEXT_3D_TOOL_ID } from '../../src/app/tools/Text3DTool';
import { SELECT_TOOL_ID } from '../../src/app/tools/Tool';
import { MENUS } from '../../src/ui/menubar/MenuBar';
import { click, createTestEditor, pointer, screenOf } from './fixtures';

const form = (patch: Partial<Text3DForm> = {}): Text3DForm => ({
  ...defaultText3DForm(METRIC_UNIT_SETTINGS),
  text: 'Planar 3D',
  ...patch,
});

describe('3D Text command and dialog request', () => {
  it('is in the Tools menu and found by its aliases', () => {
    const editor = createTestEditor();
    const command = editor.commands.get('tools.text3d');
    expect(command?.label).toBe('3D Text…');
    expect(command?.aliases).toEqual(expect.arrayContaining(['text', 'letters', 'extruded text', 'sign']));
    expect(MENUS.find((menu) => menu.label === 'Tools')?.items).toContain('tools.text3d');
  });

  it('asks the UI for the 3D Text dialog', async () => {
    const editor = createTestEditor();
    const store = createEditorStore(editor);
    expect(store.getState().text3dDialogRequests).toBe(0);
    await editor.runCommand('tools.text3d');
    expect(store.getState().text3dDialogRequests).toBe(1);
    expect(store.getState().commandPaletteRequests).toBe(0);
    store.dispose();
  });
});

describe('3D Text form', () => {
  it('reads lengths in the unit settings', () => {
    expect(defaultText3DForm(METRIC_UNIT_SETTINGS).height).toBe('500mm');
    const metric = parseText3DForm(form({ height: '2000', depth: '10cm' }), METRIC_UNIT_SETTINGS);
    expect(metric.ok && metric.value.height).toBeCloseTo(2);
    expect(metric.ok && metric.value.depth).toBeCloseTo(0.1);
    const imperial = parseText3DForm(form({ height: '6"', depth: "1'" }), IMPERIAL_UNIT_SETTINGS);
    expect(imperial.ok && imperial.value.height).toBeCloseTo(0.1524);
    expect(imperial.ok && imperial.value.depth).toBeCloseTo(0.3048);
  });

  it('ignores the depth for flat or outline text', () => {
    const flat = parseText3DForm(form({ extruded: false, depth: 'nonsense' }), METRIC_UNIT_SETTINGS);
    expect(flat.ok && flat.value.depth).toBe(0);
    const outline = parseText3DForm(form({ filled: false, depth: 'nonsense' }), METRIC_UNIT_SETTINGS);
    expect(outline.ok && outline.value).toMatchObject({ filled: false, depth: 0 });
  });

  it('explains unusable values', () => {
    const error = (patch: Partial<Text3DForm>) => {
      const result = parseText3DForm(form(patch), METRIC_UNIT_SETTINGS);
      return result.ok ? null : result.error;
    };
    expect(error({ text: '  ' })).toMatch(/Type the text/);
    expect(error({ height: 'tall' })).toMatch(/^Height:/);
    expect(error({ height: '0.1mm' })).toMatch(/at least 1mm/);
    expect(error({ depth: '0' })).toMatch(/more than zero/);
    expect(error({ depth: 'deep' })).toMatch(/^Extrusion:/);
  });

  it('keeps the dialog open with a message, or starts placing and remembers the values', () => {
    const editor = createTestEditor();
    expect(editor.submitText3DForm(form({ height: '' }))).toMatch(/Height/);
    expect(editor.tools.activeToolId).toBe(SELECT_TOOL_ID);
    expect(editor.text3DForm).toBeNull();

    const values = form({ align: 'center' });
    expect(editor.submitText3DForm(values)).toBeNull();
    expect(editor.tools.activeToolId).toBe(TEXT_3D_TOOL_ID);
    expect(editor.text3DForm).toEqual(values);
    expect(editor.tools.statusHint).toMatch(/Click a face or the ground/);
  });
});

describe('3D Text placement tool', () => {
  it('follows the cursor with a preview, places the text with a click and undoes in one step', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    const before = hashDocument(doc);
    editor.submitText3DForm(form({ text: 'Hi', height: '1000mm', depth: '200mm' }));

    const target = screenOf(1, 2);
    editor.tools.pointerMove(pointer(target.x, target.y, { buttons: 0 }));
    const preview = editor.session.preview;
    expect(preview?.lines.length).toBeGreaterThan(0);
    const zs = preview?.lines.flatMap((line) => [line.a.z, line.b.z]) ?? [];
    expect(Math.max(...zs)).toBeCloseTo(0.2);

    click(editor, target.x, target.y);
    const instances = [...doc.rootStore.instances()];
    expect(instances).toHaveLength(1);
    const [instance] = instances;
    if (!instance) throw new Error('no instance');
    const origin = transformPoint(instance.transform, vec3(0, 0, 0));
    expect(origin.x).toBeCloseTo(1);
    expect(origin.y).toBeCloseTo(2);
    expect(origin.z).toBeCloseTo(0);
    expect(doc.getDefinition(instance.definitionId).store.faceCount).toBeGreaterThan(0);
    expect(doc.getDefinition(instance.definitionId).attributes.isGroup).toBe(true);
    expect(editor.session.selection.ids('instance')).toEqual([instance.id]);
    expect(editor.tools.activeToolId).toBe(SELECT_TOOL_ID);
    expect(doc.undoLabel).toBe('Place 3D Text');

    editor.undo();
    expect(hashDocument(doc)).toBe(before);
  });

  it('sets the text on the face under the cursor, facing the camera', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    doc.transact('Draw', () =>
      insertSegments(
        doc,
        doc.rootDefinitionId,
        [
          { a: vec3(-3, -3, 1), b: vec3(3, -3, 1) },
          { a: vec3(3, -3, 1), b: vec3(3, 3, 1) },
          { a: vec3(3, 3, 1), b: vec3(-3, 3, 1) },
          { a: vec3(-3, 3, 1), b: vec3(-3, -3, 1) },
        ],
        { autoFace: true, orientationHint: vec3(0, 0, -1) },
      ),
    );
    expect(doc.rootStore.faceCount).toBe(1);
    editor.submitText3DForm(form({ text: 'Top', component: true }));
    const target = screenOf(0.5, -0.5);
    editor.tools.pointerMove(pointer(target.x, target.y, { buttons: 0 }));
    click(editor, target.x, target.y);

    const [instance] = [...doc.rootStore.instances()];
    if (!instance) throw new Error('no instance');
    const origin = transformPoint(instance.transform, vec3(0, 0, 0));
    expect(origin.z).toBeCloseTo(1);
    expect(transformDirection(instance.transform, vec3(0, 0, 1)).z).toBeCloseTo(1);
    expect(transformDirection(instance.transform, vec3(1, 0, 0)).x).toBeCloseTo(1);
    expect(doc.getDefinition(instance.definitionId).attributes.isGroup).toBe(false);
  });

  it('cancels with Escape without changing the model', () => {
    const editor = createTestEditor();
    const before = hashDocument(editor.session.doc);
    editor.submitText3DForm(form());
    editor.tools.pointerMove(pointer(120, 80, { buttons: 0 }));
    expect(editor.tools.keyDown('Escape')).toBe(true);
    expect(editor.tools.activeToolId).toBe(SELECT_TOOL_ID);
    expect(hashDocument(editor.session.doc)).toBe(before);

    // Without text to place, a click only reports how to get some.
    editor.activateTool(TEXT_3D_TOOL_ID);
    click(editor, 100, 100);
    expect(editor.session.doc.rootStore.instanceCount).toBe(0);
    expect(editor.notifications.at(-1)?.message).toMatch(/3D Text/);
  });
});
