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
export type AnnotationId = Brand<number, 'AnnotationId'>;
export type SectionPlaneId = Brand<number, 'SectionPlaneId'>;
export type SceneId = Brand<number, 'SceneId'>;
export type AssetId = Brand<number, 'AssetId'>;

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
