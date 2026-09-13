import { unzipSync } from 'fflate';
import { ImportError, type ImportLimits } from '../mesh/limits';
import { extensionOf, importFormatFor, ZIP_EXTENSION, type ImportFormat } from './formats';

/*
 * The files the user picked for one import. Referenced resources (MTL files, glTF buffers, textures) are looked up
 * only among these files, never fetched. Zips are expanded with the same size limits as loose files.
 */

export interface InputFile {
  /** Path inside the selection: a plain file name, or a path inside a zip. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface MainFile {
  readonly file: InputFile;
  readonly format: ImportFormat;
}

const megabytes = (bytes: number): string => `${String(Math.round(bytes / (1024 * 1024)))} MB`;

/** Rejects absolute paths, parent-directory segments, drive letters and backslashes. */
export function isSafeRelativePath(name: string): boolean {
  if (name === '' || name.startsWith('/') || name.includes('\\') || /^[a-zA-Z]:/.test(name)) return false;
  return !name.split('/').some((segment) => segment === '..');
}

/** A reference that points outside the picked files: a URL with a scheme (other than data:) or a protocol-relative one. */
export function isExternalReference(reference: string): boolean {
  const trimmed = reference.trim();
  if (trimmed.startsWith('//')) return true;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  return scheme !== null && scheme[1]?.toLowerCase() !== 'data' && !/^[a-zA-Z]:[\\/]/.test(trimmed);
}

function checkSize(name: string, size: number, limits: ImportLimits): void {
  if (size > limits.maxFileBytes) {
    throw new ImportError(`${name} is larger than the import limit of ${megabytes(limits.maxFileBytes)}`);
  }
}

/** Entry names of a zip, without decompressing it. */
export function listZipEntries(bytes: Uint8Array, limits: ImportLimits): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        if (names.length >= limits.maxArchiveEntries) {
          throw new ImportError(`the zip has more than ${String(limits.maxArchiveEntries)} entries`);
        }
        if (!file.name.endsWith('/')) names.push(file.name);
        return false;
      },
    });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError('the zip file is damaged');
  }
  return names;
}

/** Replaces each zip with its files and checks every size limit. Unsafe paths inside zips are refused. */
export function expandFileSet(files: readonly InputFile[], limits: ImportLimits): InputFile[] {
  const result: InputFile[] = [];
  let total = 0;
  const add = (file: InputFile): void => {
    checkSize(file.name, file.bytes.byteLength, limits);
    total += file.bytes.byteLength;
    if (total > limits.maxTotalBytes) {
      throw new ImportError(
        `the selected files are larger than the import limit of ${megabytes(limits.maxTotalBytes)}`,
      );
    }
    result.push(file);
  };
  for (const file of files) {
    checkSize(file.name, file.bytes.byteLength, limits);
    if (extensionOf(file.name) !== ZIP_EXTENSION) {
      add(file);
      continue;
    }
    let entries: Record<string, Uint8Array>;
    let count = 0;
    try {
      entries = unzipSync(file.bytes, {
        filter: (entry) => {
          if (entry.name.endsWith('/')) return false;
          if (++count > limits.maxArchiveEntries) {
            throw new ImportError(`${file.name} has more than ${String(limits.maxArchiveEntries)} entries`);
          }
          if (!isSafeRelativePath(entry.name))
            throw new ImportError(`${file.name} contains an unsafe path: ${entry.name}`);
          checkSize(entry.name, entry.originalSize, limits);
          return true;
        },
      });
    } catch (error) {
      if (error instanceof ImportError) throw error;
      throw new ImportError(`${file.name} is not a valid zip file`);
    }
    for (const [name, bytes] of Object.entries(entries)) add({ name, bytes });
  }
  return result;
}

/**
 * The one model file among the picked files (zips included, by entry name). Refuses a selection with no model file,
 * or with several model files, since each import creates one group.
 */
export function findMainFile(
  files: readonly InputFile[],
  limits: ImportLimits,
): { name: string; format: ImportFormat } {
  const candidates: { name: string; format: ImportFormat }[] = [];
  for (const file of files) {
    checkSize(file.name, file.bytes.byteLength, limits);
    const names = extensionOf(file.name) === ZIP_EXTENSION ? listZipEntries(file.bytes, limits) : [file.name];
    for (const name of names) {
      const format = importFormatFor(name);
      if (format) candidates.push({ name, format });
    }
  }
  const [first] = candidates;
  if (!first) throw new ImportError('none of the selected files is a model format Planar can import');
  if (candidates.length > 1) {
    throw new ImportError(
      `choose one model at a time (the selection contains ${candidates.map((candidate) => baseName(candidate.name)).join(', ')})`,
    );
  }
  return first;
}

export function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/').toLowerCase();
}

/** Looks up files referenced by a model among the picked files, relative to the model's folder, then by name. */
export class FileResolver {
  readonly #byPath = new Map<string, InputFile>();
  readonly #byName = new Map<string, InputFile>();
  readonly #folder: string;
  readonly #warnings: string[];

  constructor(files: readonly InputFile[], mainName: string, warnings: string[]) {
    for (const file of files) {
      this.#byPath.set(normalizePath(file.name), file);
      const key = baseName(file.name).toLowerCase();
      if (!this.#byName.has(key)) this.#byName.set(key, file);
    }
    const slash = mainName.lastIndexOf('/');
    this.#folder = slash < 0 ? '' : mainName.slice(0, slash + 1);
    this.#warnings = warnings;
  }

  find(name: string): InputFile | undefined {
    return this.#byPath.get(normalizePath(name));
  }

  /**
   * The bytes of a referenced file, or null. External URLs are never fetched: each one produces a warning. So does
   * a reference that isn't among the picked files.
   */
  resolve(reference: string, what: string): Uint8Array | null {
    const trimmed = reference.trim();
    if (trimmed === '') return null;
    if (isExternalReference(trimmed)) {
      this.#warnings.push(`Ignored the external ${what} "${trimmed}": Planar never downloads files`);
      return null;
    }
    let decoded = trimmed;
    try {
      decoded = decodeURIComponent(trimmed);
    } catch {
      // Keep the raw reference.
    }
    const file =
      this.#byPath.get(normalizePath(this.#folder + decoded)) ??
      this.#byPath.get(normalizePath(decoded)) ??
      this.#byName.get(baseName(decoded).toLowerCase());
    if (!file) {
      this.#warnings.push(`The ${what} "${baseName(decoded)}" was not among the selected files`);
      return null;
    }
    return file.bytes;
  }
}
