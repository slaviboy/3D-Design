import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { MAX_TEXTURE_BYTES, textureExtension } from '../../kernel/model/assets';
import type { DocumentOptions, ModelDocument } from '../../kernel/model/ModelDocument';
import { createSnapshot, restoreSnapshot, snapshotTextureFiles } from '../../kernel/model/snapshot';
import type { TextureMimeType } from '../../kernel/model/types';
import { err, ok, type Result } from '../../kernel/result';

export const PLANAR_FILE_FORMAT = 'planar-model';
export const PLANAR_SCHEMA_VERSION = 1;
export const PLANAR_FILE_EXTENSION = '.planar';
export const PLANAR_MIME_TYPE = 'application/vnd.planar.model+zip';

/** Files larger than this are refused before any parsing. */
export const MAX_PLANAR_FILE_BYTES = 512 * 1024 * 1024;
/** Entries claiming a larger uncompressed size are refused (zip-bomb guard). */
export const MAX_UNCOMPRESSED_ENTRY_BYTES = 1024 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 10_000;
const COMPRESSION_LEVEL = 6;

const MANIFEST_ENTRY = 'manifest.json';
const MODEL_ENTRY = 'model.json';
const TEXTURE_DIRECTORY = 'assets/textures/';
const TEXTURE_ENTRY = /^assets\/textures\/([0-9a-f]{64})\.(?:png|jpg)$/;

export interface PlanarManifest {
  readonly format: typeof PLANAR_FILE_FORMAT;
  readonly schemaVersion: number;
  readonly appVersion: string;
  readonly createdAt: string;
  readonly modifiedAt: string;
}

export interface EncodeOptions {
  readonly appVersion: string;
  readonly now: Date;
  /** Creation time to preserve from an earlier save; defaults to `now`. */
  readonly createdAt?: string;
}

export function encodePlanarFile(doc: ModelDocument, options: EncodeOptions): Uint8Array {
  const manifest: PlanarManifest = {
    format: PLANAR_FILE_FORMAT,
    schemaVersion: PLANAR_SCHEMA_VERSION,
    appVersion: options.appVersion,
    createdAt: options.createdAt ?? options.now.toISOString(),
    modifiedAt: options.now.toISOString(),
  };
  const entries: Zippable = {
    [MANIFEST_ENTRY]: strToU8(JSON.stringify(manifest, null, 2)),
    [MODEL_ENTRY]: strToU8(JSON.stringify(createSnapshot(doc))),
  };
  // PNG and JPEG data is already compressed, so textures are stored without recompressing them.
  for (const [digest, file] of snapshotTextureFiles(doc)) {
    entries[textureEntryName(digest, file.mimeType)] = [file.bytes, { level: 0 }];
  }
  return zipSync(entries, { level: COMPRESSION_LEVEL });
}

/** Archive path of a texture image: `assets/textures/<sha256>.<png|jpg>`. */
export function textureEntryName(digest: string, mimeType: TextureMimeType): string {
  return `${TEXTURE_DIRECTORY}${digest}.${textureExtension(mimeType)}`;
}

/** Rejects absolute paths, parent-directory segments, drive letters and backslashes. */
export function isSafeArchivePath(name: string): boolean {
  if (name === '' || name.startsWith('/') || name.includes('\\') || /^[a-zA-Z]:/.test(name)) return false;
  return !name.split('/').some((segment) => segment === '..');
}

function readManifest(text: string): Result<PlanarManifest> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err('the manifest is not valid JSON');
  }
  if (typeof value !== 'object' || value === null) return err('the manifest is not an object');
  const manifest = value as Record<string, unknown>;
  if (manifest.format !== PLANAR_FILE_FORMAT) return err('this is not a Planar model file');
  const { schemaVersion, appVersion, createdAt, modifiedAt } = manifest;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return err('the file has an invalid schema version');
  }
  if (schemaVersion > PLANAR_SCHEMA_VERSION) {
    return err(`the file was created by a newer version of Planar (format version ${String(schemaVersion)})`);
  }
  if (typeof appVersion !== 'string' || typeof createdAt !== 'string' || typeof modifiedAt !== 'string') {
    return err('the manifest is incomplete');
  }
  return ok({ format: PLANAR_FILE_FORMAT, schemaVersion, appVersion, createdAt, modifiedAt });
}

/**
 * Reads a .planar file. The archive, the manifest and the model are all validated. Unsafe or oversized entries
 * are refused, and nothing is returned unless the whole model is valid.
 */
export function decodePlanarFile(
  bytes: Uint8Array,
  documentOptions: DocumentOptions = {},
): Result<{ doc: ModelDocument; manifest: PlanarManifest }> {
  if (bytes.byteLength > MAX_PLANAR_FILE_BYTES) return err('the file is too large');
  let entryCount = 0;
  const problems: string[] = [];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        entryCount++;
        if (entryCount > MAX_ARCHIVE_ENTRIES) {
          problems.push('the archive has too many entries');
          return false;
        }
        if (!isSafeArchivePath(file.name)) {
          problems.push(`the archive contains an unsafe path (${file.name})`);
          return false;
        }
        if (file.originalSize > MAX_UNCOMPRESSED_ENTRY_BYTES) {
          problems.push(`the entry ${file.name} is too large`);
          return false;
        }
        if (TEXTURE_ENTRY.test(file.name)) {
          if (file.originalSize > MAX_TEXTURE_BYTES) {
            problems.push(`the texture ${file.name} is too large`);
            return false;
          }
          return true;
        }
        return file.name === MANIFEST_ENTRY || file.name === MODEL_ENTRY;
      },
    });
  } catch {
    return err('the file is not a valid Planar archive');
  }
  if (problems.length > 0) return err(problems.join('; '));
  const textures = new Map<string, Uint8Array>();
  for (const [name, entryBytes] of Object.entries(entries)) {
    const match = TEXTURE_ENTRY.exec(name);
    if (!match?.[1]) continue;
    // The decompressed size is checked too, since an archive can misstate it.
    if (entryBytes.byteLength > MAX_TEXTURE_BYTES) return err(`the texture ${name} is too large`);
    textures.set(match[1], entryBytes);
  }

  const manifestBytes = entries[MANIFEST_ENTRY];
  const modelBytes = entries[MODEL_ENTRY];
  if (!manifestBytes || !modelBytes) return err('the archive is missing its manifest or model');
  const manifest = readManifest(strFromU8(manifestBytes));
  if (!manifest.ok) return manifest;

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(strFromU8(modelBytes));
  } catch {
    return err('the model data is not valid JSON');
  }
  const restored = restoreSnapshot(snapshot, documentOptions, (digest) => textures.get(digest));
  if (!restored.ok) return err(restored.error);
  return ok({ doc: restored.value, manifest: manifest.value });
}
