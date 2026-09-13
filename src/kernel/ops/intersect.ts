import type { DefinitionId, EdgeId, FaceId } from '../ids';
import { aabbExpand, aabbFromPoints, aabbIntersects, type Aabb } from '../math/aabb';
import { classifyPointInPolygon, type Point2 } from '../math/geom2d';
import { IDENTITY, multiply, transformPoint, type Mat4 } from '../math/mat4';
import { planeBasis, planeFromPolygon, projectTo2D, type Plane } from '../math/plane';
import { add, cross, dot, length, scale, type Vec3 } from '../math/vec3';
import type { EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import { EPS_LEN, isParallelBySine } from '../tolerance';
import { insertSegments, type SegmentInput } from './insertSegments';

export type IntersectTarget = 'model' | 'selection';

export interface IntersectFacesOptions {
  /**
   * - `model`: intersect with every other face in the context, including faces inside groups and components
   * - `selection`: intersect the given faces only with each other
   */
  readonly with: IntersectTarget;
}

/** A planar polygon with holes in context coordinates. */
interface PlanarPolygon {
  /** The face id when the polygon belongs to the context itself; null for faces inside instances. */
  readonly faceId: FaceId | null;
  readonly outer: readonly Vec3[];
  readonly inners: readonly (readonly Vec3[])[];
  readonly plane: Plane;
  readonly bounds: Aabb;
}

interface Interval {
  readonly from: number;
  readonly to: number;
}

const byId = (a: number, b: number): number => a - b;

function contextPolygon(store: EntityStore, faceId: FaceId): PlanarPolygon | null {
  const face = store.face(faceId);
  if (!face?.plane) return null;
  const outer = store.loopPoints(face.outer);
  return {
    faceId,
    outer,
    inners: face.inners.map((loop) => store.loopPoints(loop)),
    plane: face.plane,
    bounds: aabbFromPoints(outer),
  };
}

/** Faces of every instance inside `context`, at any depth, transformed into the context's coordinates. */
function instancePolygons(doc: ModelDocument, context: DefinitionId): PlanarPolygon[] {
  const polygons: PlanarPolygon[] = [];
  const visit = (definition: DefinitionId, transform: Mat4, depth: number): void => {
    const store = doc.store(definition);
    if (depth > 0) {
      for (const face of store.faces()) {
        if (!face.plane) continue;
        const outer = store.loopPoints(face.outer).map((p) => transformPoint(transform, p));
        const plane = planeFromPolygon(outer);
        if (!plane) continue;
        polygons.push({
          faceId: null,
          outer,
          inners: face.inners.map((loop) => store.loopPoints(loop).map((p) => transformPoint(transform, p))),
          plane,
          bounds: aabbFromPoints(outer),
        });
      }
    }
    for (const instance of store.instances()) {
      visit(instance.definitionId, multiply(transform, instance.transform), depth + 1);
    }
  };
  visit(context, IDENTITY, 0);
  return polygons;
}

/** The line where two planes meet, or null when they are parallel (coplanar faces included). */
function planeIntersectionLine(a: Plane, b: Plane): { point: Vec3; direction: Vec3 } | null {
  const u = cross(a.normal, b.normal);
  const sine = length(u);
  if (isParallelBySine(sine)) return null;
  // The point on both planes closest to the origin.
  const point = scale(
    add(scale(cross(b.normal, u), a.offset), scale(cross(u, a.normal), b.offset)),
    1 / (sine * sine),
  );
  return { point, direction: scale(u, 1 / sine) };
}

/**
 * Parameter intervals along the line `point + t·direction` (which lies in the polygon's plane) where the line is
 * inside the polygon or on its boundary.
 */
function clipLineToPolygon(polygon: PlanarPolygon, point: Vec3, direction: Vec3): Interval[] {
  const basis = planeBasis(polygon.plane.normal);
  const origin = projectTo2D(basis, point);
  const along = { x: dot(direction, basis.u), y: dot(direction, basis.v) };
  const across = { x: -along.y, y: along.x };
  const rings = [polygon.outer, ...polygon.inners].map((ring) => ring.map((p) => projectTo2D(basis, p)));
  const side = (q: Point2): number => (q.x - origin.x) * across.x + (q.y - origin.y) * across.y;
  const parameter = (q: Point2): number => (q.x - origin.x) * along.x + (q.y - origin.y) * along.y;

  const parameters: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (!a || !b) continue;
      const sa = side(a);
      const sb = side(b);
      if (Math.abs(sa) <= EPS_LEN) {
        parameters.push(parameter(a));
      } else if (Math.abs(sb) > EPS_LEN && Math.sign(sa) !== Math.sign(sb)) {
        const ta = parameter(a);
        parameters.push(ta + ((parameter(b) - ta) * sa) / (sa - sb));
      }
    }
  }
  parameters.sort((x, y) => x - y);
  const distinct: number[] = [];
  for (const t of parameters) {
    const last = distinct.at(-1);
    if (last === undefined || t - last > EPS_LEN) distinct.push(t);
  }

  const [outer = [], ...holes] = rings;
  const intervals: Interval[] = [];
  for (let i = 0; i + 1 < distinct.length; i++) {
    const from = distinct[i] ?? 0;
    const to = distinct[i + 1] ?? 0;
    const middle = (from + to) / 2;
    const sample = { x: origin.x + along.x * middle, y: origin.y + along.y * middle };
    if (classifyPointInPolygon(sample, outer, holes) === 'outside') continue;
    const previous = intervals.at(-1);
    if (previous && Math.abs(previous.to - from) <= EPS_LEN)
      intervals[intervals.length - 1] = { from: previous.from, to };
    else intervals.push({ from, to });
  }
  return intervals;
}

