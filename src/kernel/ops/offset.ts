import { KernelError } from '../errors';
import type { CurveId, DefinitionId, EdgeId, FaceId } from '../ids';
import { orient, signedArea, windingNumber, type Point2 } from '../math/geom2d';
import {
  isPointOnPlane,
  planeBasis,
  planeFromPointNormal,
  projectTo2D,
  unprojectFrom2D,
  type Plane,
  type PlaneBasis,
} from '../math/plane';
import { cross, length, normalize, type Vec3 } from '../math/vec3';
import type { EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import { addCurve } from '../model/mutations';
import type { CurveParams, Loop } from '../model/types';
import { EPS_LEN, EPS_PARALLEL, isParallelBySine } from '../tolerance';
import { orderEdgeChain } from './chains';
import { splitCurveChains } from './curves';
import { insertSegments, type SegmentInput } from './insertSegments';

export interface OffsetResult {
  /** Edges that now carry the offset geometry. */
  readonly edges: readonly EdgeId[];
  /** Faces created by the offset (a split face keeps its id for its largest part). */
  readonly faces: readonly FaceId[];
}

export interface OffsetFaceOptions {
  /** Keep self-overlapping parts of offset loops instead of removing them (Alt in the reference workflow). */
  readonly keepOverlaps?: boolean;
}

type CircularParams = Extract<CurveParams, { kind: 'arc' | 'circle' }>;

/** The circle an edge lies on, when the edge belongs to an arc or circle curve with parameters that still fit it. */
interface SourceCircle {
  readonly curve: CurveId;
  readonly params: CircularParams;
  readonly edgeCount: number;
  /** Center in the plane basis. */
  readonly center: Point2;
}

/** One source edge in the plane basis, in traversal order. */
interface SourceSegment {
  readonly a: Point2;
  readonly b: Point2;
  readonly circle: SourceCircle | null;
}

/** A face loop or an edge chain, as 2D segments. */
interface SourcePath {
  readonly segments: readonly SourceSegment[];
  readonly closed: boolean;
}

/** The offset of one source segment before joining: the line it lies on, through its offset endpoints. */
interface OffsetLine {
  readonly start: Point2;
  readonly end: Point2;
  /** Set when the segment was offset analytically as a chord of a circle with radius `radius`. */
  readonly circle: SourceCircle | null;
  readonly radius: number;
  /** Distance between the source segment's line and this line. */
  readonly clearance: number;
}

/** One mitered offset segment. */
interface RawSegment {
  readonly a: Point2;
  readonly b: Point2;
  readonly line: OffsetLine;
}

/** A piece of a raw segment between intersections. */
interface Piece {
  readonly a: Point2;
  readonly b: Point2;
  readonly path: number;
  readonly raw: number;
  /** The piece is the whole raw segment. */
  readonly whole: boolean;
}

const sub2 = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y });
const cross2 = (a: Point2, b: Point2): number => a.x * b.y - a.y * b.x;
const dot2 = (a: Point2, b: Point2): number => a.x * b.x + a.y * b.y;
const dist2 = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);
const lerp2 = (a: Point2, b: Point2, t: number): Point2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

function item<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`Offset index ${String(index)} out of range`);
  return value;
}

/**
 * Offsets every loop of a planar face within its plane and inserts the result, which splits the face into a ring
 * and an inner part (or adds a ring around it).
 *
 * Sign convention: a positive `distance` moves toward the face's interior, so the outer loop shrinks and holes grow;
 * a negative one moves away from it. Joins are mitered, and arc and circle edges are offset analytically.
 * GEOMETRY.md ("Algorithm: Offset").
 */
export function offsetFace(
  doc: ModelDocument,
  context: DefinitionId,
  faceId: FaceId,
  distance: number,
  options: OffsetFaceOptions = {},
): OffsetResult {
  assertDistance(distance);
  return doc.transact('Offset', () => {
    const store = doc.store(context);
    const plane = store.getFacePlane(faceId);
    const basis = planeBasis(plane.normal);
    const paths = store
      .faceLoops(faceId)
      .map((loop) => ({ segments: loopSegments(store, loop, basis, plane), closed: true }));
    return offsetPaths(doc, context, paths, distance, basis, plane, options.keepOverlaps === true, 1);
  });
}

