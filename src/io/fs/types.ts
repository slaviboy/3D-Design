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

/** Local file access. Implementations never upload anything. */
export interface FileAccess {
  /** Lets the user pick a file. Resolves to null when cancelled. */
  open(): Promise<OpenedFile | null>;
  /**
   * Writes bytes. With a handle from an earlier open or save, writes there directly; otherwise asks for a location
   * (or downloads). Resolves to null when cancelled.
   */
  save(bytes: Uint8Array, suggestedName: string, handle: unknown): Promise<SavedFile | null>;
}
