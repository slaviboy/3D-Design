import { describe, expect, it, vi } from 'vitest';
import { AutosaveController, DEFAULT_AUTOSAVE_INTERVAL_MS } from '../../src/app/autosave/AutosaveController';
import { SAMPLE_MODEL_NAME } from '../../src/app/sample/sampleModel';
import { Selection } from '../../src/app/selection/Selection';
import { createEditorStore } from '../../src/app/stores/editorStore';
import { DRAG_THRESHOLD_PX, selectionModeFor } from '../../src/app/tools/SelectTool';
import {
  MIDDLE_BUTTON,
  ORBIT_TOOL_ID,
  PAN_TOOL_ID,
  SELECT_TOOL_ID,
  ZOOM_TOOL_ID,
} from '../../src/app/tools/Tool';
import { hashDocument } from '../../src/kernel/model/snapshot';
import { validateDocument } from '../../src/kernel/model/validate';
import { draw, rectangle } from '../kernel/helpers';
import {
  click,
  createTestEditor,
  drag,
  MemoryFileAccess,
  MemoryRecoveryRepository,
  pointer,
  screenOf,
  TOP_CAMERA,
} from './fixtures';

const keyInput = (key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => ({
  key,
  ctrlKey: modifiers.ctrlKey ?? false,
  metaKey: false,
  altKey: false,
  shiftKey: modifiers.shiftKey ?? false,
});

function editorWithRectangle() {
  const editor = createTestEditor();
  const doc = editor.session.doc;
  draw(doc, rectangle(-2, -2, 2, 2));
  const store = doc.rootStore;
  const faceId = [...store.faces()][0]?.id ?? 0;
  return { editor, doc, store, faceId };
}

describe('Select tool', () => {
  it('maps modifiers to selection modes per platform', () => {
    expect(selectionModeFor({ shiftKey: false, ctrlKey: true, altKey: false }, 'other')).toBe('add');
    expect(selectionModeFor({ shiftKey: false, ctrlKey: false, altKey: true }, 'mac')).toBe('add');
    expect(selectionModeFor({ shiftKey: true, ctrlKey: false, altKey: false }, 'other')).toBe('toggle');
    expect(selectionModeFor({ shiftKey: true, ctrlKey: true, altKey: false }, 'other')).toBe('subtract');
    expect(selectionModeFor({ shiftKey: false, ctrlKey: false, altKey: false }, 'mac')).toBe('replace');
  });

  it('selects with single, double and triple clicks, and clears on empty space', () => {
    const { editor, faceId } = editorWithRectangle();
    const center = screenOf(0, 0);
    click(editor, center.x, center.y);
    expect(editor.session.selection.refs()).toEqual([{ kind: 'face', id: faceId }]);
    click(editor, center.x, center.y, { detail: 2 });
    expect(editor.session.selection.size).toBe(5);
    click(editor, center.x, center.y, { detail: 3 });
    expect(editor.session.selection.size).toBe(5);
    const outside = screenOf(4.5, 4.5);
    click(editor, outside.x, outside.y);
    expect(editor.session.selection.isEmpty).toBe(true);
  });

  it('adds, toggles and subtracts with modifiers', () => {
    const { editor, faceId } = editorWithRectangle();
    const center = screenOf(0, 0);
    const edgePoint = screenOf(2, 0);
    click(editor, center.x, center.y);
    click(editor, edgePoint.x, edgePoint.y, { ctrlKey: true });
    expect(editor.session.selection.size).toBe(2);
    click(editor, center.x, center.y, { shiftKey: true });
    expect(editor.session.selection.has({ kind: 'face', id: faceId })).toBe(false);
    click(editor, edgePoint.x, edgePoint.y, { shiftKey: true, ctrlKey: true });
    expect(editor.session.selection.isEmpty).toBe(true);
    click(editor, 199, 199, { ctrlKey: true });
    expect(editor.session.selection.isEmpty).toBe(true);
  });

  it('box-selects after the drag threshold, shows an overlay, and ignores tiny drags', () => {
    const { editor } = editorWithRectangle();
    editor.tools.pointerDown(pointer(10, 10));
    editor.tools.pointerMove(pointer(190, 190));
    expect(editor.tools.overlay).toMatchObject({ kind: 'selection-rectangle', mode: 'window' });
    editor.tools.pointerUp(pointer(190, 190));
    expect(editor.session.selection.size).toBe(5);
    expect(editor.tools.overlay).toBeNull();

    const center = screenOf(0, 0);
    drag(editor, center, { x: center.x + DRAG_THRESHOLD_PX - 1, y: center.y });
    expect(editor.session.selection.refs()).toEqual([expect.objectContaining({ kind: 'face' })]);

    drag(editor, screenOf(1, 1), screenOf(-1, -1));
    expect(editor.session.selection.refs()).toEqual([expect.objectContaining({ kind: 'face' })]);
  });

  it('Escape cancels a drag in progress, then clears the selection', () => {
    const { editor } = editorWithRectangle();
    editor.selectAll();
    editor.tools.pointerDown(pointer(10, 10));
    editor.tools.pointerMove(pointer(150, 150));
    expect(editor.handleKey(keyInput('Escape'))).toBe(true);
    expect(editor.tools.overlay).toBeNull();
    expect(editor.session.selection.isEmpty).toBe(false);
    editor.handleKey(keyInput('Escape'));
    expect(editor.session.selection.isEmpty).toBe(true);
  });
});

describe('Editor', () => {
  it('opens the sample model as a clean, valid document', async () => {
    const editor = createTestEditor();
    await editor.openSample();
    const { doc } = editor.session;
    expect(editor.session.documentName).toBe(SAMPLE_MODEL_NAME);
    expect(editor.session.isDirty).toBe(false);
    expect(doc.canUndo).toBe(false);
    expect(doc.rootStore.instanceCount).toBe(1);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('runs shortcuts: select all, delete, undo and redo', async () => {
    const { editor, doc } = editorWithRectangle();
    const before = hashDocument(doc);
    expect(editor.handleKey(keyInput('a', { ctrlKey: true }))).toBe(true);
    await Promise.resolve();
    expect(editor.session.selection.size).toBe(5);
    editor.handleKey(keyInput('Delete'));
    await Promise.resolve();
    expect(doc.rootStore.edgeCount).toBe(0);
    expect(editor.session.selection.isEmpty).toBe(true);
    editor.handleKey(keyInput('z', { ctrlKey: true }));
    await Promise.resolve();
    expect(hashDocument(doc)).toBe(before);
    editor.handleKey(keyInput('Z', { ctrlKey: true, shiftKey: true }));
    await Promise.resolve();
    expect(doc.rootStore.edgeCount).toBe(0);
    expect(editor.handleKey(keyInput('F9'))).toBe(false);
    expect(editor.handleKey(keyInput('Shift', { shiftKey: true }))).toBe(false);
  });

  it('deleting a group instance removes its definition', async () => {
    const editor = createTestEditor();
    await editor.openSample();
    editor.selectAll();
    editor.deleteSelection();
    expect([...editor.session.doc.definitions()]).toHaveLength(1);
    editor.undo();
    expect([...editor.session.doc.definitions()]).toHaveLength(2);
    editor.redo();
    expect(editor.session.doc.rootStore.instanceCount).toBe(0);
  });

  it('switches tools through commands and navigates with each of them', async () => {
    const editor = createTestEditor();
    for (const toolId of [ORBIT_TOOL_ID, PAN_TOOL_ID, ZOOM_TOOL_ID]) {
      await editor.runCommand(toolId);
      expect(editor.tools.activeToolId).toBe(toolId);
      expect(editor.commands.isChecked(toolId, editor)).toBe(true);
      const before = editor.session.camera;
      drag(editor, { x: 100, y: 100 }, { x: 130, y: 60 });
      expect(editor.session.camera).not.toEqual(before);
      expect(editor.tools.statusHint.length).toBeGreaterThan(0);
    }
    await editor.runCommand(SELECT_TOOL_ID);
    expect(editor.tools.activeToolId).toBe(SELECT_TOOL_ID);
  });

  it('orbits with the middle button and zooms with the wheel in any tool', () => {
    const editor = createTestEditor();
    const start = editor.session.camera;
    editor.tools.pointerDown(pointer(100, 100, { button: MIDDLE_BUTTON }));
    editor.tools.pointerMove(pointer(140, 100, { button: MIDDLE_BUTTON }));
    editor.tools.pointerUp(pointer(140, 100, { button: MIDDLE_BUTTON }));
    expect(editor.session.camera.eye).not.toEqual(start.eye);
    expect(editor.session.selection.isEmpty).toBe(true);
    editor.session.setCamera(TOP_CAMERA);
    editor.tools.pointerDown(pointer(100, 100, { button: MIDDLE_BUTTON, shiftKey: true }));
    editor.tools.pointerMove(pointer(120, 100, { button: MIDDLE_BUTTON, shiftKey: true }));
    editor.tools.pointerUp(pointer(120, 100, { button: MIDDLE_BUTTON }));
    expect(editor.session.camera.target.x).toBeLessThan(0);
    editor.tools.wheel({ x: 100, y: 100, deltaY: -100 });
    expect(editor.session.camera.orthoHalfHeight).toBeLessThan(TOP_CAMERA.orthoHalfHeight);
  });

  it('changes views and projection through commands', async () => {
    const editor = createTestEditor();
    await editor.openSample();
    await editor.runCommand('camera.view.top');
    expect(editor.session.camera.up).toEqual({ x: 0, y: 1, z: 0 });
    await editor.runCommand('camera.parallel');
    expect(editor.commands.isChecked('camera.parallel', editor)).toBe(true);
    await editor.runCommand('camera.perspective');
    await editor.runCommand('camera.zoomExtents');
    expect(editor.session.camera.projection).toBe('perspective');
  });

  it('saves to and reopens from a file', async () => {
    const files = new MemoryFileAccess();
    const editor = createTestEditor({ fileAccess: files });
    await editor.openSample();
    editor.selectAll();
    editor.deleteSelection();
    expect(editor.session.isDirty).toBe(true);
    expect(await editor.saveFile()).toBe(true);
    expect(editor.session.isDirty).toBe(false);
    expect(files.files.has('Sample House.planar')).toBe(true);
    expect(editor.notifications.at(-1)?.message).toBe('Saved Sample House.planar');

    const other = createTestEditor({ fileAccess: files });
    files.nextOpen = 'Sample House.planar';
    await other.openFile();
    expect(other.session.documentName).toBe('Sample House');
    expect(hashDocument(other.session.doc)).toBe(hashDocument(editor.session.doc));
    expect(await other.saveFileAs()).toBe(true);
  });

  it('reports invalid files without replacing the document', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    expect(editor.loadFile(new Uint8Array([1, 2, 3]), 'broken.planar')).toBe(false);
    expect(editor.session.doc).toBe(doc);
    expect(editor.notifications.at(-1)).toMatchObject({ kind: 'error' });
    editor.dismissNotification(editor.notifications.at(-1)?.id ?? 0);
    expect(editor.notifications).toHaveLength(0);
  });

  it('asks before discarding unsaved changes', async () => {
    const editor = createTestEditor({ confirm: false });
    draw(editor.session.doc, rectangle(0, 0, 1, 1));
    const doc = editor.session.doc;
    await editor.newDocument();
    expect(editor.session.doc).toBe(doc);
    const agreeing = createTestEditor({ confirm: true });
    draw(agreeing.session.doc, rectangle(0, 0, 1, 1));
    await agreeing.newDocument();
    expect(agreeing.session.doc.rootStore.faceCount).toBe(0);
    expect(await agreeing.saveFile()).toBe(false);
  });

  it('turns command failures into error notifications', async () => {
    const editor = createTestEditor();
    editor.commands.register({
      id: 'test.fail',
      label: 'Fail',
      category: 'Help',
      run: () => {
        throw new Error('boom');
      },
    });
    await editor.runCommand('test.fail');
    expect(editor.notifications.at(-1)).toMatchObject({ kind: 'error', message: 'boom' });
  });

  it('keeps the view-state store in sync', async () => {
    const editor = createTestEditor();
    const store = createEditorStore(editor);
    const requests = store.getState().commandPaletteRequests;
    await editor.runCommand('help.commandPalette');
    expect(store.getState().commandPaletteRequests).toBe(requests + 1);
    await editor.openSample();
    editor.selectAll();
    expect(store.getState()).toMatchObject({
      selectionTotal: 1,
      selectionInstances: 1,
      documentName: SAMPLE_MODEL_NAME,
    });
    editor.deleteSelection();
    expect(store.getState()).toMatchObject({ canUndo: true, undoLabel: 'Delete', isDirty: true });
    store.dispose();
  });

  it('prunes the selection when undo removes selected entities', () => {
    const editor = createTestEditor();
    draw(editor.session.doc, rectangle(0, 0, 1, 1));
    editor.selectAll();
    editor.undo();
    expect(editor.session.selection).toBe(Selection.EMPTY);
  });
});

describe('autosave', () => {
  it('writes versioned recovery snapshots only for unsaved changes and removes them after saving', async () => {
    const editor = createTestEditor({ fileAccess: new MemoryFileAccess() });
    const repository = new MemoryRecoveryRepository();
    let time = 1000;
    let tick: (() => void) | null = null;
    const autosave = new AutosaveController({
      session: editor.session,
      repository,
      encode: () => editor.encodeDocument(),
      sessionId: 'session-a',
      now: () => time,
      timers: {
        setInterval: (callback, milliseconds) => {
          expect(milliseconds).toBe(DEFAULT_AUTOSAVE_INTERVAL_MS);
          tick = callback;
          return 1;
        },
        clearInterval: vi.fn(),
      },
    });
    autosave.start();
    autosave.start();
    expect(await autosave.tick()).toBe(false);

    draw(editor.session.doc, rectangle(0, 0, 1, 1));
    expect(await autosave.tick()).toBe(true);
    expect(await autosave.tick()).toBe(false);
    expect([...repository.snapshots.values()]).toMatchObject([
      { sessionId: 'session-a', kind: 'autosave', documentName: 'Untitled', savedAt: 1000 },
    ]);

    for (const [index, start] of [2, 4, 6].entries()) {
      draw(editor.session.doc, rectangle(start, 0, start + 1, 1));
      time = 2000 + index * 1000;
      expect(tick).not.toBeNull();
      (tick as unknown as () => void)();
      await vi.waitFor(async () => {
        expect((await repository.list())[0]?.savedAt).toBe(time);
      });
    }
    // Three versions are kept per session; the newest restores the latest work.
    expect(repository.snapshots.size).toBe(3);
    const [newest] = await repository.list();
    expect(editor.loadFile(newest?.bytes ?? new Uint8Array(), 'x', null, { dirty: true })).toBe(true);
    expect([...editor.session.doc.rootStore.faces()]).toHaveLength(4);

    await editor.saveFile();
    await vi.waitFor(() => {
      expect(repository.snapshots.size).toBe(0);
    });
    autosave.stop();
  });

  it('keeps only the newest sessions and reports storage failures', async () => {
    const editor = createTestEditor();
    const repository = new MemoryRecoveryRepository();
    for (let i = 0; i < 4; i++) {
      await repository.put({
        id: `old-${String(i)}`,
        sessionId: `old-${String(i)}`,
        kind: 'autosave',
        documentName: 'x',
        savedAt: i,
        bytes: new Uint8Array(),
      });
    }
    const onError = vi.fn();
    const autosave = new AutosaveController({
      session: editor.session,
      repository,
      encode: () => editor.encodeDocument(),
      sessionId: 'current',
      keepSessions: 2,
      now: () => 100,
      onError,
    });
    draw(editor.session.doc, rectangle(0, 0, 1, 1));
    await autosave.tick();
    expect([...repository.snapshots.values()].map((snapshot) => snapshot.sessionId).sort()).toEqual([
      'current',
      'old-3',
    ]);

    const failing = new AutosaveController({
      session: editor.session,
      repository: {
        put: () => Promise.reject(new Error('quota')),
        list: () => repository.list(),
        delete: () => Promise.reject(new Error('gone')),
        deleteSession: () => Promise.reject(new Error('gone')),
        prune: () => Promise.resolve(),
      },
      encode: () => editor.encodeDocument(),
      sessionId: 'failing',
      onError,
    });
    expect(await failing.tick()).toBe(false);
    await failing.discard();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous save as a backup before saving over a file', async () => {
    const files = new MemoryFileAccess();
    const editor = createTestEditor({ fileAccess: files });
    const repository = new MemoryRecoveryRepository();
    editor.setBackupRepository(repository, 'tab');
    expect(editor.commands.isEnabled('file.backups', editor)).toBe(true);

    draw(editor.session.doc, rectangle(0, 0, 1, 1));
    await editor.saveFile();
    expect(repository.snapshots.size).toBe(0);

    draw(editor.session.doc, rectangle(2, 0, 3, 1));
    await editor.saveFile();
    const [backup] = await repository.list();
    expect(backup).toMatchObject({ kind: 'backup', sessionId: 'tab', documentName: 'Untitled' });
    const restored = createTestEditor();
    expect(restored.loadFile(backup?.bytes ?? new Uint8Array(), 'backup')).toBe(true);
    expect([...restored.session.doc.rootStore.faces()]).toHaveLength(1);

    await editor.saveFileAs();
    expect(repository.snapshots.size).toBe(1);
  });
});