/**
 * Offsets a connected, coplanar chain of edges (open or closed) within the plane perpendicular to `normal`.
 *
 * Sign convention: the chain is walked from the first listed edge's `v0` to its `v1`. Looking against `normal`
 * (from its tip down onto the plane), a positive `distance` moves to the left of that walking direction. Overlaps
 * are always removed.
 */
export function offsetEdges(
  doc: ModelDocument,
  context: DefinitionId,
  edgeIds: readonly EdgeId[],
  distance: number,
  normal: Vec3,
): OffsetResult {
  assertDistance(distance);
  const unit = normalize(normal);
  if (!unit) throw new KernelError('invalid-geometry', 'The offset plane needs a non-zero normal');
  return doc.transact('Offset', () => {
    const store = doc.store(context);
    const chain = orderEdgeChain(store, edgeIds);
    const points = chain.vertices.map((vertex) => store.position(vertex));
    const plane = planeFromPointNormal(item(points, 0), unit);
    if (!points.every((p) => isPointOnPlane(plane, p))) {
      throw new KernelError('invalid-geometry', 'The edges to offset must lie in one plane');
    }
    const basis = planeBasis(unit);
    const segments = chain.edges.map((edgeId, i) =>
      sourceSegment(store, edgeId, item(points, i), item(points, i + 1), basis, plane),
    );
    const path: SourcePath = { segments, closed: chain.closed };
    // Winding-based trimming needs to know which side of a closed chain is its inside.
    const ring = segments.map((segment) => segment.a);
    const orientation = chain.closed && signedArea(ring) < 0 ? -1 : 1;
    return offsetPaths(doc, context, [path], distance, basis, plane, false, orientation);
  });
}

function assertDistance(distance: number): void {
  if (!Number.isFinite(distance))
    throw new KernelError('invalid-geometry', 'The distance must be a finite number');
  if (Math.abs(distance) <= EPS_LEN) {
    throw new KernelError(
      'invalid-operation',
      'The offset distance must be larger than the length tolerance',
    );
  }
}

function loopSegments(store: EntityStore, loop: Loop, basis: PlaneBasis, plane: Plane): SourceSegment[] {
  const points = store.loopPoints(loop);
  return loop.map((use, i) =>
    sourceSegment(store, use.edge, item(points, i), item(points, (i + 1) % points.length), basis, plane),
  );
}

function sourceSegment(
  store: EntityStore,
  edgeId: EdgeId,
  a: Vec3,
  b: Vec3,
  basis: PlaneBasis,
  plane: Plane,
): SourceSegment {
  return {
    a: projectTo2D(basis, a),
    b: projectTo2D(basis, b),
    circle: sourceCircle(store, edgeId, a, b, basis, plane),
  };
}

/** The circle an edge lies on, when its curve is an arc or circle in this plane whose radius still fits the edge. */
function sourceCircle(
  store: EntityStore,
  edgeId: EdgeId,
  a: Vec3,
  b: Vec3,
  basis: PlaneBasis,
  plane: Plane,
): SourceCircle | null {
  const curveId = store.getEdge(edgeId).curve;
  if (curveId === null) return null;
  const curve = store.getCurve(curveId);
  const params = curve.params;
  if (params.kind !== 'arc' && params.kind !== 'circle') return null;
  const fits =
    isParallelBySine(length(cross(params.normal, plane.normal))) &&
    isPointOnPlane(plane, params.center) &&
    Math.abs(length3(a, params.center) - params.radius) <= EPS_LEN &&
    Math.abs(length3(b, params.center) - params.radius) <= EPS_LEN;
  if (!fits) return null;
  return {
    curve: curveId,
    params,
    edgeCount: curve.edges.length,
    center: projectTo2D(basis, params.center),
  };
}

