import { describe, expect, it } from 'vitest';
import { Editor } from '../../src/app/Editor';
import { MATERIAL_LIBRARY } from '../../src/app/materials/materials';
import { describeSelection } from '../../src/app/selection/entityInfo';
import { LOCKED_MESSAGE } from '../../src/app/selection/locking';
import { Selection } from '../../src/app/selection/Selection';
import { createEditorStore } from '../../src/app/stores/editorStore';
import { PAINT_TOOL_ID } from '../../src/app/tools/PaintBucketTool';
import type { FaceId, InstanceId, MaterialId } from '../../src/kernel/ids';
import type { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { setInstanceAttributes } from '../../src/kernel/model/mutations';
import { validateDocument } from '../../src/kernel/model/validate';
import { draw, rectangle } from '../kernel/helpers';
import { pngBytes } from '../kernel/imageBytes';
import { click, createTestEditor, pointer, screenOf, TOP_CAMERA, VIEW_SIZE } from './fixtures';

const RED = { r: 1, g: 0, b: 0 };

/** Three faces in a row, (-4, 0)–(2, 2), and a separate one at (3, 0)–(4, 2). All face down, so their backs face the top camera. */
function editorWithStrip(editor: Editor = createTestEditor()) {
  const doc = editor.session.doc;
  draw(doc, rectangle(-4, 0, -2, 2));
  draw(doc, rectangle(-2, 0, 0, 2));
  draw(doc, rectangle(0, 0, 2, 2));
  draw(doc, rectangle(3, 0, 4, 2));
  const faceAt = (x: number): FaceId => {
    const hit = editor.pickAt(screenOf(x, 1), { edgeTolerancePx: 0 });
    if (hit?.ref.kind !== 'face') throw new Error(`no face at ${String(x)}`);
    return hit.ref.id as FaceId;
  };
  return { editor, doc, f1: faceAt(-3), f2: faceAt(-1), f3: faceAt(1), f4: faceAt(3.5) };
}

function paintAt(editor: Editor, x: number, modifiers: Parameters<typeof pointer>[2] = {}): void {
  const screen = screenOf(x, 1);
  click(editor, screen.x, screen.y, modifiers);
}

const back = (doc: ModelDocument, face: FaceId) => doc.rootStore.getFace(face).attributes.backMaterialId;
const front = (doc: ModelDocument, face: FaceId) => doc.rootStore.getFace(face).attributes.frontMaterialId;

describe('Paint Bucket tool', () => {
  it('is B, paints the side facing the camera, and makes one undo step per click', async () => {
    const { editor, doc, f1, f2 } = editorWithStrip();
    const red = editor.addMaterial({ name: 'Red', color: RED });
    await editor.runCommand(PAINT_TOOL_ID);
    expect(editor.tools.activeToolId).toBe(PAINT_TOOL_ID);
    expect(editor.shortcuts.chordsFor(PAINT_TOOL_ID)).toEqual(['B']);
    expect(editor.tools.statusHint).toMatch(/paint it with Red/);
    const depth = doc.undoDepth;
    paintAt(editor, -3);
    expect(back(doc, f1)).toBe(red);
    expect(front(doc, f1)).toBeNull();
    expect(back(doc, f2)).toBeNull();
    expect(doc.undoDepth).toBe(depth + 1);
    expect(doc.undoLabel).toBe('Paint');
    editor.undo();
    expect(back(doc, f1)).toBeNull();
  });

  it('paints the front when the camera looks at it from below', () => {
    const { editor, doc, f1 } = editorWithStrip();
    const red = editor.addMaterial({ color: RED });
    editor.session.setCamera({ ...TOP_CAMERA, eye: { x: 0, y: 0, z: -10 }, up: { x: 0, y: 1, z: 0 } });
    editor.activateTool(PAINT_TOOL_ID);
    // Seen from below, world x is mirrored on screen.
    const screen = screenOf(3, 1);
    click(editor, screen.x, screen.y);
    expect(front(doc, f1)).toBe(red);
    expect(back(doc, f1)).toBeNull();
  });

  it('widens what is painted with Shift, Ctrl and Ctrl+Shift', () => {
    const { editor, doc, f1, f2, f3, f4 } = editorWithStrip();
    const c = editor.addMaterial({ name: 'C', color: RED });
    editor.activateTool(PAINT_TOOL_ID);
    paintAt(editor, -1);
    expect(back(doc, f2)).toBe(c);

    const a = editor.addMaterial({ name: 'A', color: RED });
    // Ctrl: connected faces with the same material; f2 blocks the way to f3.
    paintAt(editor, -3, { ctrlKey: true });
    expect([back(doc, f1), back(doc, f2), back(doc, f3), back(doc, f4)]).toEqual([a, c, null, null]);
    editor.undo();

    // Ctrl+Shift: the same material anywhere on the connected object, but not on the separate face.
    moveHover(editor, -3, { ctrlKey: true, shiftKey: true });
    expect(editor.session.preview?.highlight).toEqual([
      { kind: 'face', id: f1 },
      { kind: 'face', id: f3 },
    ]);
    paintAt(editor, -3, { ctrlKey: true, shiftKey: true });
    expect([back(doc, f1), back(doc, f2), back(doc, f3), back(doc, f4)]).toEqual([a, c, a, null]);
    editor.undo();

    // Shift: every face in the context with the same material.
    paintAt(editor, -3, { shiftKey: true });
    expect([back(doc, f1), back(doc, f2), back(doc, f3), back(doc, f4)]).toEqual([a, c, a, a]);
    expect(doc.undoLabel).toBe('Paint');
    expect(validateDocument(doc).problems).toEqual([]);
  });

  it('samples with Alt on Windows and Linux without changing the model', () => {
    const { editor, doc, f2 } = editorWithStrip();
    const c = editor.addMaterial({ name: 'C', color: RED });
    editor.activateTool(PAINT_TOOL_ID);
    paintAt(editor, -1);
    editor.setActiveMaterial(null);
    const depth = doc.undoDepth;
    paintAt(editor, -1, { altKey: true });
    expect(editor.activeMaterialId).toBe(c);
    expect(doc.undoDepth).toBe(depth);
    expect(back(doc, f2)).toBe(c);
    paintAt(editor, -3, { altKey: true });
    expect(editor.activeMaterialId).toBeNull();
  });

  it('samples with Command on macOS, where Option is the toggle key', () => {
    const editor = new Editor({ platform: 'mac', appVersion: '0.0.0-test' });
    editor.setViewportSize(VIEW_SIZE);
    editor.session.setCamera(TOP_CAMERA);
    const { doc, f1, f2, f3 } = editorWithStrip(editor);
    const c = editor.addMaterial({ name: 'C', color: RED });
    editor.activateTool(PAINT_TOOL_ID);
    paintAt(editor, -1);
    editor.setActiveMaterial(null);
    paintAt(editor, -1, { metaKey: true });
    expect(editor.activeMaterialId).toBe(c);
    expect(editor.tools.statusHint).toMatch(/Option: matching connected faces/);
    const a = editor.addMaterial({ name: 'A', color: RED });
    paintAt(editor, 1, { altKey: true });
    expect([back(doc, f1), back(doc, f2), back(doc, f3)]).toEqual([null, c, a]);
  });

  it('paints groups and components, and refuses locked ones', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 3));
    editor.selectAll();
    editor.groupSelection('group');
    const [id] = editor.session.selection.ids('instance');
    const instance = id as InstanceId;
    const red = editor.addMaterial({ color: RED });
    editor.activateTool(PAINT_TOOL_ID);
    const inside = screenOf(2, 2);
    editor.tools.pointerMove(pointer(inside.x, inside.y, { buttons: 0 }));
    expect(editor.session.preview?.highlight).toEqual([{ kind: 'instance', id: instance }]);
    click(editor, inside.x, inside.y);
    expect(doc.rootStore.getInstance(instance).attributes.materialId).toBe(red);

    doc.transact('Lock', () => {
      setInstanceAttributes(doc, doc.rootDefinitionId, instance, { locked: true });
    });
    editor.setActiveMaterial(null);
    click(editor, inside.x, inside.y);
    expect(doc.rootStore.getInstance(instance).attributes.materialId).toBe(red);
    expect(editor.notifications.at(-1)?.message).toBe(LOCKED_MESSAGE);
  });
});

