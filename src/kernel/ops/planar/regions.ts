import type { EdgeId, FaceId, VertexId } from '../../ids';
import { classifyPointInRing, interiorPoint, signedArea, type Point2 } from '../../math/geom2d';
import { planeBasis, projectTo2D, type PlaneBasis } from '../../math/plane';
import type { EntityStore } from '../../model/EntityStore';
import { reverseLoop } from '../../model/mutations';
import type { FaceLoops, Loop } from '../../model/types';
import { EPS_AREA } from '../../tolerance';
import { tracePlanarCycles, type PlanarCycle } from './traceCycles';

/** A bounded planar region: a counter-clockwise outer loop plus the clockwise hole loops directly inside it. */
export interface PlanarRegion {
  readonly outer: PlanarCycle;
  readonly holes: readonly PlanarCycle[];
  /** A point strictly inside the region, in the plane basis. */
  readonly sample: Point2;
  /** Net area (outer minus holes). */
  readonly area: number;
}

export interface FaceRings {
  readonly outer: readonly Point2[];
  readonly inners: readonly (readonly Point2[])[];
}

/**
 * Splits a traced cycle that passes through the same vertex more than once (a region pinched at a vertex) into
 * simple loops. Every loop starts and ends at the vertex where it was cut off, so each one is closed.
 */
function splitAtRepeatedVertices(cycle: PlanarCycle): PlanarCycle[] {
  if (new Set(cycle.vertices).size === cycle.vertices.length) return [cycle];
  const loops: PlanarCycle[] = [];
  const stack: number[] = [];
  const stackPositionOf = new Map<VertexId, number>();
  const vertexAt = (index: number): VertexId => {
    const vertex = cycle.vertices[index];
    if (vertex === undefined) throw new Error('Cycle vertex index out of range');
    return vertex;
  };
  const subCycle = (indices: readonly number[]): PlanarCycle => {
    const points = indices.map((index) => cycle.points[index] ?? { x: 0, y: 0 });
    return {
      uses: indices.flatMap((index) => cycle.uses[index] ?? []),
      vertices: indices.map(vertexAt),
      points,
      area: signedArea(points),
      component: cycle.component,
    };
  };
  for (let index = 0; index < cycle.uses.length; index++) {
    const vertex = vertexAt(index);
    const position = stackPositionOf.get(vertex);
    if (position !== undefined) {
      // The uses since `vertex` was last reached form a closed loop back to it.
      const closed = stack.splice(position);
      for (const removed of closed) stackPositionOf.delete(vertexAt(removed));
      loops.push(subCycle(closed));
    }
    stackPositionOf.set(vertex, stack.length);
    stack.push(index);
  }
  if (stack.length > 0) loops.push(subCycle(stack));
  return loops;
}