function length3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Offsets the paths, removes overlaps, inserts the result and rebuilds arc and circle curves. */
function offsetPaths(
  doc: ModelDocument,
  context: DefinitionId,
  paths: readonly SourcePath[],
  distance: number,
  basis: PlaneBasis,
  plane: Plane,
  keepOverlaps: boolean,
  orientation: number,
): OffsetResult {
  const raws = paths.map((path) => joinOffsetLines(path, distance));
  const zones = clearanceZones(paths, raws);
  let pieces: Piece[];
  if (keepOverlaps) {
    pieces = [];
    raws.forEach((segments, path) => {
      // Overlaps stay, but a loop that turned inside out or collapsed as a whole is still dropped.
      const own = zones.filter((zone) => zone.path === path);
      if (!segments.some((segment) => isClear(lerp2(segment.a, segment.b, 0.5), own))) return;
      segments.forEach((segment, raw) => {
        if (dist2(segment.a, segment.b) > EPS_LEN) {
          pieces.push({ a: segment.a, b: segment.b, path, raw, whole: true });
        }
      });
    });
  } else {
    const cuts = (segment: RawSegment): number[] =>
      zones.flatMap((zone) => capsuleCrossings(segment, zone.segment, zone.clearance - EPS_LEN));
    const clear = splitAtIntersections(raws, cuts).filter((piece) =>
      isClear(lerp2(piece.a, piece.b, 0.5), zones),
    );
    pieces = paths.every((path) => path.closed) ? keepByWinding(clear, raws, orientation) : clear;
  }
  if (pieces.length === 0) {
    throw new KernelError('invalid-operation', 'Nothing remains of the shape at this offset distance');
  }

  const segments: SegmentInput[] = pieces.map((piece) => ({
    a: unprojectFrom2D(basis, plane, piece.a),
    b: unprojectFrom2D(basis, plane, piece.b),
  }));
  const inserted = insertSegments(doc, context, segments, { autoFace: true });
  rebuildCurves(doc, context, paths, raws, pieces, inserted.segmentEdges);
  const store = doc.store(context);
  const edges = [...new Set(inserted.segmentEdges.flat())].filter((id) => store.edge(id) !== undefined);
  if (edges.length === 0) {
    throw new KernelError('invalid-operation', 'Nothing remains of the shape at this offset distance');
  }
  return { edges, faces: inserted.createdFaces.filter((id) => store.face(id) !== undefined) };
}

/**
 * The offset line of one segment. Positive distances move to the left of the segment's direction. A chord of an arc
 * or circle moves radially instead, to the circle with the same center and a radius changed by the distance.
 */
function offsetLine(segment: SourceSegment, distance: number): OffsetLine {
  const { a, b, circle } = segment;
  if (circle) {
    const side = orient(a, b, circle.center);
    const radius = circle.params.radius + (side > 0 ? -distance : distance);
    // A circle that would shrink to nothing falls back to a straight offset, which then turns inside out and is trimmed.
    if (side !== 0 && radius > EPS_LEN) {
      const k = radius / circle.params.radius;
      const start = lerp2(circle.center, a, k);
      const end = lerp2(circle.center, b, k);
      const chord = dist2(a, b);
      const clearance = chord > 0 ? Math.abs(cross2(sub2(b, a), sub2(start, a))) / chord : 0;
      return { start, end, circle, radius, clearance };
    }
  }
  const chord = dist2(a, b);
  const nx = chord > 0 ? (-(b.y - a.y) / chord) * distance : 0;
  const ny = chord > 0 ? ((b.x - a.x) / chord) * distance : 0;
  return {
    start: { x: a.x + nx, y: a.y + ny },
    end: { x: b.x + nx, y: b.y + ny },
    circle: null,
    radius: 0,
    clearance: Math.abs(distance),
  };
}

