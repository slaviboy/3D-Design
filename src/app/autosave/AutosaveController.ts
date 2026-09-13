import { recoverySnapshotId, type RecoveryRepository } from '../../io/idb/recovery';
import type { EditorSession } from '../session/EditorSession';

export const DEFAULT_AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_RECOVERY_SESSIONS_KEPT = 5;
export const DEFAULT_RECOVERY_VERSIONS_KEPT = 3;

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
  /** Newest sessions kept in the recovery store. */
  readonly keepSessions?: number;
  /** Newest autosave versions kept for each session. */
  readonly keepVersions?: number;
  readonly timers?: TimerApi;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
}

/**
 * Periodically writes a recovery snapshot of unsaved work to local storage. Nothing leaves the device. Each write is a
 * new version, so a few earlier states survive too. The autosaves are removed once the work is saved to a file, and
 * the Recover dialog offers the ones left behind by sessions that ended without saving (for example after a crash).
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

  /** Removes this session's autosaves (after the work was saved to a file, or on a clean exit). Backups stay. */
  async discard(): Promise<void> {
    this.#lastSnapshotRevision = null;
    try {
      await this.#options.repository.deleteSession(this.sessionId, 'autosave');
    } catch (error) {
      this.#options.onError?.(error);
    }
  }

  async #write(): Promise<boolean> {
    const { session, repository, sessionId } = this.#options;
    if (!session.isDirty || session.revision === this.#lastSnapshotRevision) return false;
    const revision = session.revision;
    const savedAt = (this.#options.now ?? Date.now)();
    try {
      await repository.put({
        id: recoverySnapshotId(sessionId, 'autosave', savedAt),
        sessionId,
        kind: 'autosave',
        documentName: session.documentName,
        savedAt,
        bytes: this.#options.encode(),
      });
      this.#lastSnapshotRevision = revision;
      await repository.prune({
        versionsPerSession: this.#options.keepVersions ?? DEFAULT_RECOVERY_VERSIONS_KEPT,
        sessions: this.#options.keepSessions ?? DEFAULT_RECOVERY_SESSIONS_KEPT,
      });
      return true;
    } catch (error) {
      this.#options.onError?.(error);
      return false;
    }
  }
}
