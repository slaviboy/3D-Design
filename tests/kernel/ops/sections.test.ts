import { describe, expect, it } from 'vitest';
import { KernelError } from '../../../src/kernel/errors';
import { vec3, type Vec3 } from '../../../src/kernel/math/vec3';
import { addSectionPlane } from '../../../src/kernel/model/mutations';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import {
  contextContentBounds,
  createGroupFromSlice,
  sectionCut,
  sectionRectangle,
  sectionSegments,
} from '../../../src/kernel/ops/sections';
import { areas, boxEdges, counts, draw, expectValid, newDocument, segment } from '../helpers';

function triangleArea(triangles: readonly number[]): number {
  let total = 0;
  for (let i = 0; i + 8 < triangles.length; i += 9) {
    const at = (offset: number): number => triangles[i + offset] ?? 0;
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(at) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    total += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return total;
}

const HORIZONTAL = (z: number) => ({ point: vec3(0, 0, z), normal: vec3(0, 0, 1) });

describe('section cuts', () => {
  it('slice a closed box into one filled square', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 2, 2, 2));
    const context = doc.rootDefinitionId;
    expect(sectionSegments(doc, context, HORIZONTAL(1))).toHaveLength(4);
    const cut = sectionCut(doc, context, HORIZONTAL(1));
    expect(cut.loops).toHaveLength(1);
    expect(cut.loops[0]).toHaveLength(4);
    expect(triangleArea(cut.triangles)).toBeCloseTo(4, 9);
    for (let i = 2; i < cut.triangles.length; i += 3) expect(cut.triangles[i]).toBeCloseTo(1, 12);
  });

  it('treat nested outlines as holes', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 4, 4, 2));
    draw(doc, boxEdges(1, 1, 0.5, 3, 3, 1.5));
    const cut = sectionCut(doc, doc.rootDefinitionId, HORIZONTAL(1));
    expect(cut.loops).toHaveLength(2);
    expect(triangleArea(cut.triangles)).toBeCloseTo(12, 9);
  });

  it('cut through a vertex and along a boundary edge without spurious segments', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 2, 2, 2));
    // The plane through the top face: the side faces behind it report the top edges.
    const top = sectionCut(doc, doc.rootDefinitionId, HORIZONTAL(2));
    expect(top.loops).toHaveLength(1);
    expect(triangleArea(top.triangles)).toBeCloseTo(4, 9);
    // A diagonal plane through two opposite vertical edges.
    const diagonal = { point: vec3(0, 0, 0), normal: vec3(Math.SQRT1_2, -Math.SQRT1_2, 0) };
    const cut = sectionCut(doc, doc.rootDefinitionId, diagonal);
    expect(cut.loops).toHaveLength(1);
    expect(triangleArea(cut.triangles)).toBeCloseTo(2 * 2 * Math.SQRT2, 9);
  });

  it('leave open outlines unfilled', () => {
    const doc = newDocument();
    draw(doc, [
      segment([0, 0, 0], [2, 0, 0]),
      segment([2, 0, 0], [2, 0, 2]),
      segment([2, 0, 2], [0, 0, 2]),
      segment([0, 0, 2], [0, 0, 0]),
    ]);
    expect(sectionSegments(doc, doc.rootDefinitionId, HORIZONTAL(1))).toHaveLength(1);
    expect(sectionCut(doc, doc.rootDefinitionId, HORIZONTAL(1)).triangles).toEqual([]);
  });
});

describe('create group from slice', () => {
  it('puts the cut outline and its face into a new group, as one undoable step', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 2, 2, 2));
    const context = doc.rootDefinitionId;
    const plane = doc.transact('Place', () =>
      addSectionPlane(doc, context, { name: 'Cut', ...HORIZONTAL(0.75), active: true }),
    );
    const before = hashDocument(doc);
    const rootCounts = counts(doc);

    const { definition, instance } = createGroupFromSlice(doc, context, plane);
    expect(counts(doc, definition)).toEqual({ v: 4, e: 4, f: 1 });
    expect(areas(doc.store(definition))).toEqual([expect.closeTo(4, 9)]);
    expect([...doc.store(definition).vertices()].every((v) => Math.abs(v.position.z - 0.75) < 1e-12)).toBe(
      true,
    );
    expect(doc.rootStore.instance(instance)?.definitionId).toBe(definition);
    expect(counts(doc)).toEqual(rootCounts);
    expectValid(doc);

    doc.undo();
    expect(hashDocument(doc)).toBe(before);
  });

  it('keeps holes as holes and refuses planes that cut nothing', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 4, 4, 2));
    draw(doc, boxEdges(1, 1, 0.5, 3, 3, 1.5));
    const context = doc.rootDefinitionId;
    const [through, above] = doc.transact('Place', () => [
      addSectionPlane(doc, context, { name: 'Through', ...HORIZONTAL(1) }),
      addSectionPlane(doc, context, { name: 'Above', ...HORIZONTAL(5) }),
    ]);
    const { definition } = createGroupFromSlice(doc, context, through);
    const store = doc.store(definition);
    expect(counts(doc, definition)).toMatchObject({ v: 8, e: 8 });
    expect([...store.faces()].some((face) => face.inners.length === 1)).toBe(true);
    expectValid(doc);
    const depth = doc.undoDepth;
    expect(() => createGroupFromSlice(doc, context, above)).toThrow(KernelError);
    expect(doc.undoDepth).toBe(depth);
  });
});

describe('section plane rectangle', () => {
  it('lies in the plane and spans the content', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 2, 2, 2));
    const bounds = contextContentBounds(doc, doc.rootDefinitionId);
    const plane = { point: vec3(1, 0.5, 0), normal: vec3(0, 1, 0) };
    const corners = sectionRectangle(plane, bounds);
    for (const corner of corners) expect(corner.y).toBeCloseTo(0.5, 12);
    const xs = corners.map((c: Vec3) => c.x);
    const zs = corners.map((c: Vec3) => c.z);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(2);
    expect(Math.min(...zs)).toBeLessThan(0);
    expect(Math.max(...zs)).toBeGreaterThan(2);
    const horizontal = sectionRectangle({ point: vec3(0, 0, 1), normal: vec3(0, 0, -1) }, bounds);
    for (const corner of horizontal) expect(corner.z).toBeCloseTo(1, 12);
  });
});
