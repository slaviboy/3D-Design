import { KernelError } from '../errors';
import type { CurveId, DefinitionId, EdgeId, FaceId, VertexId } from '../ids';
import { planeFromPolygon } from '../math/plane';
import {
  add,
  cross,
  distance,
  dot,
  length,
  normalize,
  pointsCoincide,
  scale,
  sub,
  type Vec3,
} from '../math/vec3';
import type { EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import { removeFace, reverseFace, setEdgeAttributes } from '../model/mutations';
import { DEFAULT_EDGE_ATTRIBUTES, type EdgeAttributes } from '../model/types';
import { isParallelBySine } from '../tolerance';
import { removeEdgeAndOrphans } from './erase';
import { insertSegments, type SegmentInput } from './insertSegments';
import { settleRegion } from './planar/settle';

export interface FollowMeResult {
  /** Faces of the swept shape, caps included. */
  readonly faces: readonly FaceId[];
  /** Edges the sweep created. */
  readonly edges: readonly EdgeId[];
}

/** An ordered path: `points[i] → points[i + 1]` runs along `edges[i]`; a closed path also runs from the last point back to the first. */
interface OrderedPath {
  readonly points: readonly Vec3[];
  readonly edges: readonly EdgeId[];
  readonly closed: boolean;
}

interface SweepPolygon {
  outer: Vec3[];
  inners: Vec3[][];
  /** Indices into the segment list of every boundary segment. */
  readonly segments: readonly number[];
}

const SOFT_SMOOTH: EdgeAttributes = Object.freeze({ ...DEFAULT_EDGE_ATTRIBUTES, soft: true, smooth: true });

const byId = (a: number, b: number): number => a - b;

function refuse(message: string): never {
  throw new KernelError('invalid-operation', message);
}

/** Orders an unordered set of edges into one chain; refuses branches and disconnected pieces. */
function orderPath(store: EntityStore, edgeIds: readonly EdgeId[]): OrderedPath {
  const edges = new Set(edgeIds);
  const incident = new Map<VertexId, EdgeId[]>();
  for (const edgeId of [...edges].sort(byId)) {
    const edge = store.getEdge(edgeId);
    for (const vertex of [edge.v0, edge.v1]) {
      const list = incident.get(vertex);
      if (list) list.push(edgeId);
      else incident.set(vertex, [edgeId]);
    }
  }
  for (const list of incident.values()) {
    if (list.length > 2) refuse('The path branches. Select a single chain of connected edges.');
  }
  const ends = [...incident].filter(([, list]) => list.length === 1).map(([vertex]) => vertex);
  if (ends.length !== 0 && ends.length !== 2) refuse('The path edges are not connected.');
  const closed = ends.length === 0;
  const [firstEdge] = [...edges].sort(byId);
  if (firstEdge === undefined) refuse('Select the path edges first.');
  const start = closed ? store.getEdge(firstEdge).v0 : (ends.sort(byId)[0] ?? store.getEdge(firstEdge).v0);

  const vertices: VertexId[] = [start];
  const ordered: EdgeId[] = [];
  const used = new Set<EdgeId>();
  let current = start;
  for (;;) {
    const next = (incident.get(current) ?? []).find((id) => !used.has(id));
    if (next === undefined) break;
    used.add(next);
    ordered.push(next);
    current = store.otherVertex(next, current);
    if (current === start) break;
    vertices.push(current);
  }
  if (ordered.length !== edges.size) refuse('The path edges are not connected.');
  if (closed && ordered.length < 3) refuse('A closed path needs at least three edges.');
  return { points: vertices.map((vertex) => store.position(vertex)), edges: ordered, closed };
}

function reversePath(path: OrderedPath): OrderedPath {
  if (!path.closed) {
    return { points: [...path.points].reverse(), edges: [...path.edges].reverse(), closed: false };
  }
  // Keep the first point first: p0, p(n-1), …, p1, with edges e(n-1), …, e0.
  const [first, ...rest] = path.points;
  return {
    points: first ? [first, ...rest.reverse()] : [],
    edges: [...path.edges].reverse(),
    closed: true,
  };
}

function rotatePath(path: OrderedPath, start: number): OrderedPath {
  return {
    points: [...path.points.slice(start), ...path.points.slice(0, start)],
    edges: [...path.edges.slice(start), ...path.edges.slice(0, start)],
    closed: true,
  };
}

function centroid(points: readonly Vec3[]): Vec3 {
  return scale(
    points.reduce((sum, p) => add(sum, p), { x: 0, y: 0, z: 0 }),
    1 / Math.max(1, points.length),
  );
}

function unitDirection(from: Vec3, to: Vec3): Vec3 {
  const direction = normalize(sub(to, from));
  if (!direction) refuse('The path has a zero-length segment.');
  return direction;
}

/** Moves `point` along `direction` until it reaches the plane through `origin` with normal `normal`. */
function slide(point: Vec3, direction: Vec3, origin: Vec3, normal: Vec3): Vec3 {
  const denominator = dot(direction, normal);
  if (isParallelBySine(denominator)) refuse('The path folds back on itself too sharply to follow.');
  return add(point, scale(direction, dot(sub(origin, point), normal) / denominator));
}

/** Signed volume enclosed by closed polygon loops (outer counter-clockwise, holes clockwise around their normal). */
function soupVolume(polygons: readonly SweepPolygon[]): number {
  let volume = 0;
  for (const polygon of polygons) {
    for (const loop of [polygon.outer, ...polygon.inners]) {
      const [anchor] = loop;
      if (!anchor) continue;
      let area = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i];
        const q = loop[(i + 1) % loop.length];
        if (p && q) area = add(area, cross(p, q));
      }
      volume += dot(area, anchor) / 6;
    }
  }
  return volume;
}

