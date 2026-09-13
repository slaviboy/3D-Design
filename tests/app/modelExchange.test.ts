import { describe, expect, it, vi } from 'vitest';
import { Editor } from '../../src/app/Editor';
import { createDirectImportEngine, type ImportParser } from '../../src/app/io/importEngine';
import type { ImportChoice } from '../../src/app/io/ModelExchange';
import { ViewCaptureRelay, type ViewCapturePort } from '../../src/app/io/viewCapture';
import { insertSegments } from '../../src/kernel/ops/insertSegments';
import type { FileAccess, FileTypeFilter, OpenedFile, SavedFile } from '../../src/io/fs/types';
import { parseImportFiles } from '../../src/io/import/parseImport';
import type { ImportLimits } from '../../src/io/mesh/limits';
import { boxEdges } from '../kernel/helpers';
import { fixture } from '../io/importHelpers';
import { MemoryFileAccess } from './fixtures';

class ExchangeFileAccess implements FileAccess {
  picks: OpenedFile[] | null = null;
  readonly saved: { name: string; bytes: Uint8Array; filter: FileTypeFilter | null }[] = [];

  open(): Promise<OpenedFile | null> {
    return Promise.resolve(null);
  }

  save(bytes: Uint8Array, suggestedName: string): Promise<SavedFile | null> {
    this.saved.push({ name: suggestedName, bytes, filter: null });
    return Promise.resolve({ name: suggestedName, handle: null });
  }

  openFiles(): Promise<OpenedFile[] | null> {
    return Promise.resolve(this.picks);
  }

  saveCopy(bytes: Uint8Array, suggestedName: string, filter: FileTypeFilter): Promise<SavedFile | null> {
    this.saved.push({ name: suggestedName, bytes, filter });
    return Promise.resolve({ name: suggestedName, handle: null });
  }
}

const CHOICE: ImportChoice = { unit: 'm', swapYUpToZUp: true, mergeCoplanar: true, as: 'group' };

function createEditor(
  options: {
    fileAccess?: FileAccess;
    parser?: ImportParser;
    viewCapture?: ViewCapturePort;
    importLimits?: Partial<ImportLimits>;
  } = {},
): Editor {
  const editor = new Editor({
    platform: 'other',
    appVersion: '0.0.0-test',
    fileAccess: options.fileAccess ?? new ExchangeFileAccess(),
    importEngine: createDirectImportEngine(options.parser ?? parseImportFiles),
    ...(options.viewCapture ? { viewCapture: options.viewCapture } : {}),
    ...(options.importLimits ? { importLimits: options.importLimits } : {}),
  });
  editor.setViewportSize({ width: 640, height: 480 });
  return editor;
}

const messages = (editor: Editor, kind: 'info' | 'error'): string[] =>
  editor.notifications
    .filter((notification) => notification.kind === kind)
    .map((notification) => notification.message);

function drawBox(editor: Editor): void {
  const doc = editor.session.doc;
  doc.transact('Box', () =>
    insertSegments(doc, doc.rootDefinitionId, boxEdges(0, 0, 0, 1, 1, 1), { autoFace: true }),
  );
}

