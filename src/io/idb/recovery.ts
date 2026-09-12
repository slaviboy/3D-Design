export const DATABASE_NAME = 'planar';
export const DATABASE_VERSION = 1;
const RECOVERY_STORE = 'recovery';
const SETTINGS_STORE = 'settings';

export interface RecoverySnapshot {
  /** Editing session (browser tab) that wrote the snapshot. */
  readonly id: string;
  readonly documentName: string;
  /** Milliseconds since the epoch. */
  readonly savedAt: number;
  /** Contents in .planar file format. */
  readonly bytes: Uint8Array;
}

export interface RecoveryRepository {
  put(snapshot: RecoverySnapshot): Promise<void>;
  /** Newest first. */
  list(): Promise<RecoverySnapshot[]>;
  delete(id: string): Promise<void>;
  /** Keeps the newest `keep` snapshots and deletes the rest. */
  prune(keep: number): Promise<void>;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    };
  });
}

/** Opens (and creates or upgrades) Planar's local database. */
export function openPlanarDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(RECOVERY_STORE))
      db.createObjectStore(RECOVERY_STORE, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE);
  };
  return promisify(request);
}

function isSnapshot(value: unknown): value is RecoverySnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.documentName === 'string' &&
    typeof record.savedAt === 'number' &&
    record.bytes instanceof Uint8Array
  );
}

export class IndexedDbRecoveryRepository implements RecoveryRepository {
  readonly #db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.#db = db;
  }

  async put(snapshot: RecoverySnapshot): Promise<void> {
    const transaction = this.#db.transaction(RECOVERY_STORE, 'readwrite');
    transaction.objectStore(RECOVERY_STORE).put(snapshot);
    await completion(transaction);
  }

  async list(): Promise<RecoverySnapshot[]> {
    const transaction = this.#db.transaction(RECOVERY_STORE, 'readonly');
    const values = await promisify(transaction.objectStore(RECOVERY_STORE).getAll());
    // Stored data is untrusted: skip anything that doesn't have the expected shape.
    return values.filter(isSnapshot).sort((a, b) => b.savedAt - a.savedAt);
  }

  async delete(id: string): Promise<void> {
    const transaction = this.#db.transaction(RECOVERY_STORE, 'readwrite');
    transaction.objectStore(RECOVERY_STORE).delete(id);
    await completion(transaction);
  }

  async prune(keep: number): Promise<void> {
    const stale = (await this.list()).slice(Math.max(0, keep));
    if (stale.length === 0) return;
    const transaction = this.#db.transaction(RECOVERY_STORE, 'readwrite');
    const store = transaction.objectStore(RECOVERY_STORE);
    for (const snapshot of stale) store.delete(snapshot.id);
    await completion(transaction);
  }
}
