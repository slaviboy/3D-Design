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
import type { Editor } from '../../src/app/Editor';
import { listComponentDefinitions } from '../../src/app/components/componentList';
import { buildOutlinerTree, flattenOutliner } from '../../src/app/outliner/outlinerTree';
import { describeSelection } from '../../src/app/selection/entityInfo';
import { LOCKED_MESSAGE } from '../../src/app/selection/locking';
import { Selection } from '../../src/app/selection/Selection';
import { createEditorStore } from '../../src/app/stores/editorStore';
import { hexToRgb, listTags, rgbToHex } from '../../src/app/tags/tags';
import { PLACE_COMPONENT_TOOL_ID } from '../../src/app/tools/ComponentPlacementTool';
import { CIRCLE_TOOL_ID, ERASER_TOOL_ID, MOVE_TOOL_ID, SELECT_TOOL_ID } from '../../src/app/tools/Tool';
import { inferAt } from '../../src/app/tools/toolSupport';
import type { InstanceId } from '../../src/kernel/ids';
import { transformPoint } from '../../src/kernel/math/mat4';
import { ZERO } from '../../src/kernel/math/vec3';
import { setInstanceAttributes } from '../../src/kernel/model/mutations';
import { hashDocument } from '../../src/kernel/model/snapshot';
import { validateDocument } from '../../src/kernel/model/validate';
import { makeComponent, makeGroup } from '../../src/kernel/ops/hierarchy';
import { METRIC_UNIT_SETTINGS } from '../../src/kernel/units/units';
import { draw, faceIds, rectangle } from '../kernel/helpers';
import { click, createTestEditor, pointer, screenOf } from './fixtures';

const key = (value: string) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
});

/** A 2×2 m square face grouped at (1, 1)–(3, 3), with the group selected. */
function editorWithGroup() {
  const editor = createTestEditor();
  const doc = editor.session.doc;
  draw(doc, rectangle(1, 1, 3, 3));
  editor.selectAll();
  editor.groupSelection('group');
  const [id] = editor.session.selection.ids('instance');
  if (id === undefined) throw new Error('expected a group');
  return { editor, doc, instance: id as InstanceId };
}

function lastNotification(editor: Editor): string | undefined {
  return editor.notifications.at(-1)?.message;
}

function clickAt(editor: Editor, x: number, y: number, detail = 1): void {
  const screen = screenOf(x, y);
  click(editor, screen.x, screen.y, { detail });
}

describe('tag visibility', () => {
  it('hidden tags are not picked, box selected, selected by Select All, or used for inference', () => {
    const { editor, doc, instance } = editorWithGroup();
    const inside = screenOf(2, 2);
    expect(editor.pickAt(inside)?.ref).toEqual({ kind: 'instance', id: instance });
    expect(inferAt(editor, screenOf(1, 1)).kind).toBe('endpoint');

    const tag = editor.addTag('Furniture');
    editor.assignSelectionToTag(tag);
    expect(doc.rootStore.getInstance(instance).attributes.tagId).toBe(tag);
    editor.setTagVisible(tag, false);

    // Hiding the tag deselects the group, and nothing brings it back.
    expect(editor.session.selection.isEmpty).toBe(true);
    expect(editor.pickAt(inside)).toBeNull();
    clickAt(editor, 2, 2);
    expect(editor.session.selection.isEmpty).toBe(true);
    expect(editor.boxSelectRefs({ minX: 0, minY: 0, maxX: 200, maxY: 200 }, 'window')).toEqual([]);
    editor.selectAll();
    expect(editor.session.selection.isEmpty).toBe(true);
    expect(inferAt(editor, screenOf(1, 1)).kind).not.toBe('endpoint');

    editor.undo();
    expect(editor.pickAt(inside)?.ref).toEqual({ kind: 'instance', id: instance });
    expect(inferAt(editor, screenOf(1, 1)).kind).toBe('endpoint');
  });

  it('a hidden tag on the group hides everything nested inside it', () => {
    const { editor, doc, instance } = editorWithGroup();
    editor.groupSelection('group');
    const [outer] = editor.session.selection.ids('instance');
    const tag = editor.addTag();
    editor.assignSelectionToTag(tag);
    editor.setTagVisible(tag, false);
    expect(editor.pickAt(screenOf(2, 2))).toBeNull();
    expect(doc.rootStore.instance(instance)).toBeUndefined();
    expect(outer).toBeDefined();
  });

  it('faces and edges on hidden tags are skipped while the rest stays pickable', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(-2, -2, 2, 2));
    const tag = editor.addTag();
    const [face] = faceIds(doc.rootStore);
    if (face === undefined) throw new Error('expected a face');
    editor.session.setSelection(Selection.of([{ kind: 'face', id: face }]));
    editor.assignSelectionToTag(tag);
    editor.setTagVisible(tag, false);
    expect(editor.pickAt(screenOf(0, 0))).toBeNull();
    expect(editor.pickAt(screenOf(2, 0))?.ref.kind).toBe('edge');
    const refs = editor.boxSelectRefs({ minX: 0, minY: 0, maxX: 200, maxY: 200 }, 'window');
    expect(refs.map((ref) => ref.kind)).toEqual(['edge', 'edge', 'edge', 'edge']);
  });
});

