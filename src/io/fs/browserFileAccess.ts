import { PLANAR_FILE_EXTENSION, PLANAR_MIME_TYPE } from '../format/planarFile';
import type { FileAccess, FileTypeFilter, OpenedFile, SavedFile } from './types';

/*
 * File access in the browser. Chromium-based browsers get the File System Access API, so Save writes back to the
 * opened file. Other browsers fall back to a file input for opening and a download for saving.
 */

interface WritableFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }>;
}

interface PickerOptions {
  readonly types?: readonly {
    readonly description: string;
    readonly accept: Record<string, readonly string[]>;
  }[];
  readonly suggestedName?: string;
  readonly excludeAcceptAllOption?: boolean;
  readonly multiple?: boolean;
}

interface FileSystemAccessWindow {
  showOpenFilePicker?: (options: PickerOptions) => Promise<WritableFileHandle[]>;
  showSaveFilePicker?: (options: PickerOptions) => Promise<WritableFileHandle>;
}

const PICKER_TYPES = [
  { description: 'Planar model', accept: { [PLANAR_MIME_TYPE]: [PLANAR_FILE_EXTENSION] } },
] as const;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

interface PermissionedHandle extends WritableFileHandle {
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

function isReadableHandle(handle: unknown): handle is PermissionedHandle {
  return (
    typeof handle === 'object' &&
    handle !== null &&
    typeof (handle as { getFile?: unknown }).getFile === 'function'
  );
}

function isWritableHandle(handle: unknown): handle is WritableFileHandle {
  return (
    typeof handle === 'object' &&
    handle !== null &&
    typeof (handle as { createWritable?: unknown }).createWritable === 'function'
  );
}

async function readFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function pickWithInput(doc: Document): Promise<File | null> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = PLANAR_FILE_EXTENSION;
    input.style.display = 'none';
    const finish = (file: File | null): void => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => {
      finish(input.files?.[0] ?? null);
    });
    input.addEventListener('cancel', () => {
      finish(null);
    });
    doc.body.append(input);
    input.click();
  });
}

function pickManyWithInput(doc: Document, accept: string): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = accept;
    input.style.display = 'none';
    const finish = (files: File[] | null): void => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => {
      finish(input.files ? [...input.files] : null);
    });
    input.addEventListener('cancel', () => {
      finish(null);
    });
    doc.body.append(input);
    input.click();
  });
}

function download(doc: Document, bytes: Uint8Array, name: string, mimeType: string = PLANAR_MIME_TYPE): void {
  const blob = new Blob([bytes.slice()], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';
  doc.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke later so the browser has started the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export function createBrowserFileAccess(win: Window & FileSystemAccessWindow = window): FileAccess {
  return {
    async open(): Promise<OpenedFile | null> {
      if (win.showOpenFilePicker) {
        try {
          const [handle] = await win.showOpenFilePicker({ types: PICKER_TYPES });
          if (!handle) return null;
          const file = await handle.getFile();
          return { name: file.name, bytes: await readFile(file), handle };
        } catch (error) {
          if (isAbort(error)) return null;
          throw error;
        }
      }
      const file = await pickWithInput(win.document);
      return file ? { name: file.name, bytes: await readFile(file), handle: null } : null;
    },

    async openHandle(handle: unknown): Promise<OpenedFile | null> {
      if (!isReadableHandle(handle)) return null;
      try {
        const options = { mode: 'readwrite' as const };
        if (handle.queryPermission && (await handle.queryPermission(options)) !== 'granted') {
          if (!handle.requestPermission || (await handle.requestPermission(options)) !== 'granted')
            return null;
        }
        const file = await handle.getFile();
        return { name: file.name, bytes: await readFile(file), handle };
      } catch {
        // Moved, deleted or refused: the caller reports that the file couldn't be opened.
        return null;
      }
    },

    async save(bytes: Uint8Array, suggestedName: string, handle: unknown): Promise<SavedFile | null> {
      try {
        let target = isWritableHandle(handle) ? handle : null;
        if (!target && win.showSaveFilePicker) {
          target = await win.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
        }
        if (target) {
          const writable = await target.createWritable();
          await writable.write(bytes.slice());
          await writable.close();
          return { name: target.name, handle: target };
        }
      } catch (error) {
        if (isAbort(error)) return null;
        throw error;
      }
      download(win.document, bytes, suggestedName);
      return { name: suggestedName, handle: null };
    },

    async openFiles(filter: FileTypeFilter): Promise<OpenedFile[] | null> {
      if (win.showOpenFilePicker) {
        try {
          const handles = await win.showOpenFilePicker({
            multiple: true,
            types: [{ description: filter.description, accept: { [filter.mimeType]: filter.extensions } }],
          });
          const files = await Promise.all(handles.map((handle) => handle.getFile()));
          return await Promise.all(
            files.map(async (file) => ({ name: file.name, bytes: await readFile(file), handle: null })),
          );
        } catch (error) {
          if (isAbort(error)) return null;
          throw error;
        }
      }
      const files = await pickManyWithInput(win.document, filter.extensions.join(','));
      return files
        ? Promise.all(
            files.map(async (file) => ({ name: file.name, bytes: await readFile(file), handle: null })),
          )
        : null;
    },

    async saveCopy(
      bytes: Uint8Array,
      suggestedName: string,
      filter: FileTypeFilter,
    ): Promise<SavedFile | null> {
      if (win.showSaveFilePicker) {
        try {
          const target = await win.showSaveFilePicker({
            suggestedName,
            types: [{ description: filter.description, accept: { [filter.mimeType]: filter.extensions } }],
          });
          const writable = await target.createWritable();
          await writable.write(bytes.slice());
          await writable.close();
          return { name: target.name, handle: null };
        } catch (error) {
          if (isAbort(error)) return null;
          throw error;
        }
      }
      download(win.document, bytes, suggestedName, filter.mimeType);
      return { name: suggestedName, handle: null };
    },
  };
}
