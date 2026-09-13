import Module from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import { Editor } from '../../src/app/Editor';
import { Selection } from '../../src/app/selection/Selection';
import { createDirectBooleanEngine, type BooleanEngine } from '../../src/app/solids/booleanClient';
import { runSolidTool } from '../../src/app/solids/solidTools';
import { FOLLOW_ME_TOOL_ID } from '../../src/app/tools/FollowMeTool';
import type { EdgeId, InstanceId } from '../../src/kernel/ids';
import { vec3 } from '../../src/kernel/math/vec3';
import { addMaterial, setFaceAttributes } from '../../src/kernel/model/mutations';
import { hashDocument } from '../../src/kernel/model/snapshot';
import { validateDocument } from '../../src/kernel/model/validate';
import { deleteFaces } from '../../src/kernel/ops/erase';
import { makeGroup } from '../../src/kernel/ops/hierarchy';
import { insertSegments } from '../../src/kernel/ops/insertSegments';
import { isSolid, solidVolume } from '../../src/kernel/ops/solids/solid';
import { runBoolean } from '../../src/workers/manifoldBoolean';
import { boxEdges, counts, draw, faceIds, rectangle } from '../kernel/helpers';
import { click, pointer, screenOf, TOP_CAMERA, VIEW_SIZE } from './fixtures';

let engine: BooleanEngine;

beforeAll(async () => {
  const wasm = await Module();
  wasm.setup();
  engine = createDirectBooleanEngine((operation, meshes) => runBoolean(wasm, operation, meshes));
});

function solidEditor(): Editor {
  const editor = new Editor({ platform: 'other', appVersion: '0.0.0-test', booleanEngine: engine });
  editor.setViewportSize(VIEW_SIZE);
  editor.session.setCamera(TOP_CAMERA);
  return editor;
}

/** A closed box drawn in the root context and wrapped in a group. */
function boxGroup(
  editor: Editor,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): InstanceId {
  const doc = editor.session.doc;
  const root = doc.rootDefinitionId;
  draw(doc, boxEdges(x0, y0, z0, x1, y1, z1));
  return makeGroup(doc, root, { faces: faceIds(doc.rootStore) }).instance;
}

function selectInstances(editor: Editor, ids: readonly InstanceId[]): void {
  editor.session.setSelection(Selection.of(ids.map((id) => ({ kind: 'instance' as const, id }))));
}

/** Volumes of the root's groups, smallest first. */
function volumes(editor: Editor): number[] {
  const doc = editor.session.doc;
  return [...doc.rootStore.instances()]
    .map((instance) => Math.abs(solidVolume(doc.store(instance.definitionId))))
    .sort((a, b) => a - b);
}

function expectSolidGroups(editor: Editor): void {
  const doc = editor.session.doc;
  expect(validateDocument(doc).problems).toEqual([]);
  for (const instance of doc.rootStore.instances())
    expect(isSolid(doc.store(instance.definitionId))).toBe(true);
}

