import { expect } from 'vitest';
import type { DefinitionId, FaceId } from '../../src/kernel/ids';
import { vec3, type Vec3 } from '../../src/kernel/math/vec3';
import type { EntityStore } from '../../src/kernel/model/EntityStore';
import { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { validateDocument } from '../../src/kernel/model/validate';
import {
  insertSegments,
  type InsertSegmentsResult,
  type SegmentInput,
} from '../../src/kernel/ops/insertSegments';
import { faceArea } from '../../src/kernel/ops/planar/regions';

/** A document that validates every transaction, so any invariant violation fails the test that caused it. */
export function newDocument(): ModelDocument {
  return new ModelDocument({ validateOnCommit: true });
}

export interface Counts {
  readonly v: number;
  readonly e: number;
  readonly f: number;
}

export function counts(doc: ModelDocument, context: DefinitionId = doc.rootDefinitionId): Counts {
  const store = doc.store(context);
  return { v: store.vertexCount, e: store.edgeCount, f: store.faceCount };
}

export function segment(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): SegmentInput {
  return { a: vec3(...a), b: vec3(...b) };
}

/** Closed polyline through the points, as segments. */
export function polygon(points: readonly Vec3[]): SegmentInput[] {
  return points.map((a, i) => ({ a, b: points[(i + 1) % points.length] ?? a }));
}

/** Axis-aligned rectangle in the horizontal plane at height `z`. */
export function rectangle(x0: number, y0: number, x1: number, y1: number, z = 0): SegmentInput[] {
  return polygon([vec3(x0, y0, z), vec3(x1, y0, z), vec3(x1, y1, z), vec3(x0, y1, z)]);
}

export function draw(
  doc: ModelDocument,
  segments: readonly SegmentInput[],
  context: DefinitionId = doc.rootDefinitionId,
): InsertSegmentsResult {
  return insertSegments(doc, context, segments, { autoFace: true });
}

/** The 12 edges of an axis-aligned box; drawing them creates its 6 faces. */
export function boxEdges(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): SegmentInput[] {
  const c = (x: number, y: number, z: number): Vec3 => vec3(x, y, z);
  const bottom = [c(x0, y0, z0), c(x1, y0, z0), c(x1, y1, z0), c(x0, y1, z0)];
  const top = [c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)];
  return [...polygon(bottom), ...polygon(top), ...bottom.map((a, i) => ({ a, b: top[i] ?? a }))];
}

export function expectValid(doc: ModelDocument): void {
  expect(validateDocument(doc).problems).toEqual([]);
}

export function faceIds(store: EntityStore): FaceId[] {
  return [...store.faces()].map((face) => face.id).sort((a, b) => a - b);
}

export function areas(store: EntityStore): number[] {
  return faceIds(store)
    .map((id) => faceArea(store, id))
    .sort((a, b) => a - b);
}

/** True when every edge shared by two faces is traversed in opposite directions by them. */
export function orientationConsistent(store: EntityStore): boolean {
  for (const edge of store.edges()) {
    if (edge.faces.length !== 2) continue;
    const uses = edge.faces.map((faceId) => {
      const face = store.getFace(faceId);
      return [face.outer, ...face.inners].flat().find((use) => use.edge === edge.id);
    });
    const [first, second] = uses;
    if (!first || !second || first.reversed === second.reversed) return false;
  }
  return true;
}
