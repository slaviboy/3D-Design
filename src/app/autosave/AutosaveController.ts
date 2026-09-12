import type { RecoveryRepository } from '../../io/idb/recovery';
import type { EditorSession } from '../session/EditorSession';

export const DEFAULT_AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_RECOVERY_SESSIONS_KEPT = 5;

export interface TimerApi {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface AutosaveOptions {
  readonly session: EditorSession;
  readonly repository: RecoveryRepository;
  readonly encode: () => Uint8Array;
  /** Identifies this browser tab's editing session in the recovery store. */
  readonly sessionId: string;
  readonly intervalMs?: number;
  readonly keepSessions?: number;
  readonly timers?: TimerApi;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
}

/**
 * Periodically writes a recovery snapshot of unsaved work to local storage. Nothing leaves the device. The snapshot
 * is removed once the work is saved to a file, and the Recover dialog offers snapshots left behind by sessions that
 * ended without saving (for example after a crash).
 */
export class AutosaveController {
  readonly sessionId: string;
  readonly #options: AutosaveOptions;
  readonly #timers: TimerApi;
  #handle: unknown = null;
  #lastSnapshotRevision: number | null = null;
  #pending: Promise<boolean> | null = null;
  #unsubscribe: (() => void) | null = null;

  constructor(options: AutosaveOptions) {
    this.#options = options;
    this.sessionId = options.sessionId;
    this.#timers = options.timers ?? {
      setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
      clearInterval: (handle) => {
        globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
      },
    };
  }

  start(): void {
    if (this.#handle !== null) return;
    this.#handle = this.#timers.setInterval(() => {
      void this.tick();
    }, this.#options.intervalMs ?? DEFAULT_AUTOSAVE_INTERVAL_MS);
    this.#unsubscribe = this.#options.session.subscribe((event) => {
      if (event.kind === 'file') void this.discard();
    });
  }

  stop(): void {
    if (this.#handle !== null) this.#timers.clearInterval(this.#handle);
    this.#handle = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  /** Writes a snapshot when there are unsaved changes that aren't in the latest snapshot. Resolves to whether it wrote. */
  tick(): Promise<boolean> {
    this.#pending ??= this.#write().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  /** Removes this session's snapshot (after the work was saved to a file, or on a clean exit). */
  async discard(): Promise<void> {
    this.#lastSnapshotRevision = null;
    try {
      await this.#options.repository.delete(this.sessionId);
    } catch (error) {
      this.#options.onError?.(error);
    }
  }

  async #write(): Promise<boolean> {
    const { session, repository } = this.#options;
    if (!session.isDirty || session.revision === this.#lastSnapshotRevision) return false;
    const revision = session.revision;
    try {
      await repository.put({
        id: this.sessionId,
        documentName: session.documentName,
        savedAt: (this.#options.now ?? Date.now)(),
        bytes: this.#options.encode(),
      });
      this.#lastSnapshotRevision = revision;
      await repository.prune(this.#options.keepSessions ?? DEFAULT_RECOVERY_SESSIONS_KEPT);
      return true;
    } catch (error) {
      this.#options.onError?.(error);
      return false;
    }
  }
}