function overlapIntervals(first: readonly Interval[], second: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const a of first) {
    for (const b of second) {
      const from = Math.max(a.from, b.from);
      const to = Math.min(a.to, b.to);
      if (to - from > EPS_LEN) result.push({ from, to });
    }
  }
  return result;
}

/** The segments where two planar polygons meet. Coplanar and parallel polygons give none. */
function intersectPolygons(a: PlanarPolygon, b: PlanarPolygon): SegmentInput[] {
  if (!aabbIntersects(aabbExpand(a.bounds, EPS_LEN), aabbExpand(b.bounds, EPS_LEN))) return [];
  const line = planeIntersectionLine(a.plane, b.plane);
  if (!line) return [];
  const overlap = overlapIntervals(
    clipLineToPolygon(a, line.point, line.direction),
    clipLineToPolygon(b, line.point, line.direction),
  );
  return overlap.map((interval) => ({
    a: add(line.point, scale(line.direction, interval.from)),
    b: add(line.point, scale(line.direction, interval.to)),
  }));
}

/**
 * Adds edges where the given faces meet other faces, splitting the faces of the context along them. With
 * `with: 'model'` the other faces are every face in the context plus the faces inside its groups and components
 * (whose own geometry is not changed); with `with: 'selection'` they are only the given faces. The faces don't
 * need to form solids. Returns the edges the operation created. GEOMETRY.md ("Algorithm: Intersect Faces").
 */
export function intersectFaces(
  doc: ModelDocument,
  context: DefinitionId,
  faceIds: readonly FaceId[],
  options: IntersectFacesOptions,
): EdgeId[] {
  const store = doc.store(context);
  const selected = [...new Set(faceIds)]
    .sort(byId)
    .map((id) => contextPolygon(store, id))
    .filter((polygon): polygon is PlanarPolygon => polygon !== null);
  const selectedIds = new Set(selected.map((polygon) => polygon.faceId));

  let others: PlanarPolygon[];
  if (options.with === 'selection') {
    others = selected;
  } else {
    others = [...store.faces()]
      .map((face) => face.id)
      .filter((id) => !selectedIds.has(id))
      .sort(byId)
      .map((id) => contextPolygon(store, id))
      .filter((polygon): polygon is PlanarPolygon => polygon !== null);
    others.push(...selected, ...instancePolygons(doc, context));
  }

  const segments: SegmentInput[] = [];
  const done = new Set<string>();
  for (const polygon of selected) {
    for (const other of others) {
      if (other === polygon) continue;
      if (other.faceId !== null && polygon.faceId !== null) {
        const key = `${String(Math.min(other.faceId, polygon.faceId))}:${String(Math.max(other.faceId, polygon.faceId))}`;
        if (done.has(key)) continue;
        done.add(key);
      }
      segments.push(...intersectPolygons(polygon, other));
    }
  }
  if (segments.length === 0) return [];

  return doc.transact('Intersect Faces', () => {
    const result = insertSegments(doc, context, segments, { autoFace: true });
    return [...new Set(result.createdEdges)].filter((id) => store.edge(id) !== undefined).sort(byId);
  });
}