/** Removes consecutive coincident points (a profile point on the sweep axis collapses a quad into a triangle). */
function withoutRepeats(points: readonly Vec3[]): Vec3[] {
  const result: Vec3[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (!last || !pointsCoincide(last, point)) result.push(point);
  }
  const first = result[0];
  const last = result.at(-1);
  if (result.length > 1 && first && last && pointsCoincide(first, last)) result.pop();
  return result;
}

/**
 * Sweeps a planar profile face along a chain of edges. Consecutive copies of the profile lie on the bisector
 * (miter) planes at the path's joints, and neighbouring copies are joined by four-sided faces. An open path keeps
 * the profile as the start cap and adds an end cap; a closed path makes a closed ring, which around a circle is a
 * lathe. Edges running along a curved path or a curved profile are soft and smooth.
 *
 * Refused, leaving the model unchanged: a path that branches or is not connected, and a profile whose plane is
 * parallel to the path where the sweep starts. GEOMETRY.md ("Algorithm: Follow Me").
 */
export function followMe(
  doc: ModelDocument,
  context: DefinitionId,
  profileFaceId: FaceId,
  pathEdgeIds: readonly EdgeId[],
): FollowMeResult {
  const store = doc.store(context);
  const profile = store.getFace(profileFaceId);
  const profileNormal = store.getFacePlane(profileFaceId).normal;
  const profileEdges = new Set(store.faceEdges(profileFaceId));
  const pathEdges = [...new Set(pathEdgeIds)].filter((id) => !profileEdges.has(id));
  for (const id of pathEdges) store.getEdge(id);
  if (pathEdges.length === 0) refuse('Select path edges that are not part of the profile.');

  let path = orderPath(store, pathEdges);
  const loops = store.faceLoops(profileFaceId).map((loop) => ({
    points: store.loopPoints(loop),
    curves: loop.map((use): CurveId | null => store.getEdge(use.edge).curve),
  }));
  const profileCenter = centroid(loops[0]?.points ?? []);

  // Start where the profile is.
  if (path.closed) {
    let nearest = 0;
    path.points.forEach((point, index) => {
      const best = path.points[nearest];
      if (best && distance(point, profileCenter) < distance(best, profileCenter)) nearest = index;
    });
    path = rotatePath(path, nearest);
    const [p0, p1] = path.points;
    const last = path.points.at(-1);
    if (p0 && p1 && last) {
      const forward = Math.abs(dot(profileNormal, unitDirection(p0, p1)));
      const backward = Math.abs(dot(profileNormal, unitDirection(p0, last)));
      if (backward > forward) path = reversePath(path);
    }
  } else {
    const first = path.points[0];
    const last = path.points.at(-1);
    if (first && last && distance(last, profileCenter) < distance(first, profileCenter))
      path = reversePath(path);
  }

  const points = path.points;
  const count = points.length;
  const segmentCount = path.closed ? count : count - 1;
  const directions: Vec3[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % count];
    if (!a || !b) refuse('The path is incomplete.');
    directions.push(unitDirection(a, b));
  }
  const [firstDirection] = directions;
  if (!firstDirection || isParallelBySine(dot(profileNormal, firstDirection))) {
    throw new KernelError(
      'invalid-geometry',
      'The profile face must not be parallel to the path where it starts.',
    );
  }

  /** Normal of the miter plane at path point `i`. */
  const miter = (i: number): Vec3 => {
    const incoming = directions[(i - 1 + segmentCount) % segmentCount];
    const outgoing = directions[i % segmentCount];
    if (!path.closed && i === 0) return firstDirection;
    if (!path.closed && i === count - 1) return directions[segmentCount - 1] ?? firstDirection;
    if (!incoming || !outgoing) return firstDirection;
    const sum = add(incoming, outgoing);
    if (isParallelBySine(length(sum) / 2)) refuse('The path turns back on itself.');
    return normalize(sum) ?? firstDirection;
  };

  // Profile copies, one per path point. Each is the previous copy slid along the segment onto the next miter plane.
  const copies: Vec3[][][] = [];
  const origin = points[0] ?? profileCenter;
  copies.push(
    loops.map((loop) =>
      path.closed ? loop.points.map((p) => slide(p, firstDirection, origin, miter(0))) : [...loop.points],
    ),
  );
  for (let i = 1; i < count; i++) {
    const previous = copies[i - 1] ?? [];
    const direction = directions[i - 1] ?? firstDirection;
    const through = points[i] ?? origin;
    const normal = miter(i);
    copies.push(previous.map((loop) => loop.map((p) => slide(p, direction, through, normal))));
  }

  // Segments: rings (profile copies) and longitudinal edges between consecutive copies.
  const segments: SegmentInput[] = [];
  const soft: boolean[] = [];
  const addSegment = (a: Vec3, b: Vec3, isSoft: boolean): number => {
    soft.push(isSoft);
    return segments.push({ a, b }) - 1;
  };
  const pathCurve = (segment: number): CurveId | null =>
    store.getEdge(path.edges[(segment + segmentCount) % segmentCount] ?? pathEdges[0] ?? (0 as EdgeId)).curve;
  const ringSoft = (i: number): boolean => {
    if (!path.closed && (i === 0 || i === count - 1)) return false;
    const before = pathCurve(i - 1);
    return before !== null && before === pathCurve(i);
  };

  const ringIndex: number[][][] = copies.map((copy, i) =>
    copy.map((loop) => loop.map((p, j) => addSegment(p, loop[(j + 1) % loop.length] ?? p, ringSoft(i)))),
  );
  const bands = path.closed ? count : count - 1;
  const longitudinalIndex: number[][][] = [];
  for (let k = 0; k < bands; k++) {
    const from = copies[k] ?? [];
    const to = copies[(k + 1) % count] ?? [];
    longitudinalIndex.push(
      from.map((loop, l) =>
        loop.map((p, j) => {
          const curves = loops[l]?.curves ?? [];
          const before = curves[(j - 1 + curves.length) % curves.length] ?? null;
          return addSegment(p, to[l]?.[j] ?? p, before !== null && before === curves[j]);
        }),
      ),
    );
  }

  const polygons: SweepPolygon[] = [];
  for (let k = 0; k < bands; k++) {
    const next = (k + 1) % count;
    (copies[k] ?? []).forEach((loop, l) => {
      loop.forEach((a, j) => {
        const j1 = (j + 1) % loop.length;
        const b = loop[j1] ?? a;
        const b1 = copies[next]?.[l]?.[j1] ?? b;
        const a1 = copies[next]?.[l]?.[j] ?? a;
        const outer = withoutRepeats([a, b, b1, a1]);
        if (outer.length < 3 || !planeFromPolygon(outer)) return;
        polygons.push({
          outer,
          inners: [],
          segments: [
            ringIndex[k]?.[l]?.[j] ?? -1,
            longitudinalIndex[k]?.[l]?.[j1] ?? -1,
            ringIndex[next]?.[l]?.[j] ?? -1,
            longitudinalIndex[k]?.[l]?.[j] ?? -1,
          ],
        });
      });
    });
  }
  let startCap: SweepPolygon | null = null;
  if (!path.closed) {
    const capOf = (index: number, reversed: boolean): SweepPolygon => {
      const copy = copies[index] ?? [];
      const orient = (loop: readonly Vec3[]): Vec3[] => (reversed ? [...loop].reverse() : [...loop]);
      return {
        outer: orient(copy[0] ?? []),
        inners: copy.slice(1).map(orient),
        segments: (ringIndex[index] ?? []).flat(),
      };
    };
    startCap = capOf(0, true);
    polygons.push(startCap, capOf(count - 1, false));
  }

  // Face the outside: flip everything when the planned shell encloses negative volume.
  if (soupVolume(polygons) < 0) {
    for (const polygon of polygons) {
      polygon.outer.reverse();
      for (const inner of polygon.inners) inner.reverse();
    }
  }

  return doc.transact('Follow Me', () => {
    if (path.closed) {
      removeFace(doc, context, profileFaceId);
      const pathSet = new Set(path.edges);
      for (const edgeId of [...profileEdges].sort(byId)) {
        const edge = store.edge(edgeId);
        if (edge?.faces.length === 0 && !pathSet.has(edgeId)) removeEdgeAndOrphans(doc, context, edgeId);
      }
    } else if (startCap) {
      const capPlane = planeFromPolygon(startCap.outer);
      if (capPlane && dot(capPlane.normal, profileNormal) < 0) reverseFace(doc, context, profileFaceId);
    }

    const inserted = insertSegments(doc, context, segments, { autoFace: false });
    const edgesOf = (index: number): readonly EdgeId[] => inserted.segmentEdges[index] ?? [];
    soft.forEach((isSoft, index) => {
      if (!isSoft) return;
      for (const edgeId of edgesOf(index)) {
        if (store.edge(edgeId)) setEdgeAttributes(doc, context, edgeId, SOFT_SMOOTH);
      }
    });

    const faces = new Set<FaceId>();
    for (const polygon of polygons) {
      const plane = planeFromPolygon(polygon.outer);
      if (!plane) continue;
      const covering = settleRegion(doc, context, {
        plane,
        seeds: polygon.segments.flatMap((index) => edgesOf(index)),
        outer: polygon.outer,
        inners: polygon.inners,
        normal: plane.normal,
        attributes: profile.attributes,
        rule: 'merge',
      });
      for (const faceId of covering) faces.add(faceId);
    }
    return {
      faces: [...faces].filter((id) => store.face(id) !== undefined).sort(byId),
      edges: [...new Set(inserted.createdEdges)].filter((id) => store.edge(id) !== undefined).sort(byId),
    };
  });
}