/** Builds the regions enclosed by `edgeIds`, which must all lie in the plane that `basis` spans. */
export function buildRegions(
  store: EntityStore,
  basis: PlaneBasis,
  edgeIds: readonly EdgeId[],
): PlanarRegion[] {
  const cache = new Map<VertexId, Point2>();
  const pointOf = (vertex: VertexId): Point2 => {
    let point = cache.get(vertex);
    if (!point) {
      point = projectTo2D(basis, store.position(vertex));
      cache.set(vertex, point);
    }
    return point;
  };
  const planarEdges = edgeIds.map((id) => {
    const edge = store.getEdge(id);
    return { id, v0: edge.v0, v1: edge.v1 };
  });
  const { cycles } = tracePlanarCycles(planarEdges, pointOf);

  const outers: PlanarCycle[] = [];
  const holesByOuter = new Map<PlanarCycle, PlanarCycle[]>();
  const holeCandidates: PlanarCycle[] = [];
  for (const cycle of cycles) {
    const loops = splitAtRepeatedVertices(cycle);
    if (cycle.area > EPS_AREA) {
      // A bounded region: its largest counter-clockwise loop is the outline; clockwise loops are holes touching it.
      const outer = loops.reduce<PlanarCycle | undefined>(
        (best, loop) => (loop.area > EPS_AREA && (!best || loop.area > best.area) ? loop : best),
        undefined,
      );
      if (!outer) continue;
      outers.push(outer);
      holesByOuter.set(
        outer,
        loops.filter((loop) => loop.area < -EPS_AREA),
      );
    } else if (cycle.area < -EPS_AREA) {
      // The outside of a component; each clockwise loop outlines one island that may be a hole in another region.
      for (const loop of loops) if (loop.area < -EPS_AREA) holeCandidates.push(loop);
    }
  }

  /*
   * True when `island` lies inside `ring`. Boundaries never cross (invariant 6), so the island is inside unless a
   * vertex is outside. It may touch the ring at vertices, so at least one vertex must be strictly inside; when every
   * vertex lies on the ring, a point strictly inside the island decides. That point alone is not enough, because
   * the island may instead enclose the ring.
   */
  const encloses = (
    ring: readonly Point2[],
    island: readonly Point2[],
    islandInterior: Point2 | null,
  ): boolean => {
    let strictlyInside = false;
    for (const point of island) {
      const position = classifyPointInRing(point, ring);
      if (position === 'outside') return false;
      if (position === 'inside') strictlyInside = true;
    }
    return (
      strictlyInside || (islandInterior !== null && classifyPointInRing(islandInterior, ring) === 'inside')
    );
  };

  // An island becomes a hole of the smallest region from another component that encloses it.
  for (const candidate of holeCandidates) {
    const islandInterior = interiorPoint(candidate.points, []);
    let container: PlanarCycle | undefined;
    for (const outer of outers) {
      if (outer.component === candidate.component) continue;
      if (container && outer.area >= container.area) continue;
      if (encloses(outer.points, candidate.points, islandInterior)) container = outer;
    }
    if (container) holesByOuter.get(container)?.push(candidate);
  }

  const regions: PlanarRegion[] = [];
  for (const outer of outers) {
    const holes = holesByOuter.get(outer) ?? [];
    const sample = interiorPoint(
      outer.points,
      holes.map((hole) => hole.points),
    );
    if (!sample) continue;
    const area = outer.area + holes.reduce((sum, hole) => sum + hole.area, 0);
    regions.push({ outer, holes, sample, area });
  }
  return regions;
}

/** Rotates a loop so it starts at its lowest edge id, which keeps loops deterministic. */
export function canonicalLoopStart(loop: Loop): Loop {
  if (loop.length === 0) return loop;
  let minIndex = 0;
  loop.forEach((use, index) => {
    const current = loop[minIndex];
    if (current && use.edge < current.edge) minIndex = index;
  });
  return [...loop.slice(minIndex), ...loop.slice(0, minIndex)];
}

/**
 * Face loops for a region. When `sameDirection` is true the face normal equals the normal of the basis the region
 * was traced in; otherwise every loop is reversed so the face points the other way.
 */
export function loopsForRegion(region: PlanarRegion, sameDirection: boolean): FaceLoops {
  const orientLoop = (loop: Loop): Loop => canonicalLoopStart(sameDirection ? loop : reverseLoop(loop));
  return {
    outer: orientLoop(region.outer.uses),
    inners: region.holes.map((hole) => orientLoop(hole.uses)),
  };
}

function edgeSetKey(loop: Loop): string {
  return loop
    .map((use) => use.edge)
    .sort((a, b) => a - b)
    .join(',');
}

/** True when a face's loops use exactly the same edges as a region's loops. */
export function faceMatchesRegion(store: EntityStore, faceId: FaceId, region: PlanarRegion): boolean {
  const face = store.getFace(faceId);
  if (edgeSetKey(face.outer) !== edgeSetKey(region.outer.uses)) return false;
  if (face.inners.length !== region.holes.length) return false;
  const faceHoles = face.inners.map(edgeSetKey).sort();
  const regionHoles = region.holes.map((hole) => edgeSetKey(hole.uses)).sort();
  return faceHoles.every((key, index) => key === regionHoles[index]);
}

/** The face's loops projected into `basis`, outer first. */
export function faceRings(store: EntityStore, faceId: FaceId, basis: PlaneBasis): FaceRings {
  const face = store.getFace(faceId);
  const project = (loop: Loop): Point2[] => store.loopPoints(loop).map((p) => projectTo2D(basis, p));
  return { outer: project(face.outer), inners: face.inners.map(project) };
}

/** Net area of a face (outer minus holes). Zero for degenerate faces. */
export function faceArea(store: EntityStore, faceId: FaceId): number {
  const plane = store.getFace(faceId).plane;
  if (!plane) return 0;
  const rings = faceRings(store, faceId, planeBasis(plane.normal));
  return (
    Math.abs(signedArea(rings.outer)) -
    rings.inners.reduce((sum, ring) => sum + Math.abs(signedArea(ring)), 0)
  );
}
