import { IDBFactory } from 'fake-indexeddb';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  decodePlanarFile,
  encodePlanarFile,
  isSafeArchivePath,
  PLANAR_FILE_FORMAT,
  PLANAR_SCHEMA_VERSION,
} from '../../src/io/format/planarFile';
import { IndexedDbRecoveryRepository, openPlanarDatabase } from '../../src/io/idb/recovery';
import { createSnapshot, hashDocument } from '../../src/kernel/model/snapshot';
import { createSampleModel } from '../../src/app/sample/sampleModel';

const NOW = new Date('2026-09-13T12:00:00Z');

function manifest(overrides: Record<string, unknown> = {}): Uint8Array {
  return strToU8(
    JSON.stringify({
      format: PLANAR_FILE_FORMAT,
      schemaVersion: PLANAR_SCHEMA_VERSION,
      appVersion: '1.0.0',
      createdAt: NOW.toISOString(),
      modifiedAt: NOW.toISOString(),
      ...overrides,
    }),
  );
}

const model = (): Uint8Array => strToU8(JSON.stringify(createSnapshot(createSampleModel())));

describe('.planar files', () => {
  it('round-trips a model with its manifest', () => {
    const doc = createSampleModel();
    const bytes = encodePlanarFile(doc, {
      appVersion: '1.2.3',
      now: NOW,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const result = decodePlanarFile(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(hashDocument(result.value.doc)).toBe(hashDocument(doc));
    expect(result.value.manifest).toEqual({
      format: PLANAR_FILE_FORMAT,
      schemaVersion: PLANAR_SCHEMA_VERSION,
      appVersion: '1.2.3',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: NOW.toISOString(),
    });
  });

  it('ignores unknown archive entries', () => {
    const bytes = zipSync({
      'manifest.json': manifest(),
      'model.json': model(),
      'assets/readme.txt': strToU8('hi'),
    });
    expect(decodePlanarFile(bytes).ok).toBe(true);
  });

  it.each<[string, Uint8Array, string]>([
    ['not a zip', new Uint8Array([1, 2, 3, 4]), 'not a valid Planar archive'],
    ['missing model', zipSync({ 'manifest.json': manifest() }), 'missing its manifest or model'],
    [
      'foreign format',
      zipSync({ 'manifest.json': manifest({ format: 'other' }), 'model.json': model() }),
      'not a Planar model file',
    ],
    [
      'newer schema',
      zipSync({ 'manifest.json': manifest({ schemaVersion: 99 }), 'model.json': model() }),
      'newer version of Planar',
    ],
    [
      'bad schema',
      zipSync({ 'manifest.json': manifest({ schemaVersion: 'one' }), 'model.json': model() }),
      'invalid schema version',
    ],
    [
      'incomplete manifest',
      zipSync({ 'manifest.json': manifest({ appVersion: 7 }), 'model.json': model() }),
      'incomplete',
    ],
    [
      'manifest not JSON',
      zipSync({ 'manifest.json': strToU8('{'), 'model.json': model() }),
      'manifest is not valid JSON',
    ],
    [
      'manifest not an object',
      zipSync({ 'manifest.json': strToU8('42'), 'model.json': model() }),
      'manifest is not an object',
    ],
    [
      'model not JSON',
      zipSync({ 'manifest.json': manifest(), 'model.json': strToU8('nope') }),
      'model data is not valid JSON',
    ],
    [
      'invalid model',
      zipSync({ 'manifest.json': manifest(), 'model.json': strToU8('{"format":"x"}') }),
      'not a Planar document',
    ],
    [
      'path traversal',
      zipSync({ 'manifest.json': manifest(), 'model.json': model(), '../evil': strToU8('x') }),
      'unsafe path',
    ],
  ])('rejects %s', (_name, bytes, message) => {
    const result = decodePlanarFile(bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it('recognizes unsafe archive paths', () => {
    expect(isSafeArchivePath('model.json')).toBe(true);
    expect(isSafeArchivePath('assets/textures/a.png')).toBe(true);
    for (const unsafe of ['', '/etc/passwd', '../x', 'a/../../b', 'C:/x', 'a\\b'])
      expect(isSafeArchivePath(unsafe)).toBe(false);
  });
});

describe('IndexedDB recovery repository', () => {
  it('stores, lists newest first, prunes and deletes snapshots', async () => {
    const repository = new IndexedDbRecoveryRepository(await openPlanarDatabase(new IDBFactory()));
    const bytes = new Uint8Array([1, 2, 3]);
    await repository.put({ id: 'a', documentName: 'First', savedAt: 1, bytes });
    await repository.put({ id: 'b', documentName: 'Second', savedAt: 3, bytes });
    await repository.put({ id: 'c', documentName: 'Third', savedAt: 2, bytes });
    expect((await repository.list()).map((snapshot) => snapshot.id)).toEqual(['b', 'c', 'a']);
    await repository.prune(2);
    expect((await repository.list()).map((snapshot) => snapshot.id)).toEqual(['b', 'c']);
    await repository.prune(5);
    await repository.delete('b');
    const [remaining] = await repository.list();
    expect(remaining).toMatchObject({ id: 'c', documentName: 'Third' });
    expect(remaining?.bytes).toEqual(bytes);
  });

  it('reopens an existing database without losing data', async () => {
    const factory = new IDBFactory();
    await new IndexedDbRecoveryRepository(await openPlanarDatabase(factory)).put({
      id: 'kept',
      documentName: 'Kept',
      savedAt: 5,
      bytes: new Uint8Array([9]),
    });
    const reopened = new IndexedDbRecoveryRepository(await openPlanarDatabase(factory));
    expect(await reopened.list()).toHaveLength(1);
  });
});
