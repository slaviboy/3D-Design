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
  const version = (id: string, sessionId: string, kind: 'autosave' | 'backup', savedAt: number) => ({
    id,
    sessionId,
    kind,
    documentName: id,
    savedAt,
    bytes: new Uint8Array([savedAt]),
  });

  it('keeps versions newest first, prunes by version and session, and deletes by session', async () => {
    const repository = new IndexedDbRecoveryRepository(await openPlanarDatabase(new IDBFactory()));
    for (const snapshot of [
      version('a1', 's1', 'autosave', 1),
      version('a2', 's1', 'autosave', 2),
      version('a3', 's1', 'autosave', 3),
      version('a4', 's1', 'autosave', 4),
      version('b1', 's2', 'autosave', 5),
      version('k1', 's1', 'backup', 6),
    ]) {
      await repository.put(snapshot);
    }
    const ids = async () => (await repository.list()).map((snapshot) => snapshot.id);
    expect(await ids()).toEqual(['k1', 'b1', 'a4', 'a3', 'a2', 'a1']);

    await repository.prune({ versionsPerSession: 2, sessions: 5 });
    expect(await ids()).toEqual(['k1', 'b1', 'a4', 'a3']);
    await repository.prune({ versionsPerSession: 5, sessions: 1 });
    expect(await ids()).toEqual(['k1', 'a4', 'a3']);

    await repository.deleteSession('s1', 'autosave');
    const [remaining] = await repository.list();
    expect(remaining).toMatchObject({ id: 'k1', kind: 'backup', sessionId: 's1' });
    expect(remaining?.bytes).toEqual(new Uint8Array([6]));
    await repository.deleteSession('s1');
    expect(await repository.list()).toEqual([]);
  });

  it('reads snapshots stored before versions existed, and skips malformed records', async () => {
    const db = await openPlanarDatabase(new IDBFactory());
    const transaction = db.transaction('recovery', 'readwrite');
    const store = transaction.objectStore('recovery');
    store.put({ id: 'legacy-session', documentName: 'Old', savedAt: 7, bytes: new Uint8Array([1]) });
    store.put({ id: 'broken', documentName: 3 });
    await new Promise((resolve) => {
      transaction.oncomplete = resolve;
    });
    const [legacy, ...rest] = await new IndexedDbRecoveryRepository(db).list();
    expect(legacy).toMatchObject({ id: 'legacy-session', sessionId: 'legacy-session', kind: 'autosave' });
    expect(rest).toEqual([]);
  });

  it('reopens an existing database without losing data', async () => {
    const factory = new IDBFactory();
    await new IndexedDbRecoveryRepository(await openPlanarDatabase(factory)).put(
      version('kept', 's', 'autosave', 5),
    );
    const reopened = new IndexedDbRecoveryRepository(await openPlanarDatabase(factory));
    expect(await reopened.list()).toHaveLength(1);
  });
});