describe('tags', () => {
  it('adds, renames, recolors, hides, deletes and purges tags as undoable steps', () => {
    const { editor, doc, instance } = editorWithGroup();
    const walls = editor.addTag();
    const spare = editor.addTag();
    expect(listTags(doc).map((tag) => tag.name)).toEqual(['Tag 1', 'Tag 2']);
    expect(doc.undoLabel).toBe('Add Tag');

    expect(editor.renameTag(walls, '  Walls ')).toBe(true);
    expect(doc.tag(walls)?.name).toBe('Walls');
    expect(editor.renameTag(walls, '   ')).toBe(false);
    expect(lastNotification(editor)).toBe('A tag needs a name');

    editor.setTagColor(walls, { r: 0, g: 1, b: 0 });
    expect(doc.tag(walls)?.color).toEqual({ r: 0, g: 1, b: 0 });
    editor.setTagVisible(walls, false);
    expect(doc.undoLabel).toBe('Hide Tag');
    editor.undo();
    expect(doc.tag(walls)?.visible).toBe(true);

    editor.assignSelectionToTag(walls);
    expect(listTags(doc).find((tag) => tag.id === walls)?.usage).toBe(1);
    const tagged = hashDocument(doc);

    editor.setActiveTag(walls);
    expect(editor.session.activeTagId).toBe(walls);
    expect(hashDocument(doc)).toBe(tagged);
    expect(doc.undoLabel).toBe('Assign Tag');

    editor.deleteTag(walls);
    expect(doc.tag(walls)).toBeUndefined();
    expect(doc.rootStore.getInstance(instance).attributes.tagId).toBeNull();
    expect(editor.session.activeTagId).toBeNull();
    editor.undo();
    expect(hashDocument(doc)).toBe(tagged);

    expect(editor.purgeUnusedTags()).toBe(1);
    expect(doc.tag(spare)).toBeUndefined();
    expect(doc.tag(walls)).toBeDefined();
    expect(validateDocument(doc).problems).toEqual([]);
  });

  it('puts new groups and components on the active tag', () => {
    const { editor, doc } = editorWithGroup();
    const tag = editor.addTag();
    editor.setActiveTag(tag);
    editor.groupSelection('component');
    const [component] = editor.session.selection.ids('instance');
    expect(doc.rootStore.getInstance(component as InstanceId).attributes.tagId).toBe(tag);
    expect(doc.undoLabel).toBe('Make Component');
    editor.undo();
    expect(doc.rootStore.instanceCount).toBe(1);
  });

  it('converts colors between linear RGB and sRGB hex', () => {
    expect(rgbToHex({ r: 1, g: 0, b: 0 })).toBe('#ff0000');
    expect(rgbToHex(hexToRgb('#3380cc') ?? { r: 0, g: 0, b: 0 })).toBe('#3380cc');
    expect(hexToRgb('red')).toBeNull();
  });
});