function moveHover(editor: Editor, x: number, modifiers: Parameters<typeof pointer>[2]): void {
  const screen = screenOf(x, 1);
  editor.tools.pointerMove(pointer(screen.x, screen.y, { buttons: 0, ...modifiers }));
}

describe('Materials panel logic', () => {
  it('creates, renames and edits materials, and tracks the active material in the store', () => {
    const editor = createTestEditor();
    const store = createEditorStore(editor);
    const doc = editor.session.doc;
    const id = editor.addMaterial();
    expect(doc.material(id)?.name).toBe('Material 1');
    expect(store.getState().activeMaterialId).toBe(id);
    expect(editor.addMaterial()).not.toBe(id);
    expect(editor.materialRows().map((row) => row.name)).toEqual(['Material 1', 'Material 2']);

    expect(editor.renameMaterial(id, '  Oak ')).toBe(true);
    expect(editor.renameMaterial(id, ' ')).toBe(false);
    expect(editor.updateMaterial(id, { color: RED, opacity: 0.5, metalness: 0.2, roughness: 0.3 })).toBe(
      true,
    );
    expect(doc.material(id)).toMatchObject({
      name: 'Oak',
      color: RED,
      opacity: 0.5,
      metalness: 0.2,
      roughness: 0.3,
    });
    expect(doc.undoLabel).toBe('Edit Material');
    expect(editor.updateMaterial(id, { metalness: 1.5 })).toBe(false);
    expect(editor.notifications.at(-1)?.message).toMatch(/metalness/);

    editor.setActiveMaterial(null);
    expect(store.getState().activeMaterialId).toBeNull();
    const library = MATERIAL_LIBRARY.find((entry) => entry.opacity !== undefined);
    if (!library) throw new Error('expected a translucent library material');
    const glass = editor.addLibraryMaterial(library);
    expect(doc.material(glass)).toMatchObject({ name: library.name, opacity: library.opacity });
    expect(doc.material(editor.addLibraryMaterial(library))?.name).toBe(`${library.name} 2`);

    // Deleting the active material resets it to the default.
    editor.deleteMaterial(editor.activeMaterialId as MaterialId);
    expect(editor.activeMaterialId).toBeNull();
    store.dispose();
  });

  it('imports, resizes and removes textures', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    const id = editor.addMaterial();
    expect(editor.importMaterialTexture(id, 'wood.png', pngBytes(200, 100))).toBe(true);
    const texture = doc.material(id)?.texture;
    expect(texture).toMatchObject({ width: 1, height: 0.5 });
    expect(editor.materialRows()[0]?.image).toEqual({ name: 'wood.png', width: 200, height: 100 });
    expect(editor.importMaterialTexture(id, 'notes.txt', new TextEncoder().encode('hello'))).toBe(false);
    expect(editor.notifications.at(-1)?.message).toMatch(/Could not import notes.txt/);

    expect(editor.importMaterialTexture(id, 'wood2.png', pngBytes(10, 10), { width: 2, height: 2 })).toBe(
      true,
    );
    // Replacing a texture removes the image nothing uses any more.
    expect([...doc.assets()].map((asset) => asset.name)).toEqual(['wood2.png']);
    expect(editor.setMaterialTextureSize(id, 3, 1.5)).toBe(true);
    expect(editor.setMaterialTextureSize(id, -1, 1)).toBe(false);
    expect(doc.material(id)?.texture).toMatchObject({ width: 3, height: 1.5 });
    editor.removeMaterialTexture(id);
    expect(doc.material(id)?.texture).toBeNull();
    expect([...doc.assets()]).toEqual([]);
    editor.undo();
    expect(doc.material(id)?.texture).toMatchObject({ width: 3 });
  });

  it('selects faces, reports area, purges unused materials and paints the selection', () => {
    const { editor, doc, f1, f2 } = editorWithStrip();
    const used = editor.addMaterial({ name: 'Used' });
    const unused = editor.addMaterial({ name: 'Unused' });
    editor.setActiveMaterial(used);
    editor.session.setSelection(
      Selection.of([
        { kind: 'face', id: f1 },
        { kind: 'face', id: f2 },
      ]),
    );
    editor.paintSelection();
    expect([front(doc, f1), front(doc, f2)]).toEqual([used, used]);
    editor.clearSelection();

    expect(editor.selectFacesWithMaterial(used)).toBe(2);
    expect(editor.session.selection.ids('face')).toEqual([f1, f2].sort((a, b) => a - b));
    expect(editor.selectFacesWithMaterial(unused)).toBe(0);
    expect(editor.materialRows().find((row) => row.id === used)?.area).toBeCloseTo(8);

    expect(editor.purgeUnusedMaterials()).toBe(1);
    expect(doc.material(unused)).toBeUndefined();
    expect(editor.purgeUnusedMaterials()).toBe(0);
    expect(editor.notifications.at(-1)?.message).toBe('There are no unused materials');
  });

  it('shows and sets materials and texture positions in Entity Info', () => {
    const { editor, doc, f1, f2 } = editorWithStrip();
    const info = () =>
      describeSelection(doc, editor.session.activeContext, editor.session.selection, editor.units).fields;
    const red = editor.addMaterial({ name: 'Red', color: RED });
    editor.session.setSelection(Selection.of([{ kind: 'face', id: f1 }]));
    expect(info()).toMatchObject({ frontMaterial: null, backMaterial: null });
    editor.setSelectionMaterial('back', red);
    expect(info()).toMatchObject({ frontMaterial: null, backMaterial: red });
    expect(info().texturePlacement).toBeUndefined();

    editor.session.setSelection(
      Selection.of([
        { kind: 'face', id: f1 },
        { kind: 'face', id: f2 },
      ]),
    );
    expect(info().backMaterial).toBe('mixed');

    editor.importMaterialTexture(red, 'red.png', pngBytes(4, 4));
    editor.session.setSelection(Selection.of([{ kind: 'face', id: f1 }]));
    expect(info().texturePlacement).toEqual({ faceId: f1, back: null });
    const placement = { offsetX: 0.5, offsetY: 0, rotation: 0.1, scaleX: 2, scaleY: 2 };
    expect(editor.setFaceTexturePlacement(f1, 'back', placement)).toBe(true);
    expect(info().texturePlacement).toEqual({ faceId: f1, back: placement });
    expect(editor.setFaceTexturePlacement(f1, 'back', { ...placement, scaleY: 0 })).toBe(false);
    expect(doc.undoLabel).toBe('Position Texture');
  });
});
