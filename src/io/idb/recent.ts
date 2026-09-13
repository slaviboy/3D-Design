import { completion, promisify, RECENT_STORE } from './recovery';

/** A file the user opened or saved recently. */
export interface RecentFile {
  readonly name: string;
  /** Milliseconds since the epoch. */
  readonly openedAt: number;
  /** A File System Access handle to reopen it with, where the browser supports that; otherwise null. */
  readonly handle: unknown;
}

export const MAX_RECENT_FILES = 10;

export interface RecentFilesRepository {
  /** Adds or refreshes a file (one entry per name) and keeps only the newest entries. */
  add(file: RecentFile): Promise<void>;
  /** Newest first. */
  list(): Promise<RecentFile[]>;
  remove(name: string): Promise<void>;
}

function readRecentFile(value: unknown): RecentFile | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || typeof record.openedAt !== 'number') return null;
  return { name: record.name, openedAt: record.openedAt, handle: record.handle ?? null };
}

export class IndexedDbRecentFilesRepository implements RecentFilesRepository {
  readonly #db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.#db = db;
  }

  async add(file: RecentFile): Promise<void> {
    try {
      await this.#put(file);
    } catch (error) {
      // Some handles can't be stored; keep the name so the list still shows the file.
      if (!(error instanceof DOMException) || error.name !== 'DataCloneError') throw error;
      await this.#put({ ...file, handle: null });
    }
    const stale = (await this.list()).slice(MAX_RECENT_FILES);
    if (stale.length === 0) return;
    const transaction = this.#db.transaction(RECENT_STORE, 'readwrite');
    for (const entry of stale) transaction.objectStore(RECENT_STORE).delete(entry.name);
    await completion(transaction);
  }

  async list(): Promise<RecentFile[]> {
    const transaction = this.#db.transaction(RECENT_STORE, 'readonly');
    const values = await promisify(transaction.objectStore(RECENT_STORE).getAll());
    return values
      .map(readRecentFile)
      .filter((file): file is RecentFile => file !== null)
      .sort((a, b) => b.openedAt - a.openedAt);
  }

  async remove(name: string): Promise<void> {
    const transaction = this.#db.transaction(RECENT_STORE, 'readwrite');
    transaction.objectStore(RECENT_STORE).delete(name);
    await completion(transaction);
  }

  async #put(file: RecentFile): Promise<void> {
    const transaction = this.#db.transaction(RECENT_STORE, 'readwrite');
    transaction
      .objectStore(RECENT_STORE)
      .put({ name: file.name, openedAt: file.openedAt, handle: file.handle });
    await completion(transaction);
  }
}