describe('locked groups and components', () => {
  function lockedGroup() {
    const setup = editorWithGroup();
    setup.editor.updateSelectionAttributes({ locked: true });
    expect(setup.doc.undoLabel).toBe('Lock');
    return setup;
  }

  it('refuses delete, explode and open', async () => {
    const { editor, doc, instance } = lockedGroup();
    const before = hashDocument(doc);
    editor.deleteSelection();
    expect(lastNotification(editor)).toBe(LOCKED_MESSAGE);
    editor.explodeSelection();
    await editor.runCommand('edit.delete');
    await editor.runCommand('edit.explode');
    editor.openGroup(instance);
    clickAt(editor, 2, 2, 2);
    expect(editor.session.editPath).toEqual([]);
    expect(hashDocument(doc)).toBe(before);
    expect(editor.notifications.filter((n) => n.message === LOCKED_MESSAGE)).toHaveLength(6);

    await editor.runCommand('edit.unlock');
    editor.session.setSelection(Selection.of([{ kind: 'instance', id: instance }]));
    editor.deleteSelection();
    expect(doc.rootStore.instanceCount).toBe(0);
  });

  it('refuses the Move and Eraser tools', () => {
    const { editor, doc } = lockedGroup();
    const before = hashDocument(doc);
    editor.activateTool(MOVE_TOOL_ID);
    clickAt(editor, 2, 2);
    const to = screenOf(4, 4);
    editor.tools.pointerMove(pointer(to.x, to.y, { buttons: 0 }));
    click(editor, to.x, to.y);
    expect(hashDocument(doc)).toBe(before);
    expect(lastNotification(editor)).toBe(LOCKED_MESSAGE);

    editor.clearSelection();
    editor.activateTool(ERASER_TOOL_ID);
    clickAt(editor, 2, 2);
    expect(doc.rootStore.instanceCount).toBe(1);
    expect(hashDocument(doc)).toBe(before);
  });
});

/** Root: a component `Seat <Chair>` and a group `Group` holding a locked group `Window`. */
function hierarchyEditor() {
  const editor = createTestEditor();
  const doc = editor.session.doc;
  const root = doc.rootDefinitionId;
  draw(doc, rectangle(0, 0, 1, 1));
  const chair = makeComponent(doc, root, { faces: faceIds(doc.rootStore) }, 'Chair');
  draw(doc, rectangle(3, 0, 4, 1));
  const inner = makeGroup(doc, root, { faces: faceIds(doc.rootStore) });
  const outer = makeGroup(doc, root, { instances: [inner.instance] });
  const [windowInstance] = [...doc.store(outer.definition).instances()];
  if (!windowInstance) throw new Error('expected a nested group');
  doc.transact('Name', () => {
    setInstanceAttributes(doc, root, chair.instance, { name: 'Seat' });
    setInstanceAttributes(doc, outer.definition, windowInstance.id, { name: 'Window', locked: true });
  });
  return { editor, doc, chair, outer, windowId: windowInstance.id };
}