/** Offsets each segment of a path and joins neighbours with miters. */
function joinOffsetLines(path: SourcePath, distance: number): RawSegment[] {
  const lines = path.segments.map((segment) => offsetLine(segment, distance));
  const count = lines.length;
  const vertexAt = (i: number): Point2 => {
    if (!path.closed && i === 0) return item(lines, 0).start;
    if (!path.closed && i === count) return item(lines, count - 1).end;
    return miter(item(lines, (i - 1 + count) % count), item(lines, i % count));
  };
  const vertices = Array.from({ length: path.closed ? count : count + 1 }, (_, i) => vertexAt(i));
  return lines.map((line, i) => ({
    a: item(vertices, i),
    b: item(vertices, path.closed ? (i + 1) % count : i + 1),
    line,
  }));
}

/** Where two consecutive offset lines meet. Parallel lines (collinear source edges) meet at the second one's start. */
function miter(previous: OffsetLine, next: OffsetLine): Point2 {
  const r = sub2(previous.end, previous.start);
  const s = sub2(next.end, next.start);
  const denominator = cross2(r, s);
  const scaleOfInputs = Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y);
  if (scaleOfInputs === 0 || Math.abs(denominator) <= EPS_PARALLEL * scaleOfInputs) return next.start;
  const t = cross2(sub2(next.start, previous.start), s) / denominator;
  return { x: previous.start.x + r.x * t, y: previous.start.y + r.y * t };
}

/**
 * Cuts every raw segment where it crosses or overlaps another one, and at the parameters `extraCuts` returns for it.
 * Pieces not longer than `EPS_LEN` are dropped.
 */
function splitAtIntersections(
  raws: readonly (readonly RawSegment[])[],
  extraCuts: (segment: RawSegment) => readonly number[],
): Piece[] {
  const flat = raws.flatMap((segments, path) => segments.map((segment, raw) => ({ segment, path, raw })));
  const cuts = flat.map(() => [0, 1]);
  const addCut = (index: number, t: number, segmentLength: number): void => {
    if (t * segmentLength > EPS_LEN && (1 - t) * segmentLength > EPS_LEN) item(cuts, index).push(t);
  };
  flat.forEach(({ segment }, index) => {
    const segmentLength = dist2(segment.a, segment.b);
    for (const t of extraCuts(segment)) addCut(index, t, segmentLength);
  });
  for (let j = 0; j < flat.length; j++) {
    const first = item(flat, j).segment;
    const r = sub2(first.b, first.a);
    const lengthR = Math.hypot(r.x, r.y);
    if (lengthR <= EPS_LEN) continue;
    for (let k = j + 1; k < flat.length; k++) {
      const second = item(flat, k).segment;
      const s = sub2(second.b, second.a);
      const lengthS = Math.hypot(s.x, s.y);
      if (lengthS <= EPS_LEN) continue;
      const denominator = cross2(r, s);
      const qp = sub2(second.a, first.a);
      if (Math.abs(denominator) <= EPS_PARALLEL * lengthR * lengthS) {
        // Parallel: only collinear overlaps matter; each segment is cut where the other one's endpoints lie on it.
        if (Math.abs(cross2(r, qp)) / lengthR > EPS_LEN) continue;
        for (const p of [second.a, second.b])
          addCut(j, dot2(sub2(p, first.a), r) / (lengthR * lengthR), lengthR);
        for (const p of [first.a, first.b])
          addCut(k, dot2(sub2(p, second.a), s) / (lengthS * lengthS), lengthS);
        continue;
      }
      const t = cross2(qp, s) / denominator;
      const u = cross2(qp, r) / denominator;
      const within = (value: number, segmentLength: number): boolean =>
        value * segmentLength >= -EPS_LEN && (value - 1) * segmentLength <= EPS_LEN;
      if (!within(t, lengthR) || !within(u, lengthS)) continue;
      addCut(j, t, lengthR);
      addCut(k, u, lengthS);
    }
  }

  const pieces: Piece[] = [];
  flat.forEach(({ segment, path, raw }, index) => {
    const segmentLength = dist2(segment.a, segment.b);
    const sorted = [...item(cuts, index)].sort((x, y) => x - y);
    const kept = sorted.filter((t, i) => i === 0 || (t - item(sorted, i - 1)) * segmentLength > EPS_LEN);
    for (let i = 0; i + 1 < kept.length; i++) {
      const a = lerp2(segment.a, segment.b, item(kept, i));
      const b = lerp2(segment.a, segment.b, item(kept, i + 1));
      if (dist2(a, b) > EPS_LEN) pieces.push({ a, b, path, raw, whole: kept.length === 2 });
    }
  });
  return pieces;
}