describe('File > Import', () => {
  it('asks for options, then adds the model as one selected, undoable group', async () => {
    const access = new ExchangeFileAccess();
    access.picks = [
      { ...fixture('cube.obj'), handle: null },
      { ...fixture('cube.mtl'), handle: null },
    ];
    const editor = createEditor({ fileAccess: access });
    expect(editor.commands.isEnabled('file.import', editor)).toBe(true);
    await editor.runCommand('file.import');
    const request = editor.exchange.request;
    expect(request).toMatchObject({
      kind: 'import-options',
      fileName: 'cube.obj',
      format: { id: 'obj', defaultSwapYUpToZUp: true },
    });
    if (request?.kind !== 'import-options') throw new Error('expected import options');
    request.submit(CHOICE);
    expect(editor.exchange.request?.kind).toBe('progress');
    await vi.waitFor(() => {
      expect(editor.exchange.request).toBeNull();
    });

    const { doc, selection } = editor.session;
    expect(messages(editor, 'error')).toEqual([]);
    expect(messages(editor, 'info')).toContain('Imported cube.obj: 6 faces, 1 group, 2 materials');
    expect(doc.rootStore.instanceCount).toBe(1);
    const [instance] = doc.rootStore.instances();
    expect(selection.refs()).toEqual([{ kind: 'instance', id: instance?.id }]);
    expect(doc.getDefinition(instance?.definitionId ?? doc.rootDefinitionId).attributes).toEqual({
      name: 'cube',
      isGroup: true,
    });
    expect(doc.undoLabel).toBe('Import');
    editor.undo();
    expect(doc.rootStore.instanceCount).toBe(0);
    expect([...doc.materials()]).toHaveLength(0);
  });

  it('reports a damaged file and leaves the model unchanged', async () => {
    const editor = createEditor();
    const ok = await editor.exchange.importFiles(
      [{ name: 'broken.glb', bytes: new TextEncoder().encode('glTF this is not a model') }],
      CHOICE,
    );
    expect(ok).toBe(false);
    expect(messages(editor, 'error')).toEqual([expect.stringMatching(/^Could not import broken\.glb: /)]);
    expect(editor.session.doc.canUndo).toBe(false);
    expect(editor.session.doc.rootStore.instanceCount).toBe(0);
    expect(editor.exchange.request).toBeNull();
  });

  it('refuses files over the size limit before asking for options', () => {
    const editor = createEditor({ importLimits: { maxFileBytes: 64 } });
    expect(editor.exchange.chooseImportOptions([fixture('cube.obj')])).toBe(false);
    expect(messages(editor, 'error')).toEqual([expect.stringContaining('larger than the import limit')]);
    expect(editor.exchange.request).toBeNull();
  });

  it('applies a configured triangle limit with a clear message', async () => {
    const editor = createEditor({ importLimits: { maxTriangles: 4 } });
    expect(await editor.exchange.importFiles([fixture('tetra.stl')], { ...CHOICE, unit: 'mm' })).toBe(true);
    expect(await editor.exchange.importFiles([fixture('cube.obj')], CHOICE)).toBe(false);
    expect(messages(editor, 'error')).toEqual([expect.stringContaining('than the import limit of 4')]);
    expect(editor.session.doc.rootStore.instanceCount).toBe(1);
  });

  it('can be cancelled while the file is being read', async () => {
    let release: (() => void) | undefined;
    const slowParser: ImportParser = async (files, limits) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return parseImportFiles(files, limits);
    };
    const editor = createEditor({ parser: slowParser });
    const importing = editor.exchange.importFiles([fixture('tetra.stl')], CHOICE);
    await vi.waitFor(() => {
      expect(release).toBeDefined();
    });
    expect(editor.exchange.request).toMatchObject({ kind: 'progress', message: 'Reading tetra.stl…' });
    editor.exchange.dismissRequest();
    release?.();
    expect(await importing).toBe(false);
    expect(messages(editor, 'info')).toContain('Import of tetra.stl cancelled');
    expect(editor.session.doc.rootStore.instanceCount).toBe(0);
  });

  it('uses the units and up axis a COLLADA file declares', async () => {
    const editor = createEditor();
    expect(
      await editor.exchange.importFiles([fixture('components.dae')], {
        ...CHOICE,
        unit: 'km',
        swapYUpToZUp: true,
      }),
    ).toBe(true);
    const [instance] = editor.session.doc.rootStore.instances();
    expect(instance).toBeDefined();
    const component = [...editor.session.doc.definitions()].find(
      (definition) => !definition.attributes.isGroup && definition.store.faceCount > 0,
    );
    const xs = [...(component?.store.vertices() ?? [])].map((vertex) => vertex.position.x);
    expect(Math.max(...xs)).toBeCloseTo(1, 9);
  });
});