describe('Outliner', () => {
  it('builds a sorted tree with labels, paths and flags, and filters it', () => {
    const { doc, chair, outer, windowId } = hierarchyEditor();
    const tree = buildOutlinerTree(doc);
    expect(tree.map((node) => [node.label, node.kind])).toEqual([
      ['Group', 'group'],
      ['Seat <Chair>', 'component'],
    ]);
    const [group, seat] = tree;
    expect(seat).toMatchObject({
      id: chair.instance,
      parentPath: [],
      hidden: false,
      locked: false,
      children: [],
    });
    expect(group?.children).toEqual([
      expect.objectContaining({
        id: windowId,
        key: `${String(outer.instance)}/${String(windowId)}`,
        parentPath: [outer.instance],
        label: 'Window',
        locked: true,
      }),
    ]);

    expect(buildOutlinerTree(doc, 'wind').map((node) => node.children.map((child) => child.label))).toEqual([
      ['Window'],
    ]);
    expect(buildOutlinerTree(doc, 'CHAIR').map((node) => node.label)).toEqual(['Seat <Chair>']);
    expect(buildOutlinerTree(doc, 'nothing like this')).toEqual([]);

    expect(flattenOutliner(tree, () => false)).toHaveLength(2);
    const rows = flattenOutliner(tree, () => true);
    expect(
      rows.map((row) => [row.node.label, row.level, row.parentIndex, row.posInSet, row.setSize]),
    ).toEqual([
      ['Group', 1, -1, 1, 2],
      ['Window', 2, 0, 1, 1],
      ['Seat <Chair>', 1, -1, 2, 2],
    ]);
  });

  it('selects nested instances by opening their parents, and respects locks', () => {
    const { editor, doc, outer, windowId } = hierarchyEditor();
    expect(editor.selectInstanceAtPath([outer.instance], windowId)).toBe(true);
    expect(editor.session.editPath).toEqual([outer.instance]);
    expect(editor.session.selection.refs()).toEqual([{ kind: 'instance', id: windowId }]);

    editor.openInstanceAtPath([outer.instance], windowId);
    expect(lastNotification(editor)).toBe(LOCKED_MESSAGE);
    expect(editor.session.editPath).toEqual([outer.instance]);

    // Selecting something at the root closes the open group.
    editor.selectInstanceAtPath([], outer.instance);
    expect(editor.session.editPath).toEqual([]);

    editor.updateInstanceAt([], outer.instance, { locked: true });
    editor.selectInstanceAtPath([outer.instance], windowId);
    expect(editor.session.editPath).toEqual([]);
    expect(editor.session.selection.refs()).toEqual([{ kind: 'instance', id: outer.instance }]);

    editor.updateInstanceAt([], outer.instance, { locked: false });
    editor.openInstanceAtPath([], outer.instance);
    expect(editor.session.editPath).toEqual([outer.instance]);
    expect(editor.selectInstanceAtPath([999 as InstanceId], windowId)).toBe(false);

    editor.updateInstanceAt([outer.instance], windowId, { name: '  Pane ', hidden: true });
    expect(doc.store(outer.definition).getInstance(windowId).attributes).toMatchObject({
      name: 'Pane',
      hidden: true,
    });
    expect(doc.undoLabel).toBe('Rename');
    editor.undo();
    expect(buildOutlinerTree(doc)[0]?.children[0]?.label).toBe('Window');
  });
});

