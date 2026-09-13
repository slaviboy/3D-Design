import type { FaceId, InstanceId } from '../../kernel/ids';
import { IDENTITY } from '../../kernel/math/mat4';
import { METERS_PER_UNIT, type LengthUnit } from '../../kernel/units/units';
import {
  EXPORT_FORMATS,
  exportFormatById,
  exportModel,
  safeFileName,
  type ExportFormat,
  type ExportFormatId,
} from '../../io/export/formats';
import { baseName, findMainFile, type InputFile } from '../../io/import/fileSet';
import { importAcceptedExtensions, type ImportFormat } from '../../io/import/formats';
import { DEFAULT_IMPORT_LIMITS, clampImageSize, type ImportLimits } from '../../io/mesh/limits';
import { insertImportedScene } from '../../io/mesh/sceneToKernel';
import type { FileAccess, FileTypeFilter } from '../../io/fs/types';
import type { Editor } from '../Editor';
import { Selection } from '../selection/Selection';
import { ImportCancelledError, WorkerImportEngine, type ImportEngine } from './importEngine';
import { MAX_IMAGE_EDGE, type ViewCapturePort } from './viewCapture';

/*
 * File > Import, File > Export 3D Model and File > Export 2D Graphic. The controller asks the UI for options
 * through `request`, runs the work, and reports the outcome as notifications. A failed import leaves the model
 * unchanged, because the whole import is one transaction.
 */

export interface ImportChoice {
  readonly unit: LengthUnit;
  readonly swapYUpToZUp: boolean;
  readonly mergeCoplanar: boolean;
  readonly as: 'group' | 'component';
}

export interface ModelExportChoice {
  readonly format: ExportFormatId;
  readonly fileName: string;
  readonly selectionOnly: boolean;
  readonly unit: LengthUnit;
  readonly swapZUpToYUp: boolean;
}

export interface ImageExportChoice {
  readonly fileName: string;
  readonly width: number;
  readonly height: number;
  readonly transparentBackground: boolean;
}

export type ExchangeRequest =
  | {
      readonly kind: 'import-options';
      readonly fileName: string;
      readonly format: ImportFormat;
      readonly submit: (choice: ImportChoice) => void;
    }
  | {
      readonly kind: 'export-model';
      readonly fileName: string;
      readonly formats: readonly ExportFormat[];
      readonly hasSelection: boolean;
      readonly submit: (choice: ModelExportChoice) => void;
    }
  | {
      readonly kind: 'export-image';
      readonly fileName: string;
      readonly width: number;
      readonly height: number;
      readonly maxEdge: number;
      readonly submit: (choice: ImageExportChoice) => void;
    }
  | {
      readonly kind: 'progress';
      readonly title: string;
      readonly message: string;
      /** Stops the work, when it can still be stopped. */
      readonly cancel: (() => void) | null;
    };

export interface ModelExchangeEnvironment {
  readonly fileAccess?: FileAccess;
  /** Parses imports. Defaults to the io worker, started on first use. */
  readonly importEngine?: ImportEngine;
  /** Renders the view for Export 2D Graphic. */
  readonly viewCapture?: ViewCapturePort;
  readonly importLimits?: Partial<ImportLimits>;
}

const MODEL_FILTER: FileTypeFilter = {
  description: '3D models',
  mimeType: 'application/octet-stream',
  extensions: importAcceptedExtensions(),
};

const MAX_LISTED_WARNINGS = 3;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