/** Rows H1–H7 of docs/BEHAVIOR_MATRIX.md, through the editor with manifold-3d running in Node. */
describe('solid tools', () => {
  it('H2: Subtract cuts the second solid with the first, deletes the cutter and keeps materials', async () => {
    const editor = solidEditor();
    const doc = editor.session.doc;
    const cutter = boxGroup(editor, 0, 0, 0, 2, 2, 2);
    const target = boxGroup(editor, 1, 1, 1, 3, 3, 3);
    const targetDefinition = doc.rootStore.getInstance(target).definitionId;
    const red = doc.transact('Paint', () => {
      const material = addMaterial(doc, { name: 'Red', color: { r: 1, g: 0, b: 0 }, opacity: 1 });
      for (const faceId of faceIds(doc.store(targetDefinition))) {
        setFaceAttributes(doc, targetDefinition, faceId, { frontMaterialId: material });
      }
      return material;
    });
    selectInstances(editor, [target, cutter]);
    const before = hashDocument(doc);
    const depth = doc.undoDepth;

    await editor.runCommand('tools.subtract');
    expect(editor.notifications).toEqual([]);
    expect(doc.rootStore.instanceCount).toBe(1);
    expect(volumes(editor)[0]).toBeCloseTo(7, 6);
    expect(doc.undoDepth).toBe(depth + 1);
    expect(doc.undoLabel).toBe('Subtract');
    expectSolidGroups(editor);
    const [result] = [...doc.rootStore.instances()];
    const resultStore = doc.store(result?.definitionId ?? targetDefinition);
    // The outer faces of the target stay red; the cavity walls came from the unpainted cutter.
    expect([...resultStore.faces()].filter((face) => face.attributes.frontMaterialId === red)).toHaveLength(
      6,
    );
    expect([...resultStore.faces()].filter((face) => face.attributes.frontMaterialId === null)).toHaveLength(
      3,
    );
    expect(editor.session.selection.ids('instance')).toEqual([result?.id]);

    editor.undo();
    expect(hashDocument(doc)).toBe(before);
  });

  it('H3: Trim keeps the cutter', async () => {
    const editor = solidEditor();
    const cutter = boxGroup(editor, 0, 0, 0, 2, 2, 2);
    const target = boxGroup(editor, 1, 1, 1, 3, 3, 3);
    selectInstances(editor, [cutter, target]);
    await runSolidTool(editor, 'trim');
    expect(volumes(editor).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([7, 8]);
    expectSolidGroups(editor);
  });

  it('H1/H4: Union and Intersect give the combined and the shared volume', async () => {
    const union = solidEditor();
    selectInstances(union, [boxGroup(union, 0, 0, 0, 2, 2, 2), boxGroup(union, 1, 1, 1, 3, 3, 3)]);
    await runSolidTool(union, 'union');
    expect(volumes(union)).toHaveLength(1);
    expect(volumes(union)[0]).toBeCloseTo(15, 6);
    expectSolidGroups(union);

    const intersect = solidEditor();
    selectInstances(intersect, [
      boxGroup(intersect, 0, 0, 0, 2, 2, 2),
      boxGroup(intersect, 1, 1, 1, 3, 3, 3),
    ]);
    await runSolidTool(intersect, 'intersect');
    expect(volumes(intersect)).toHaveLength(1);
    expect(volumes(intersect)[0]).toBeCloseTo(1, 6);
    const [cube] = [...intersect.session.doc.rootStore.instances()];
    expect(counts(intersect.session.doc, cube?.definitionId)).toEqual({ v: 8, e: 12, f: 6 });
  });

  it('H5: Split makes three solids', async () => {
    const editor = solidEditor();
    selectInstances(editor, [boxGroup(editor, 0, 0, 0, 2, 2, 2), boxGroup(editor, 1, 1, 1, 3, 3, 3)]);
    await runSolidTool(editor, 'split');
    expect(volumes(editor).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 7, 7]);
    expectSolidGroups(editor);
  });

  it('H6: Outer Shell merges three overlapping boxes into one box with no internal faces', async () => {
    const editor = solidEditor();
    const doc = editor.session.doc;
    selectInstances(editor, [
      boxGroup(editor, 0, 0, 0, 2, 2, 2),
      boxGroup(editor, 1, 0, 0, 3, 2, 2),
      boxGroup(editor, 2, 0, 0, 4, 2, 2),
    ]);
    await runSolidTool(editor, 'outerShell');
    const [shell] = [...doc.rootStore.instances()];
    expect(doc.rootStore.instanceCount).toBe(1);
    // Coplanar triangles are regrouped into whole faces.
    expect(counts(doc, shell?.definitionId)).toEqual({ v: 8, e: 12, f: 6 });
    expect(volumes(editor)[0]).toBeCloseTo(16, 6);
    expectSolidGroups(editor);
  });

  it('H7: refuses non-solid input with a clear message and no history entry', async () => {
    const editor = solidEditor();
    const doc = editor.session.doc;
    const solid = boxGroup(editor, 0, 0, 0, 2, 2, 2);
    const open = boxGroup(editor, 1, 1, 1, 3, 3, 3);
    const openDefinition = doc.rootStore.getInstance(open).definitionId;
    deleteFaces(doc, openDefinition, faceIds(doc.store(openDefinition)).slice(0, 1));
    selectInstances(editor, [solid, open]);
    const before = hashDocument(doc);
    const depth = doc.undoDepth;

    await editor.runCommand('tools.union');
    expect(editor.notifications.at(-1)).toMatchObject({
      kind: 'error',
      message: expect.stringMatching(/only on solids/),
    });
    expect(hashDocument(doc)).toBe(before);
    expect(doc.undoDepth).toBe(depth);
    await expect(runSolidTool(editor, 'subtract')).rejects.toThrow(/not closed/);
  });

  it('enables each solid tool only for the number of selected objects it needs', () => {
    const editor = solidEditor();
    const a = boxGroup(editor, 0, 0, 0, 1, 1, 1);
    const b = boxGroup(editor, 2, 0, 0, 3, 1, 1);
    const c = boxGroup(editor, 4, 0, 0, 5, 1, 1);
    const enabled = (id: string) => editor.commands.isEnabled(id, editor);
    selectInstances(editor, [a]);
    expect(['tools.union', 'tools.subtract', 'tools.split', 'tools.outerShell'].map(enabled)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    selectInstances(editor, [a, b]);
    expect(
      [
        'tools.union',
        'tools.subtract',
        'tools.trim',
        'tools.intersect',
        'tools.split',
        'tools.outerShell',
      ].map(enabled),
    ).toEqual([true, true, true, true, true, true]);
    selectInstances(editor, [a, b, c]);
    expect(['tools.union', 'tools.subtract', 'tools.intersect', 'tools.split'].map(enabled)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });
});

describe('Intersect Faces commands', () => {
  it('intersects the selected faces with the model and selects the new edges', async () => {
    const editor = solidEditor();
    const doc = editor.session.doc;
    draw(doc, boxEdges(0, 0, 0, 2, 2, 2));
    draw(doc, boxEdges(1, 1, 1, 3, 3, 3));
    expect(editor.commands.isEnabled('edit.intersectWithModel', editor)).toBe(false);
    editor.selectAll();
    expect(editor.commands.isEnabled('edit.intersectWithSelection', editor)).toBe(true);
    await editor.runCommand('edit.intersectWithModel');
    expect(counts(doc)).toEqual({ v: 22, e: 36, f: 18 });
    expect(editor.session.selection.count('edge')).toBe(6);
    expect(doc.undoLabel).toBe('Intersect Faces');
  });

  it('reports when nothing crosses', async () => {
    const editor = solidEditor();
    draw(editor.session.doc, rectangle(0, 0, 1, 1));
    editor.selectAll();
    await editor.runCommand('edit.intersectWithSelection');
    expect(editor.commands.isEnabled('edit.intersectWithSelection', editor)).toBe(false);
    await editor.runCommand('edit.intersectWithModel');
    expect(editor.notifications.at(-1)?.kind).toBe('info');
  });
});

describe('Follow Me tool', () => {
  function profileAndPath(editor: Editor): EdgeId {
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 3));
    const result = insertSegments(doc, doc.rootDefinitionId, [{ a: vec3(5, 5, 0), b: vec3(5, 5, 3) }], {
      autoFace: false,
    });
    const [edge] = result.segmentEdges.flat();
    if (edge === undefined) throw new Error('path edge missing');
    return edge;
  }

  it('sweeps the clicked profile face along the preselected path', () => {
    const editor = solidEditor();
    const doc = editor.session.doc;
    const edge = profileAndPath(editor);
    editor.session.setSelection(Selection.of([{ kind: 'edge', id: edge }]));
    const depth = doc.undoDepth;
    editor.activateTool(FOLLOW_ME_TOOL_ID);
    expect(editor.tools.statusHint).toMatch(/profile face/);
    const screen = screenOf(2, 2);
    click(editor, screen.x, screen.y);
    expect(counts(doc)).toEqual({ v: 10, e: 13, f: 6 });
    expect(doc.undoDepth).toBe(depth + 1);
    expect(Math.abs(solidVolume(doc.rootStore))).toBeCloseTo(12, 9);
    expect(editor.session.selection.count('face')).toBe(6);
    expect(validateDocument(doc).problems).toEqual([]);
  });

  it('sweeps along edges dragged over after pressing on the profile', () => {
    const editor = solidEditor();
    const doc = editor.session.doc;
    profileAndPath(editor);
    editor.activateTool(FOLLOW_ME_TOOL_ID);
    const face = screenOf(2, 2);
    const pathScreen = screenOf(5, 5);
    editor.tools.pointerDown(pointer(face.x, face.y));
    editor.tools.pointerMove(pointer(pathScreen.x, pathScreen.y));
    expect(editor.session.preview?.highlight.some((ref) => ref.kind === 'edge')).toBe(true);
    editor.tools.pointerUp(pointer(pathScreen.x, pathScreen.y, { buttons: 0 }));
    expect(counts(doc)).toEqual({ v: 10, e: 13, f: 6 });
  });

  it('shows the refusal as an error and leaves the model unchanged', () => {
    const editor = solidEditor();
    const doc = editor.session.doc;
    draw(doc, rectangle(1, 1, 3, 3));
    const result = insertSegments(doc, doc.rootDefinitionId, [{ a: vec3(5, 5, 0), b: vec3(8, 5, 0) }], {
      autoFace: false,
    });
    editor.session.setSelection(
      Selection.of(result.segmentEdges.flat().map((id) => ({ kind: 'edge' as const, id }))),
    );
    const before = hashDocument(doc);
    editor.activateTool(FOLLOW_ME_TOOL_ID);
    const screen = screenOf(2, 2);
    click(editor, screen.x, screen.y);
    expect(editor.notifications.at(-1)).toMatchObject({
      kind: 'error',
      message: expect.stringMatching(/parallel/),
    });
    expect(hashDocument(doc)).toBe(before);
    expect(faceIds(doc.rootStore)).toHaveLength(1);
  });
});