/**
 * Keeps the pieces that bound the region with a positive total winding number: the parts of closed offset loops that
 * are still inside the shape. Swallowtails wind the other way and are dropped, and overlaps (winding 2 or more)
 * merge. A convex loop offset past its center is point-reflected and keeps its winding; the clearance test catches
 * that case. `orientation` is −1 when the shape's inside is to the right of its loops.
 */
function keepByWinding(
  pieces: readonly Piece[],
  raws: readonly (readonly RawSegment[])[],
  orientation: number,
): Piece[] {
  const rings = raws.map((segments) => segments.map((segment) => segment.a));
  const inside = (p: Point2): boolean =>
    orientation * rings.reduce((sum, ring) => sum + windingNumber(p, ring), 0) >= 1;
  const probe = EPS_LEN / 2;
  return pieces.filter((piece) => {
    const pieceLength = dist2(piece.a, piece.b);
    const middle = lerp2(piece.a, piece.b, 0.5);
    const nx = (-(piece.b.y - piece.a.y) / pieceLength) * probe;
    const ny = ((piece.b.x - piece.a.x) / pieceLength) * probe;
    return inside({ x: middle.x + nx, y: middle.y + ny }) !== inside({ x: middle.x - nx, y: middle.y - ny });
  });
}

/** The band around a source segment that its own offset keeps clear of. */
interface ClearanceZone {
  readonly segment: SourceSegment;
  /** How far the offset of this segment is from it. */
  readonly clearance: number;
  readonly path: number;
}

function clearanceZones(
  paths: readonly SourcePath[],
  raws: readonly (readonly RawSegment[])[],
): ClearanceZone[] {
  return paths.flatMap((path, p) =>
    path.segments.map((segment, i) => ({
      segment,
      clearance: item(item(raws, p), i).line.clearance,
      path: p,
    })),
  );
}

/**
 * True when a point of the offset stays at least the offset distance away from every source segment. Offset parts
 * that came closer to some part of the source belong to an overlap, an inversion or a collapse.
 */
function isClear(point: Point2, zones: readonly ClearanceZone[]): boolean {
  return zones.every(
    ({ segment, clearance }) => distanceToSegment2(point, segment.a, segment.b) >= clearance - EPS_LEN,
  );
}

/**
 * Parameters where a raw segment's line enters and leaves the capsule of radius `radius` around a source segment.
 * The capsule is convex, so its intersection with the line is one interval: the union of the intervals through its
 * rectangle and its two end discs.
 */
function capsuleCrossings(segment: RawSegment, source: SourceSegment, radius: number): number[] {
  const d = sub2(segment.b, segment.a);
  const axis = sub2(source.b, source.a);
  const axisLength = Math.hypot(axis.x, axis.y);
  if (radius <= 0 || axisLength === 0 || dot2(d, d) === 0) return [];
  const u = { x: axis.x / axisLength, y: axis.y / axisLength };
  const n = { x: -u.y, y: u.x };
  const intervals: [number, number][] = [];

  const slab = (start: number, rate: number, low: number, high: number): [number, number] | null => {
    if (rate === 0) return start > low && start < high ? [-Infinity, Infinity] : null;
    const t0 = (low - start) / rate;
    const t1 = (high - start) / rate;
    return [Math.min(t0, t1), Math.max(t0, t1)];
  };
  const offset = sub2(segment.a, source.a);
  const along = slab(dot2(offset, u), dot2(d, u), 0, axisLength);
  const across = slab(dot2(offset, n), dot2(d, n), -radius, radius);
  if (along && across && Math.max(along[0], across[0]) < Math.min(along[1], across[1])) {
    intervals.push([Math.max(along[0], across[0]), Math.min(along[1], across[1])]);
  }
  for (const center of [source.a, source.b]) {
    const toStart = sub2(segment.a, center);
    const a = dot2(d, d);
    const b = dot2(d, toStart);
    const discriminant = b * b - a * (dot2(toStart, toStart) - radius * radius);
    if (discriminant <= 0) continue;
    const root = Math.sqrt(discriminant);
    intervals.push([(-b - root) / a, (-b + root) / a]);
  }
  if (intervals.length === 0) return [];
  return [Math.min(...intervals.map((i) => i[0])), Math.max(...intervals.map((i) => i[1]))];
}

