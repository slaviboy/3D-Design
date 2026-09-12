import { describe, expect, it } from 'vitest';
import { aabbIntersects, type Aabb } from '../../../src/kernel/math/aabb';
import { vec3, type Vec3 } from '../../../src/kernel/math/vec3';
import { AabbTree } from '../../../src/kernel/spatial/AabbTree';
import { VertexHashGrid } from '../../../src/kernel/spatial/VertexHashGrid';
import { EPS_LEN } from '../../../src/kernel/tolerance';

/** Small deterministic PRNG (mulberry32) so failures reproduce. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBox(next: () => number): Aabb {
  const x = next() * 100;
  const y = next() * 100;
  const z = next() * 100;
  return { minX: x, minY: y, minZ: z, maxX: x + next() * 10, maxY: y + next() * 10, maxZ: z + next() * 10 };
}

describe('AabbTree', () => {
  it('answers queries exactly like brute force through inserts, removals and updates', () => {
    const next = random(7);
    const tree = new AabbTree();
    const boxes = new Map<number, Aabb>();
    for (let id = 1; id <= 600; id++) {
      const box = randomBox(next);
      tree.insert(id, box);
      boxes.set(id, box);
    }
    for (let i = 0; i < 250; i++) {
      const id = 1 + Math.floor(next() * 600);
      expect(tree.remove(id)).toBe(boxes.delete(id));
    }
    for (let i = 0; i < 150; i++) {
      const id = 1 + Math.floor(next() * 600);
      if (!boxes.has(id)) continue;
      const box = randomBox(next);
      tree.update(id, box);
      boxes.set(id, box);
    }
    expect(tree.validate()).toEqual([]);
    expect(tree.size).toBe(boxes.size);
    expect(tree.height).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(boxes.size)) + 2);
    for (let i = 0; i < 60; i++) {
      const query = randomBox(next);
      const expected = [...boxes].filter(([, box]) => aabbIntersects(box, query)).map(([id]) => id);
      expect(tree.queryItems(query).sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
    }
  });

  it('handles empty trees, duplicates and clearing', () => {
    const tree = new AabbTree();
    const box: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
    expect(tree.height).toBe(-1);
    expect(tree.queryItems(box)).toEqual([]);
    expect(tree.remove(3)).toBe(false);
    tree.insert(3, box);
    expect(tree.has(3)).toBe(true);
    expect(tree.boxOf(3)).toEqual(box);
    expect(() => {
      tree.insert(3, box);
    }).toThrow();
    tree.clear();
    expect(tree.size).toBe(0);
    expect(tree.validate()).toEqual([]);
  });
});

describe('VertexHashGrid', () => {
  it('finds the nearest point within the radius, preferring lower ids on ties', () => {
    const grid = new VertexHashGrid();
    const points: [number, Vec3][] = [
      [5, vec3(0, 0, 0)],
      [2, vec3(EPS_LEN / 2, 0, 0)],
      [9, vec3(-EPS_LEN / 2, 0, 0)],
      [4, vec3(3, 3, 3)],
    ];
    for (const [id, p] of points) grid.insert(id, p);
    expect(grid.findNearest(vec3(0, 0, 0), EPS_LEN)).toBe(5);
    expect(grid.findNearest(vec3(EPS_LEN / 4, 0, 0), EPS_LEN)).toBe(2);
    expect(grid.findNearest(vec3(1, 1, 1), EPS_LEN)).toBeUndefined();
    const tieGrid = new VertexHashGrid();
    tieGrid.insert(8, vec3(EPS_LEN / 2, 0, 0));
    tieGrid.insert(3, vec3(-EPS_LEN / 2, 0, 0));
    expect(tieGrid.findNearest(vec3(0, 0, 0), EPS_LEN)).toBe(3);
  });

  it('moves and removes points, including far from the origin', () => {
    const grid = new VertexHashGrid();
    const far = vec3(9_999_999.5, -4_000_000.25, 12.75);
    grid.insert(1, far);
    expect(grid.findNearest(far, EPS_LEN)).toBe(1);
    grid.move(1, vec3(0, 0, 0));
    expect(grid.findNearest(far, EPS_LEN)).toBeUndefined();
    expect(grid.findNearest(vec3(0, 0, 0), EPS_LEN)).toBe(1);
    expect(grid.remove(1)).toBe(true);
    expect(grid.remove(1)).toBe(false);
    expect(grid.size).toBe(0);
  });

  it('rejects duplicate ids, invalid cell sizes and oversized queries', () => {
    const grid = new VertexHashGrid();
    grid.insert(1, vec3(0, 0, 0));
    expect(() => {
      grid.insert(1, vec3(1, 0, 0));
    }).toThrow();
    expect(() => new VertexHashGrid(0)).toThrow();
    expect(() => grid.findNearest(vec3(0, 0, 0), 1)).toThrow();
  });
});
