declare const brand: unique symbol;

/** Nominal typing for numeric ids, so an EdgeId can't be passed where a FaceId is expected. */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type VertexId = Brand<number, 'VertexId'>;
export type EdgeId = Brand<number, 'EdgeId'>;
export type FaceId = Brand<number, 'FaceId'>;
export type CurveId = Brand<number, 'CurveId'>;
export type InstanceId = Brand<number, 'InstanceId'>;
export type DefinitionId = Brand<number, 'DefinitionId'>;
export type MaterialId = Brand<number, 'MaterialId'>;
export type TagId = Brand<number, 'TagId'>;
export type GuideId = Brand<number, 'GuideId'>;

/**
 * Hands out document-wide entity ids: positive integers that increase monotonically and are never reused.
 * Undo does not move the counter backwards, so an id always refers to at most one entity over the life of a document.
 */
export class IdAllocator {
  #next: number;

  constructor(next = 1) {
    if (!Number.isSafeInteger(next) || next < 1) throw new Error(`Invalid first id: ${String(next)}`);
    this.#next = next;
  }

  /** The id the next call to {@link allocate} returns. */
  get next(): number {
    return this.#next;
  }

  allocate(): number {
    const id = this.#next;
    this.#next += 1;
    return id;
  }

  /** Moves the counter past `id`, so an entity created with an externally supplied id can't collide later. */
  reserveThrough(id: number): void {
    if (id >= this.#next) this.#next = id + 1;
  }
}