function distanceToSegment2(p: Point2, a: Point2, b: Point2): number {
  const ab = sub2(b, a);
  const lengthSq = ab.x * ab.x + ab.y * ab.y;
  const t =
    lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / lengthSq));
  return dist2(p, lerp2(a, b, t));
}

/**
 * Turns runs of analytically offset chords back into curves. A run that survived whole, covers its source curve
 * and has unmitered ends keeps the source parameters with the new radius; any other run becomes a polyline.
 */
function rebuildCurves(
  doc: ModelDocument,
  context: DefinitionId,
  paths: readonly SourcePath[],
  raws: readonly (readonly RawSegment[])[],
  pieces: readonly Piece[],
  segmentEdges: readonly (readonly EdgeId[])[],
): void {
  const store = doc.store(context);
  const piecesOf = new Map<string, number[]>();
  pieces.forEach((piece, index) => {
    const key = `${String(piece.path)}:${String(piece.raw)}`;
    const list = piecesOf.get(key);
    if (list) list.push(index);
    else piecesOf.set(key, [index]);
  });

  raws.forEach((segments, path) => {
    const count = segments.length;
    const curveAt = (i: number): CurveId | null =>
      item(segments, ((i % count) + count) % count).line.circle?.curve ?? null;
    // Start a closed loop at a boundary between runs so no run wraps around its end; open chains start at 0.
    const closed = item(paths, path).closed;
    let start = 0;
    while (closed && start < count && curveAt(start) === curveAt(start - 1)) start++;
    const wholeLoop = closed && start === count;
    if (wholeLoop) start = 0;

    let i = 0;
    while (i < count) {
      const first = item(segments, (start + i) % count);
      const circle = first.line.circle;
      let runLength = 1;
      while (i + runLength < count && curveAt(start + i + runLength) === circle?.curve) runLength++;
      if (circle) {
        const run = Array.from({ length: runLength }, (_, k) => (start + i + k) % count);
        const runPieces = run.map((raw) => piecesOf.get(`${String(path)}:${String(raw)}`) ?? []);
        const intact = runPieces.every(
          (list) =>
            list.length === 1 &&
            pieces[item(list, 0)]?.whole === true &&
            segmentEdges[item(list, 0)]?.length === 1,
        );
        const last = item(segments, item(run, runLength - 1));
        const unmitered =
          (wholeLoop && circle.params.kind === 'circle') ||
          (dist2(first.a, first.line.start) <= EPS_LEN && dist2(last.b, last.line.end) <= EPS_LEN);
        const edges = runPieces.flat().flatMap((index) => segmentEdges[index] ?? []);
        const parametric = intact && unmitered && runLength === circle.edgeCount;
        addOffsetCurve(
          doc,
          context,
          store,
          edges,
          parametric ? { ...circle.params, radius: first.line.radius } : null,
        );
      }
      i += runLength;
    }
  });
}

function addOffsetCurve(
  doc: ModelDocument,
  context: DefinitionId,
  store: EntityStore,
  edges: readonly EdgeId[],
  params: CurveParams | null,
): void {
  const live = edges.filter((id) => store.edge(id) !== undefined);
  if (live.length === 0 || new Set(live).size !== live.length) return;
  if (!live.every((id) => store.getEdge(id).curve === null)) return;
  const chains = splitCurveChains(store, live);
  for (const chain of chains) {
    addCurve(doc, context, chains.length === 1 && params ? params : { kind: 'polyline' }, chain);
  }
}