describe('Components', () => {
  function editorWithComponent() {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(0, 0, 1, 1));
    editor.selectAll();
    editor.groupSelection('component');
    const [component] = listComponentDefinitions(doc);
    if (!component) throw new Error('expected a component');
    return { editor, doc, definition: component.id };
  }

  it('places an instance at the clicked point with synthetic pointer input', () => {
    const { editor, doc, definition } = editorWithComponent();
    const tag = editor.addTag();
    editor.setActiveTag(tag);
    editor.placeComponent(definition);
    expect(editor.tools.activeToolId).toBe(PLACE_COMPONENT_TOOL_ID);
    expect(editor.placementDefinition).toBe(definition);

    const target = screenOf(3, 2);
    editor.tools.pointerMove(pointer(target.x, target.y, { buttons: 0 }));
    expect(editor.session.preview?.lines).toHaveLength(12);
    click(editor, target.x, target.y);

    expect(doc.rootStore.instanceCount).toBe(2);
    expect(doc.undoLabel).toBe('Place Component');
    expect(editor.tools.activeToolId).toBe(SELECT_TOOL_ID);
    const [placed] = editor.session.selection.ids('instance');
    const instance = doc.rootStore.getInstance(placed as InstanceId);
    expect(instance.definitionId).toBe(definition);
    expect(instance.attributes.tagId).toBe(tag);
    const origin = transformPoint(instance.transform, ZERO);
    expect(origin.x).toBeCloseTo(3, 9);
    expect(origin.y).toBeCloseTo(2, 9);
    expect(origin.z).toBeCloseTo(0, 9);
    expect(listComponentDefinitions(doc)[0]?.instanceCount).toBe(2);

    editor.undo();
    expect(doc.rootStore.instanceCount).toBe(1);
  });

  it('Esc cancels placement, and groups cannot be placed', async () => {
    const { editor, doc, definition } = editorWithComponent();
    await editor.runCommand(PLACE_COMPONENT_TOOL_ID);
    expect(editor.tools.activeToolId).toBe(PLACE_COMPONENT_TOOL_ID);
    expect(editor.handleKey(key('Escape'))).toBe(true);
    expect(editor.tools.activeToolId).toBe(SELECT_TOOL_ID);
    expect(editor.placementDefinition).toBeNull();
    expect(doc.rootStore.instanceCount).toBe(1);

    editor.selectAll();
    editor.groupSelection('group');
    const [group] = editor.session.selection.ids('instance');
    editor.placeComponent(doc.rootStore.getInstance(group as InstanceId).definitionId);
    expect(editor.tools.activeToolId).toBe(SELECT_TOOL_ID);
    expect(lastNotification(editor)).toBe('Choose a component to place');
    expect(definition).toBeDefined();
  });

  it('selects instances, renames, makes unique and purges unused definitions', async () => {
    const { editor, doc, definition } = editorWithComponent();
    editor.placeComponent(definition);
    const target = screenOf(3, 2);
    click(editor, target.x, target.y);
    editor.clearSelection();

    expect(editor.selectInstancesOf(definition)).toBe(2);
    expect(editor.commands.isEnabled('edit.makeUnique', editor)).toBe(false);
    expect(editor.renameDefinition(definition, ' Table ')).toBe(true);
    expect(listComponentDefinitions(doc).map((row) => row.name)).toEqual(['Table']);
    expect(editor.renameDefinition(definition, '')).toBe(false);

    const [first] = editor.session.selection.ids('instance');
    editor.session.setSelection(Selection.of([{ kind: 'instance', id: first as number }]));
    expect(editor.commands.isEnabled('edit.makeUnique', editor)).toBe(true);
    await editor.runCommand('edit.makeUnique');
    expect(doc.undoLabel).toBe('Make Unique');
    expect(listComponentDefinitions(doc).map((row) => [row.name, row.instanceCount])).toEqual([
      ['Table', 1],
      ['Table#1', 1],
    ]);

    editor.selectAll();
    editor.deleteSelection();
    expect(editor.purgeUnusedComponents()).toBe(2);
    expect(listComponentDefinitions(doc)).toEqual([]);
    expect(editor.purgeUnusedComponents()).toBe(0);
    editor.undo();
    expect(listComponentDefinitions(doc)).toHaveLength(2);
  });
});

