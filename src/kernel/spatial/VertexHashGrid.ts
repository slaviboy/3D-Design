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

import { WELD_GRID_CELL_SIZE } from '../tolerance';
import { distanceSquared, type Vec3 } from '../math/vec3';

/** A query may cover at most this many cells per axis, so a mistaken huge radius fails loudly instead of hanging. */
const MAX_CELLS_PER_AXIS = 64;

/**
 * Uniform hash grid over points, used to find existing vertices within the welding tolerance.
 * Cells are keyed by a 32-bit hash of their integer coordinates. Hash collisions only cost extra
 * distance checks and never produce wrong answers.
 */
export class VertexHashGrid {
  readonly #cellSize: number;
  readonly #buckets = new Map<number, number[]>();
  readonly #positions = new Map<number, Vec3>();

  constructor(cellSize = WELD_GRID_CELL_SIZE) {
    if (!(cellSize > 0)) throw new Error('VertexHashGrid: cell size must be positive');
    this.#cellSize = cellSize;
  }

  get size(): number {
    return this.#positions.size;
  }

  insert(id: number, position: Vec3): void {
    if (this.#positions.has(id)) throw new Error(`VertexHashGrid: id ${String(id)} is already present`);
    this.#positions.set(id, position);
    const key = this.#keyOf(position);
    const bucket = this.#buckets.get(key);
    if (bucket) bucket.push(id);
    else this.#buckets.set(key, [id]);
  }

  remove(id: number): boolean {
    const position = this.#positions.get(id);
    if (!position) return false;
    this.#positions.delete(id);
    const key = this.#keyOf(position);
    const bucket = this.#buckets.get(key);
    if (bucket) {
      const index = bucket.indexOf(id);
      if (index >= 0) bucket.splice(index, 1);
      if (bucket.length === 0) this.#buckets.delete(key);
    }
    return true;
  }

  move(id: number, position: Vec3): void {
    this.remove(id);
    this.insert(id, position);
  }

  /** Calls `visit` for every point within `radius` of `center` (inclusive). */
  forEachWithin(center: Vec3, radius: number, visit: (id: number, position: Vec3) => void): void {
    const size = this.#cellSize;
    const minX = Math.floor((center.x - radius) / size);
    const maxX = Math.floor((center.x + radius) / size);
    const minY = Math.floor((center.y - radius) / size);
    const maxY = Math.floor((center.y + radius) / size);
    const minZ = Math.floor((center.z - radius) / size);
    const maxZ = Math.floor((center.z + radius) / size);
    if (
      maxX - minX >= MAX_CELLS_PER_AXIS ||
      maxY - minY >= MAX_CELLS_PER_AXIS ||
      maxZ - minZ >= MAX_CELLS_PER_AXIS
    ) {
      throw new Error('VertexHashGrid: query radius is too large for this grid');
    }
    const radiusSquared = radius * radius;
    const seen = new Set<number>();
    for (let ix = minX; ix <= maxX; ix++) {
      for (let iy = minY; iy <= maxY; iy++) {
        for (let iz = minZ; iz <= maxZ; iz++) {
          const bucket = this.#buckets.get(hashCell(ix, iy, iz));
          if (!bucket) continue;
          for (const id of bucket) {
            if (seen.has(id)) continue;
            seen.add(id);
            const position = this.#positions.get(id);
            if (position && distanceSquared(position, center) <= radiusSquared) visit(id, position);
          }
        }
      }
    }
  }

  /** The closest point within `radius`, ties broken by the lowest id; `undefined` when none. */
  findNearest(center: Vec3, radius: number): number | undefined {
    let best: number | undefined;
    let bestDistance = Infinity;
    this.forEachWithin(center, radius, (id, position) => {
      const d = distanceSquared(position, center);
      if (d < bestDistance || (d === bestDistance && best !== undefined && id < best)) {
        best = id;
        bestDistance = d;
      }
    });
    return best;
  }

  #keyOf(position: Vec3): number {
    const size = this.#cellSize;
    return hashCell(
      Math.floor(position.x / size),
      Math.floor(position.y / size),
      Math.floor(position.z / size),
    );
  }
}

function hashCell(ix: number, iy: number, iz: number): number {
  // Large primes spread neighbouring cells across the 32-bit key space (Teschner et al. spatial hashing).
  return (Math.imul(ix | 0, 73856093) ^ Math.imul(iy | 0, 19349663) ^ Math.imul(iz | 0, 83492791)) >>> 0;
}
