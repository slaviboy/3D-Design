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

export interface OpenedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** Handle for saving back to the same file, when the platform supports it. */
  readonly handle: unknown;
}

export interface SavedFile {
  readonly name: string;
  readonly handle: unknown;
}

/** Which files a picker offers, and what a saved file is. */
export interface FileTypeFilter {
  readonly description: string;
  readonly mimeType: string;
  /** Extensions with the leading dot. */
  readonly extensions: readonly string[];
}

/** Local file access. Implementations never upload anything. */
export interface FileAccess {
  /** Lets the user pick one or more files of the given types (for imports). Resolves to null when cancelled. */
  openFiles?(filter: FileTypeFilter): Promise<OpenedFile[] | null>;
  /**
   * Saves a new file of the given type (for exports): asks for a location, or downloads. Never writes to the open
   * document's file. Resolves to null when cancelled.
   */
  saveCopy?(bytes: Uint8Array, suggestedName: string, filter: FileTypeFilter): Promise<SavedFile | null>;
  /** Lets the user pick a file. Resolves to null when cancelled. */
  open(): Promise<OpenedFile | null>;
  /**
   * Writes bytes. With a handle from an earlier open or save, writes there directly; otherwise asks for a location
   * (or downloads). Resolves to null when cancelled.
   */
  save(bytes: Uint8Array, suggestedName: string, handle: unknown): Promise<SavedFile | null>;
  /**
   * Reads a file again from a handle kept from an earlier open or save, asking for permission if needed. Resolves to
   * null when the handle can't be used. Only platforms with persistent file handles implement this.
   */
  openHandle?(handle: unknown): Promise<OpenedFile | null>;
}
