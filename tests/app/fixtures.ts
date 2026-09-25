/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Editor } from '../../src/app/Editor';
import type { CameraState, ViewportSize } from '../../src/app/camera/camera';
import { vec3 } from '../../src/kernel/math/vec3';
import type { FileAccess, OpenedFile, SavedFile } from '../../src/io/fs/types';
import {
  snapshotsBeyondRetention,
  type RecoveryKind,
  type RecoveryRepository,
  type RecoverySnapshot,
  type RetentionPolicy,
} from '../../src/io/idb/recovery';
import type { AnimationClock } from '../../src/app/scenes/scenes';
import type { PointerInput } from '../../src/app/tools/Tool';

export const VIEW_SIZE: ViewportSize = { width: 200, height: 200 };

/**
 * Looking straight down at the origin with parallel projection: screen (100, 100) is world (0, 0),
 * and one pixel is 5 cm, so world (x, y) appears at screen (100 + 20x, 100 − 20y).
 */
export const TOP_CAMERA: CameraState = {
  eye: vec3(0, 0, 10),
  target: vec3(0, 0, 0),
  up: vec3(0, 1, 0),
  fovDegrees: 35,
  projection: 'parallel',
  orthoHalfHeight: 5,
};

export function screenOf(x: number, y: number): { x: number; y: number } {
  return { x: 100 + 20 * x, y: 100 - 20 * y };
}

/** In-memory file system for exercising open and save without a browser. */
export class MemoryFileAccess implements FileAccess {
  readonly files = new Map<string, Uint8Array>();
  nextOpen: string | null = null;

  open(): Promise<OpenedFile | null> {
    const name = this.nextOpen;
    const bytes = name === null ? undefined : this.files.get(name);
    return Promise.resolve(name !== null && bytes ? { name, bytes, handle: name } : null);
  }

  save(bytes: Uint8Array, suggestedName: string, handle: unknown): Promise<SavedFile | null> {
    const name = typeof handle === 'string' ? handle : suggestedName;
    this.files.set(name, bytes);
    return Promise.resolve({ name, handle: name });
  }

  openHandle(handle: unknown): Promise<OpenedFile | null> {
    const bytes = typeof handle === 'string' ? this.files.get(handle) : undefined;
    return Promise.resolve(typeof handle === 'string' && bytes ? { name: handle, bytes, handle } : null);
  }
}

export class MemoryRecoveryRepository implements RecoveryRepository {
  readonly snapshots = new Map<string, RecoverySnapshot>();

  put(snapshot: RecoverySnapshot): Promise<void> {
    this.snapshots.set(snapshot.id, snapshot);
    return Promise.resolve();
  }

  list(): Promise<RecoverySnapshot[]> {
    return Promise.resolve([...this.snapshots.values()].sort((a, b) => b.savedAt - a.savedAt));
  }

  delete(id: string): Promise<void> {
    this.snapshots.delete(id);
    return Promise.resolve();
  }

  deleteSession(sessionId: string, kind?: RecoveryKind): Promise<void> {
    for (const snapshot of [...this.snapshots.values()]) {
      if (snapshot.sessionId === sessionId && (kind === undefined || snapshot.kind === kind)) {
        this.snapshots.delete(snapshot.id);
      }
    }
    return Promise.resolve();
  }

  prune(policy: RetentionPolicy): Promise<void> {
    for (const stale of snapshotsBeyondRetention([...this.snapshots.values()], policy)) {
      this.snapshots.delete(stale.id);
    }
    return Promise.resolve();
  }
}

/** A clock that only moves when told to, running frames every 16 ms and timers when they fall due. */
export class FakeClock implements AnimationClock {
  time = 0;
  #nextHandle = 1;
  readonly #frames = new Map<number, () => void>();
  readonly #timers = new Map<number, { readonly at: number; readonly callback: () => void }>();

  now(): number {
    return this.time;
  }

  requestFrame(callback: () => void): number {
    const handle = this.#nextHandle++;
    this.#frames.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number): void {
    this.#frames.delete(handle);
  }

  setTimer(callback: () => void, milliseconds: number): number {
    const handle = this.#nextHandle++;
    this.#timers.set(handle, { at: this.time + milliseconds, callback });
    return handle;
  }

  clearTimer(handle: number): void {
    this.#timers.delete(handle);
  }

  advance(milliseconds: number): void {
    const end = this.time + milliseconds;
    while (this.time < end) {
      this.time = Math.min(end, this.time + 16);
      for (const [handle, timer] of [...this.#timers]) {
        if (timer.at > this.time) continue;
        this.#timers.delete(handle);
        timer.callback();
      }
      const frames = [...this.#frames];
      this.#frames.clear();
      for (const [, frame] of frames) frame();
    }
  }
}

export function createTestEditor(
  options: { fileAccess?: FileAccess; confirm?: boolean; clock?: AnimationClock } = {},
): Editor {
  const editor = new Editor({
    platform: 'other',
    appVersion: '0.0.0-test',
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.fileAccess ? { fileAccess: options.fileAccess } : {}),
    ...(options.confirm !== undefined
      ? { confirmDiscardChanges: () => Promise.resolve(options.confirm === true) }
      : {}),
  });
  editor.setViewportSize(VIEW_SIZE);
  editor.session.setCamera(TOP_CAMERA);
  return editor;
}

export function pointer(x: number, y: number, overrides: Partial<PointerInput> = {}): PointerInput {
  return {
    x,
    y,
    button: 0,
    buttons: 1,
    detail: 1,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  };
}

/** Press and release at one point with the given click count and modifiers. */
export function click(editor: Editor, x: number, y: number, overrides: Partial<PointerInput> = {}): void {
  editor.tools.pointerDown(pointer(x, y, overrides));
  editor.tools.pointerUp(pointer(x, y, { ...overrides, buttons: 0 }));
}

export function drag(
  editor: Editor,
  from: { x: number; y: number },
  to: { x: number; y: number },
  overrides: Partial<PointerInput> = {},
): void {
  editor.tools.pointerDown(pointer(from.x, from.y, overrides));
  editor.tools.pointerMove(pointer((from.x + to.x) / 2, (from.y + to.y) / 2, overrides));
  editor.tools.pointerMove(pointer(to.x, to.y, overrides));
  editor.tools.pointerUp(pointer(to.x, to.y, { ...overrides, buttons: 0 }));
}
