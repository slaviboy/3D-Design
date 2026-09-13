import { describe, expect, it } from 'vitest';
import type { Editor } from '../../src/app/Editor';
import { Selection } from '../../src/app/selection/Selection';
import type { FaceId } from '../../src/kernel/ids';
import { draw, expectValid, faceIds, rectangle } from '../kernel/helpers';
import { createTestEditor } from './fixtures';

/** Two separate squares, (0, 0)–(1, 1) and (3, 0)–(4, 1). */
function editorWithTwoSquares(): { editor: Editor; first: FaceId; second: FaceId } {
  const editor = createTestEditor();
  const doc = editor.session.doc;
  draw(doc, rectangle(0, 0, 1, 1));
  const [first] = faceIds(doc.rootStore);
  draw(doc, rectangle(3, 0, 4, 1));
  const second = faceIds(doc.rootStore).find((id) => id !== first);
  if (first === undefined || second === undefined) throw new Error('expected two faces');
  return { editor, first, second };
}

function selectFaces(editor: Editor, ...faces: FaceId[]): void {
  editor.session.setSelection(Selection.of(faces.map((id) => ({ kind: 'face' as const, id }))));
}

describe('selection commands', () => {
  it('selects connected geometry, bounding edges, and the inverse', async () => {
    const { editor, first } = editorWithTwoSquares();

    selectFaces(editor, first);
    await editor.runCommand('select.connected');
    expect(editor.session.selection.count('face')).toBe(1);
    expect(editor.session.selection.count('edge')).toBe(4);

    selectFaces(editor, first);
    await editor.runCommand('select.boundingEdges');
    expect(editor.session.selection.size).toBe(5);

    selectFaces(editor, first);
    await editor.runCommand('select.invert');
    expect(editor.session.selection.count('face')).toBe(1);
    expect(editor.session.selection.count('edge')).toBe(8);
    expect(editor.session.selection.has({ kind: 'face', id: first })).toBe(false);
  });

  it('selects everything on the same tag or with the same material', async () => {
    const { editor, first, second } = editorWithTwoSquares();
    const tag = editor.addTag();
    selectFaces(editor, first);
    editor.assignSelectionToTag(tag);
    editor.clearSelection();
    selectFaces(editor, first);
    await editor.runCommand('select.sameTag');
    expect(editor.session.selection.refs()).toEqual([{ kind: 'face', id: first }]);

    const material = editor.addMaterial({ name: 'Brick' });
    selectFaces(editor, second);
    editor.setSelectionMaterial('front', material);
    editor.clearSelection();
    selectFaces(editor, second);
    await editor.runCommand('select.sameMaterial');
    expect(editor.session.selection.refs()).toEqual([{ kind: 'face', id: second }]);

    selectFaces(editor, first);
    await editor.runCommand('select.sameMaterial');
    expect(editor.session.selection.refs()).toEqual([{ kind: 'face', id: first }]);
  });
});

describe('visibility and face commands', () => {
  it('hides the selection, unhides it, and unhides everything in one undoable step', async () => {
    const { editor, first, second } = editorWithTwoSquares();
    const store = editor.session.doc.rootStore;
    selectFaces(editor, first, second);
    expect(editor.commands.isEnabled('edit.unhide', editor)).toBe(false);
    await editor.runCommand('edit.hide');
    expect(store.getFace(first).attributes.hidden).toBe(true);
    expect(editor.session.selection.isEmpty).toBe(true);

    selectFaces(editor, first);
    expect(editor.commands.isEnabled('edit.hide', editor)).toBe(false);
    await editor.runCommand('edit.unhide');
    expect(store.getFace(first).attributes.hidden).toBe(false);

    expect(editor.commands.isEnabled('edit.unhideAll', editor)).toBe(true);
    await editor.runCommand('edit.unhideAll');
    expect(store.getFace(second).attributes.hidden).toBe(false);
    expect(editor.session.doc.undoLabel).toBe('Unhide All');
    expect(editor.commands.isEnabled('edit.unhideAll', editor)).toBe(false);
    editor.undo();
    expect(store.getFace(second).attributes.hidden).toBe(true);
  });

  it('reverses faces, swapping their materials, as one undoable step', async () => {
    const { editor, first } = editorWithTwoSquares();
    const doc = editor.session.doc;
    const store = doc.rootStore;
    const brick = editor.addMaterial({ name: 'Brick' });
    selectFaces(editor, first);
    editor.setSelectionMaterial('front', brick);
    const normal = store.getFacePlane(first).normal;

    await editor.runCommand('edit.reverseFaces');
    expect(store.getFacePlane(first).normal.z).toBeCloseTo(-normal.z, 12);
    expect(store.getFace(first).attributes).toMatchObject({ frontMaterialId: null, backMaterialId: brick });
    expect(doc.undoLabel).toBe('Reverse Faces');
    expectValid(doc);

    editor.undo();
    expect(store.getFacePlane(first).normal.z).toBeCloseTo(normal.z, 12);
    expect(store.getFace(first).attributes.frontMaterialId).toBe(brick);
  });

  it('softens and unsoftens the selected edges', async () => {
    const { editor } = editorWithTwoSquares();
    const [edge] = [...editor.session.doc.rootStore.edges()];
    if (!edge) throw new Error('expected an edge');
    editor.session.setSelection(Selection.of([{ kind: 'edge', id: edge.id }]));
    expect(editor.commands.isEnabled('edit.unsoften', editor)).toBe(false);
    await editor.runCommand('edit.soften');
    expect(editor.session.doc.rootStore.getEdge(edge.id).attributes).toMatchObject({
      soft: true,
      smooth: true,
    });
    await editor.runCommand('edit.unsoften');
    expect(editor.session.doc.rootStore.getEdge(edge.id).attributes).toMatchObject({
      soft: false,
      smooth: false,
    });
  });

  it('zooms to the selection and samples its material', async () => {
    const { editor, second } = editorWithTwoSquares();
    const brick = editor.addMaterial({ name: 'Brick' });
    selectFaces(editor, second);
    editor.setSelectionMaterial('front', brick);
    editor.setActiveMaterial(null);

    await editor.runCommand('materials.sample');
    expect(editor.activeMaterialId).toBe(brick);

    await editor.runCommand('camera.zoomSelection');
    const { target } = editor.session.camera;
    expect(target.x).toBeCloseTo(3.5, 9);
    expect(target.y).toBeCloseTo(0.5, 9);
  });
});

describe('panel commands', () => {
  it('Entity Info shows, expands and focuses its panel', async () => {
    const editor = createTestEditor();
    editor.setPanelOpen('entityInfo', false);
    editor.setPanelCollapsed('entityInfo', true);
    await editor.runCommand('edit.entityInfo');
    expect(editor.isPanelOpen('entityInfo')).toBe(true);
    expect(editor.isPanelCollapsed('entityInfo')).toBe(false);
    expect(editor.panelFocusRequest).toEqual({ panel: 'entityInfo', serial: 1 });
  });

  it('Reset Panels restores the default panels, order, collapsed state and width', async () => {
    const editor = createTestEditor();
    const defaults = { layout: editor.dockLayout, open: editor.openPanels };
    editor.setPanelOpen('instructor', true);
    editor.setPanelOpen('outliner', false);
    editor.movePanel('tags', -1);
    editor.setPanelCollapsed('materials', true);
    editor.setDockWidth(400);
    expect(editor.dockLayout).not.toEqual(defaults.layout);

    await editor.runCommand('window.resetPanels');
    expect(editor.dockLayout).toEqual(defaults.layout);
    expect(editor.openPanels).toEqual(defaults.open);
  });
});
