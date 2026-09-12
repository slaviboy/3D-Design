import { PLANAR_FILE_EXTENSION, PLANAR_MIME_TYPE } from '../format/planarFile';
import type { FileAccess, OpenedFile, SavedFile } from './types';

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

function download(doc: Document, bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes.slice()], { type: PLANAR_MIME_TYPE });
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
  };
}