describe('File > Export 3D Model', () => {
  it('offers every export format and saves a binary STL through the save fallback', async () => {
    const access = new ExchangeFileAccess();
    const editor = createEditor({ fileAccess: access });
    drawBox(editor);
    await editor.runCommand('file.exportModel');
    const request = editor.exchange.request;
    expect(request).toMatchObject({ kind: 'export-model', fileName: 'Untitled', hasSelection: false });
    if (request?.kind !== 'export-model') throw new Error('expected export options');
    expect(request.formats.map((format) => format.id)).toEqual([
      'glb',
      'gltf',
      'obj',
      'stl',
      'stl-ascii',
      'dae',
    ]);
    expect(
      await editor.exchange.exportModelFiles({
        format: 'stl',
        fileName: 'Untitled',
        selectionOnly: false,
        unit: 'mm',
        swapZUpToYUp: false,
      }),
    ).toBe(true);
    expect(access.saved.map((file) => [file.name, file.bytes.byteLength, file.filter?.mimeType])).toEqual([
      ['Untitled.stl', 84 + 12 * 50, 'model/stl'],
    ]);
    expect(messages(editor, 'info')).toContain('Exported Untitled.stl');
  });

  it('saves the OBJ and its MTL, using plain save when the platform has no separate export save', async () => {
    const access = new MemoryFileAccess();
    const editor = createEditor({ fileAccess: access });
    drawBox(editor);
    await editor.exchange.exportModelFiles({
      format: 'obj',
      fileName: 'Box',
      selectionOnly: false,
      unit: 'm',
      swapZUpToYUp: true,
    });
    expect([...access.files.keys()]).toEqual(['Box.obj', 'Box.mtl']);
  });

  it('reports an empty export as an error', async () => {
    const editor = createEditor();
    expect(
      await editor.exchange.exportModelFiles({
        format: 'glb',
        fileName: 'x',
        selectionOnly: false,
        unit: 'm',
        swapZUpToYUp: true,
      }),
    ).toBe(false);
    expect(messages(editor, 'error')).toEqual(['Could not export: The model has no visible faces to export']);
  });
});

describe('File > Export 2D Graphic', () => {
  it('captures the view at the requested size, clamped, and saves a PNG', async () => {
    const access = new ExchangeFileAccess();
    const capture = vi.fn(() =>
      Promise.resolve(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })),
    );
    const editor = createEditor({ fileAccess: access, viewCapture: { available: true, capture } });
    await editor.runCommand('file.exportImage');
    expect(editor.exchange.request).toMatchObject({
      kind: 'export-image',
      width: 640,
      height: 480,
      maxEdge: 8192,
    });
    expect(
      await editor.exchange.exportImage({
        fileName: 'View',
        width: 16384,
        height: 2000,
        transparentBackground: true,
      }),
    ).toBe(true);
    expect(capture).toHaveBeenCalledWith({ width: 8192, height: 1000, transparentBackground: true });
    expect(access.saved.map((file) => [file.name, file.bytes.byteLength, file.filter?.mimeType])).toEqual([
      ['View.png', 4, 'image/png'],
    ]);
  });

  it('reports that there is no view to capture', async () => {
    const editor = createEditor({ viewCapture: new ViewCaptureRelay() });
    await editor.runCommand('file.exportImage');
    expect(editor.exchange.request).toBeNull();
    expect(messages(editor, 'error')).toEqual([expect.stringContaining('The 3D view is not available')]);
  });

  it('forwards captures to the attached view until it detaches', async () => {
    const relay = new ViewCaptureRelay();
    const detach = relay.attach(() => Promise.resolve(new Blob(['png'])));
    expect(relay.available).toBe(true);
    await expect(
      relay.capture({ width: 1, height: 1, transparentBackground: false }),
    ).resolves.toBeInstanceOf(Blob);
    detach();
    expect(relay.available).toBe(false);
    await expect(relay.capture({ width: 1, height: 1, transparentBackground: false })).rejects.toThrow();
  });
});