describe('Entity Info editing', () => {
  it('edits instance attributes and definition names as undoable steps', () => {
    const { editor, doc, instance } = editorWithGroup();
    const info = () =>
      describeSelection(doc, editor.session.activeContext, editor.session.selection, METRIC_UNIT_SETTINGS);
    expect(info().fields).toEqual({
      tag: null,
      hidden: false,
      locked: false,
      name: '',
      instanceMaterial: null,
    });

    editor.updateSelectionAttributes({ hidden: true });
    expect(info().fields.hidden).toBe(true);
    expect(doc.undoLabel).toBe('Hide');
    editor.undo();
    expect(info().fields.hidden).toBe(false);

    editor.updateInstanceAt(editor.session.editPath, instance, { name: 'Door' });
    expect(info().fields.name).toBe('Door');

    editor.groupSelection('component');
    const component = info();
    expect(component.title).toBe('Component');
    expect(component.rows).toContainEqual({ label: 'Instances', value: '1' });
    const definition = component.fields.definition;
    if (!definition) throw new Error('expected a definition field');
    editor.renameDefinition(definition.id, 'Cabinet');
    expect(info().fields.definition?.name).toBe('Cabinet');
    editor.undo();
    expect(info().fields.definition?.name).toBe(definition.name);
  });

  it('shows edge and face fields, mixed values, and edits soft and smooth', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(0, 0, 2, 1));
    const [face] = faceIds(doc.rootStore);
    const [edge, other] = [...doc.rootStore.edges()].map((e) => e.id);
    if (face === undefined || edge === undefined || other === undefined) throw new Error('expected geometry');
    const info = () =>
      describeSelection(doc, editor.session.activeContext, editor.session.selection, METRIC_UNIT_SETTINGS);

    editor.session.setSelection(Selection.of([{ kind: 'edge', id: edge }]));
    expect(info().fields).toEqual({ tag: null, hidden: false, soft: false, smooth: false });
    editor.updateSelectionAttributes({ soft: true, smooth: true });
    expect(doc.rootStore.getEdge(edge).attributes).toMatchObject({ soft: true, smooth: true });
    expect(doc.undoLabel).toBe('Soften');

    editor.session.setSelection(
      Selection.of([
        { kind: 'edge', id: edge },
        { kind: 'edge', id: other },
      ]),
    );
    expect(info().fields.soft).toBe('mixed');

    const tag = editor.addTag();
    editor.session.setSelection(Selection.of([{ kind: 'face', id: face }]));
    editor.assignSelectionToTag(tag);
    editor.session.setSelection(
      Selection.of([
        { kind: 'face', id: face },
        { kind: 'edge', id: other },
      ]),
    );
    expect(info().fields).toEqual({ tag: 'mixed', hidden: false });
    editor.undo();
    expect(info().fields.tag).toBeNull();
  });

  it('shows curve parameters for an edge of a circle', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.activateTool(CIRCLE_TOOL_ID);
    clickAt(editor, 2, 2);
    clickAt(editor, 3, 2);
    const [curve] = [...doc.rootStore.curves()];
    const edge = curve?.edges[0];
    if (edge === undefined) throw new Error('expected a circle');
    editor.session.setSelection(Selection.of([{ kind: 'edge', id: edge }]));
    const { rows } = describeSelection(
      doc,
      doc.rootDefinitionId,
      editor.session.selection,
      METRIC_UNIT_SETTINGS,
    );
    expect(rows.map((row) => row.label)).toEqual(['Length', 'Faces', 'Curve', 'Radius', 'Segments']);
    expect(rows[2]?.value).toBe('Circle');
    expect(rows[3]?.value).toBe('1000mm');
  });
});

describe('dock panels', () => {
  it('toggles panels through Window commands and exposes them in the store', async () => {
    const editor = createTestEditor();
    const store = createEditorStore(editor);
    expect(store.getState().openPanels).toEqual([
      'entityInfo',
      'outliner',
      'components',
      'tags',
      'materials',
    ]);
    expect(editor.commands.isChecked('window.outliner', editor)).toBe(true);
    await editor.runCommand('window.outliner');
    expect(editor.isPanelOpen('outliner')).toBe(false);
    expect(store.getState().openPanels).toEqual(['entityInfo', 'components', 'tags', 'materials']);
    await editor.runCommand('window.outliner');
    expect(store.getState().openPanels).toEqual([
      'entityInfo',
      'outliner',
      'components',
      'tags',
      'materials',
    ]);
    store.dispose();
  });
});