function stem(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export class ModelExchange {
  readonly #editor: Editor;
  readonly #environment: ModelExchangeEnvironment;
  readonly #listeners = new Set<() => void>();
  #request: ExchangeRequest | null = null;
  #engine: ImportEngine | null = null;

  constructor(editor: Editor, environment: ModelExchangeEnvironment) {
    this.#editor = editor;
    this.#environment = environment;
  }

  // ---------------------------------------------------------------------------------------------- state

  /** What the UI should show: an options dialog or import progress. */
  get request(): ExchangeRequest | null {
    return this.#request;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Closes an options dialog, or cancels a running import. */
  dismissRequest(): void {
    const request = this.#request;
    if (request?.kind === 'progress') {
      request.cancel?.();
      return;
    }
    this.#setRequest(null);
  }

  get limits(): ImportLimits {
    return { ...DEFAULT_IMPORT_LIMITS, ...this.#environment.importLimits };
  }

  get viewCapture(): ViewCapturePort | null {
    return this.#environment.viewCapture ?? null;
  }

  get canImport(): boolean {
    return this.#environment.fileAccess?.openFiles !== undefined;
  }

  get canExport(): boolean {
    return this.#environment.fileAccess !== undefined;
  }

  #setRequest(request: ExchangeRequest | null): void {
    this.#request = request;
    for (const listener of [...this.#listeners]) listener();
  }

  #importEngine(): ImportEngine {
    this.#engine ??= this.#environment.importEngine ?? new WorkerImportEngine();
    return this.#engine;
  }

  // ---------------------------------------------------------------------------------------------- import

  /** File > Import…: pick files, choose options, import. */
  async importModel(): Promise<void> {
    const access = this.#environment.fileAccess;
    if (!access?.openFiles) {
      this.#editor.notify('error', 'Importing files is not available here');
      return;
    }
    const picked = await access.openFiles(MODEL_FILTER);
    if (!picked || picked.length === 0) return;
    this.chooseImportOptions(picked.map((file) => ({ name: file.name, bytes: file.bytes })));
  }

  /** Shows the import options for these files. Returns false (and notifies) when they can't be imported. */
  chooseImportOptions(files: readonly InputFile[]): boolean {
    let main;
    try {
      main = findMainFile(files, this.limits);
    } catch (error) {
      this.#editor.notify('error', `Could not import: ${errorMessage(error)}`);
      return false;
    }
    this.#setRequest({
      kind: 'import-options',
      fileName: baseName(main.name),
      format: main.format,
      submit: (choice) => {
        void this.importFiles(files, choice);
      },
    });
    return true;
  }

  /**
   * Imports files with the given options and selects the new group. Returns false when the import failed or was
   * cancelled; the model is then unchanged.
   */
  async importFiles(files: readonly InputFile[], choice: ImportChoice): Promise<boolean> {
    const editor = this.#editor;
    const limits = this.limits;
    let main;
    try {
      main = findMainFile(files, limits);
    } catch (error) {
      this.#setRequest(null);
      editor.notify('error', `Could not import: ${errorMessage(error)}`);
      return false;
    }
    const fileName = baseName(main.name);
    const engine = this.#importEngine();
    const state = { cancelled: false };
    this.#setRequest({
      kind: 'progress',
      title: 'Importing',
      message: `Reading ${fileName}…`,
      cancel: () => {
        state.cancelled = true;
        engine.cancel();
      },
    });
    try {
      const scene = await engine.parse(files, limits);
      if (state.cancelled) throw new ImportCancelledError();
      this.#setRequest({
        kind: 'progress',
        title: 'Importing',
        message: `Building faces from ${fileName}…`,
        cancel: null,
      });
      // Let the progress message paint before the synchronous geometry work.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const { session } = editor;
      editor.tools.cancel();
      const fromFile = main.format.unitsFromFile;
      const summary = insertImportedScene(session.doc, session.activeContext, scene, {
        name: stem(main.name),
        unitMeters: fromFile ? (scene.unitMeters ?? 1) : METERS_PER_UNIT[choice.unit],
        swapYUpToZUp: fromFile ? scene.upAxis === 'y' : choice.swapYUpToZUp,
        mergeCoplanar: choice.mergeCoplanar,
        as: choice.as,
        limits,
        tagId: session.activeTagId,
      });
      session.setSelection(Selection.of([{ kind: 'instance', id: summary.instance }]));
      const parts = [plural(summary.faces, 'face')];
      if (summary.groups > 0) parts.push(plural(summary.groups, 'group'));
      if (summary.components > 0) parts.push(plural(summary.components, 'component'));
      if (summary.materials > 0) parts.push(plural(summary.materials, 'material'));
      let message = `Imported ${fileName}: ${parts.join(', ')}`;
      if (summary.degenerateTriangles > 0) {
        message += `. Dropped ${plural(summary.degenerateTriangles, 'degenerate triangle')}`;
      }
      editor.notify('info', message);
      const warnings = [...scene.warnings, ...summary.warnings];
      for (const warning of warnings.slice(0, MAX_LISTED_WARNINGS)) editor.notify('info', warning);
      if (warnings.length > MAX_LISTED_WARNINGS) {
        editor.notify('info', `…and ${plural(warnings.length - MAX_LISTED_WARNINGS, 'more warning')}`);
      }
      return true;
    } catch (error) {
      if (state.cancelled || error instanceof ImportCancelledError)
        editor.notify('info', `Import of ${fileName} cancelled`);
      else editor.notify('error', `Could not import ${fileName}: ${errorMessage(error)}`);
      return false;
    } finally {
      if (this.#request?.kind === 'progress') this.#setRequest(null);
    }
  }

  // ---------------------------------------------------------------------------------------------- 3D export

  /** File > Export 3D Model…: asks for format and options. */
  requestModelExport(): void {
    if (!this.canExport) {
      this.#editor.notify('error', 'Saving files is not available here');
      return;
    }
    const { session } = this.#editor;
    this.#setRequest({
      kind: 'export-model',
      fileName: session.documentName,
      formats: EXPORT_FORMATS,
      hasSelection: session.selection.count('face') + session.selection.count('instance') > 0,
      submit: (choice) => {
        void this.exportModelFiles(choice);
      },
    });
  }

  /** Writes the export and saves (or downloads) each file. Returns false on failure or cancellation. */
  async exportModelFiles(choice: ModelExportChoice): Promise<boolean> {
    this.#setRequest(null);
    const editor = this.#editor;
    const access = this.#environment.fileAccess;
    if (!access) return false;
    const { session } = editor;
    const format = exportFormatById(choice.format);
    try {
      const files = exportModel(
        choice.selectionOnly
          ? {
              doc: session.doc,
              context: session.activeContext,
              contextTransform: session.activeContextTransform,
              selection: {
                faces: session.selection.ids('face') as FaceId[],
                instances: session.selection.ids('instance') as InstanceId[],
              },
              name: session.documentName,
            }
          : {
              doc: session.doc,
              context: session.doc.rootDefinitionId,
              contextTransform: IDENTITY,
              name: session.documentName,
            },
        {
          format: choice.format,
          fileName: choice.fileName,
          unit: choice.unit,
          swapZUpToYUp: choice.swapZUpToYUp,
        },
        `Planar ${editor.appVersion}`,
      );
      const saved: string[] = [];
      for (const file of files) {
        const filter: FileTypeFilter = {
          description: format.label,
          mimeType: file.mimeType,
          extensions: [file.name.slice(file.name.lastIndexOf('.'))],
        };
        const result = access.saveCopy
          ? await access.saveCopy(file.bytes, file.name, filter)
          : await access.save(file.bytes, file.name, null);
        if (!result) return false;
        saved.push(result.name);
      }
      editor.notify('info', `Exported ${saved.join(' and ')}`);
      return true;
    } catch (error) {
      editor.notify('error', `Could not export: ${errorMessage(error)}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------------------------------- 2D export

  /** File > Export 2D Graphic…: asks for image size and background. */
  requestImageExport(): void {
    if (!this.canExport) {
      this.#editor.notify('error', 'Saving files is not available here');
      return;
    }
    if (!this.viewCapture?.available) {
      this.#editor.notify('error', 'The 3D view is not available, so there is nothing to export');
      return;
    }
    const size = clampImageSize(
      this.#editor.viewportSize.width,
      this.#editor.viewportSize.height,
      MAX_IMAGE_EDGE,
    );
    this.#setRequest({
      kind: 'export-image',
      fileName: this.#editor.session.documentName,
      width: size.width,
      height: size.height,
      maxEdge: MAX_IMAGE_EDGE,
      submit: (choice) => {
        void this.exportImage(choice);
      },
    });
  }

  /** Renders the view to a PNG and saves (or downloads) it. Returns false on failure or cancellation. */
  async exportImage(choice: ImageExportChoice): Promise<boolean> {
    this.#setRequest(null);
    const editor = this.#editor;
    const access = this.#environment.fileAccess;
    const capture = this.viewCapture;
    if (!access || !capture) return false;
    try {
      if (
        !Number.isFinite(choice.width) ||
        !Number.isFinite(choice.height) ||
        choice.width < 1 ||
        choice.height < 1
      ) {
        throw new Error('Enter an image width and height of at least 1 pixel');
      }
      const size = clampImageSize(choice.width, choice.height, MAX_IMAGE_EDGE);
      const blob = await capture.capture({ ...size, transparentBackground: choice.transparentBackground });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const name = `${safeFileName(choice.fileName, '.png')}.png`;
      const filter: FileTypeFilter = {
        description: 'PNG image',
        mimeType: 'image/png',
        extensions: ['.png'],
      };
      const result = access.saveCopy
        ? await access.saveCopy(bytes, name, filter)
        : await access.save(bytes, name, null);
      if (!result) return false;
      editor.notify('info', `Exported ${result.name} (${String(size.width)} × ${String(size.height)})`);
      return true;
    } catch (error) {
      editor.notify('error', `Could not export the image: ${errorMessage(error)}`);
      return false;
    }
  }
}
