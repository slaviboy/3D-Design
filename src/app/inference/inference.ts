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

import type { DefinitionId, FaceId } from '../../kernel/ids';
import type { Aabb } from '../../kernel/math/aabb';
import { transformDirection, transformNormal, transformPoint, type Mat4 } from '../../kernel/math/mat4';
import { planeFromPointNormal, type Plane } from '../../kernel/math/plane';
import { closestPointsOnSegments } from '../../kernel/math/segment';
import {
  add,
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  cross,
  distance,
  dot,
  length,
  lerp,
  normalize,
  scale,
  sub,
  ZERO,
  type Vec3,
} from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import { isTagVisible } from '../../kernel/model/visibility';
import { EPS_LEN } from '../../kernel/tolerance';
import {
  cameraBasis,
  pointOnTargetPlane,
  projectToScreen,
  rayThroughScreen,
  worldUnitsPerPixel,
  type CameraState,
  type Ray,
  type ScreenPoint,
  type ViewportSize,
} from '../camera/camera';
import { pick } from '../picking/picker';
import { traverseAlongRay } from '../picking/rayTraversal';
import { clipSegment, isClipped, NO_SECTION_CLIPPING, type SectionClipping } from '../picking/sectionClip';
import { isOccluded, visibilityRules, type OcclusionScene } from '../picking/visibility';
import type { EntityRef } from '../selection/Selection';
import type { InferenceExclusion } from './exclusion';

export type Axis = 'x' | 'y' | 'z';

export type InferenceKind =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'origin'
  | 'on-edge'
  | 'on-face'
  | 'on-drawing-axis'
  | 'on-axis'
  | 'parallel'
  | 'perpendicular'
  | 'extension'
  | 'from-point'
  | 'locked'
  | 'free';

/** Recently hovered geometry that linear inferences refer to (parallel, perpendicular, extension, from point). */
export interface InferenceReferences {
  readonly points: readonly Vec3[];
  readonly edges: readonly { readonly a: Vec3; readonly b: Vec3 }[];
}

/** The point a drawing or editing tool should use for the cursor, and why. */
export interface Inference {
  /** World coordinates. */
  readonly point: Vec3;
  readonly kind: InferenceKind;
  /** Short text for the cursor tooltip, for example "Endpoint" or "On Red Axis". Empty for free points. */
  readonly label: string;
  /** True when the point comes from geometry inside a group or component. */
  readonly inGroup: boolean;
  /** The world axis the point lies on relative to the anchor, if any. */
  readonly axis?: Axis;
  /** For `on-drawing-axis`: which of the drawing axes' lines the point lies on. */
  readonly drawingAxis?: Axis;
  /** World-space edge the inference came from, for endpoint, midpoint and on-edge. */
  readonly edge?: { readonly a: Vec3; readonly b: Vec3 };
  /** World-space plane of the face under the cursor, for on-face inferences in the active context. */
  readonly facePlane?: Plane;
  /** The entity in the active context the point lies on, when there is one. */
  readonly entity?: EntityRef;
}

export interface InferenceRequest {
  readonly camera: CameraState;
  readonly size: ViewportSize;
  readonly screen: ScreenPoint;
  /** Start point of the operation in world coordinates; enables axis inferences and locks. */
  readonly anchor?: Vec3;
  /** Constrains the result to the line through the anchor in this direction (arrow-key or Shift locks). */
  readonly lockDirection?: Vec3;
  /** Plane for points where nothing is under the cursor. Defaults to a plane through the anchor, or the ground. */
  readonly fallbackPlane?: Plane;
  readonly tolerancePx?: number;
  /** Recently hovered points and edges for linear inferences. */
  readonly references?: InferenceReferences;
  /** Geometry the operation is changing, which the pointer doesn't snap to. */
  readonly exclude?: InferenceExclusion;
  /** Section cuts: what they cut away is neither a snap target nor hides anything. */
  readonly clip?: SectionClipping;
  /** Definition bounds shared by the ray queries of this request (and others against the same unchanged document). */
  readonly boundsCache?: Map<DefinitionId, Aabb>;
  /**
   * Snap to points on the lines of the drawing axes, where nothing hides them (on by default). Tools that take only
   * points of the model, such as Push/Pull, turn it off.
   */
  readonly drawingAxes?: boolean;
  /**
   * Offer inferences along lines: axes, Parallel, Perpendicular, edge extensions and From Point (on by default).
   * Push/Pull moves a face along its own normal and uses none of them.
   */
  readonly linear?: boolean;
  /**
   * A point the result must not line up with along a drawing axis: the Rectangle tool's first corner, where a second
   * corner on the axis through it would only give a flat rectangle. Axes through it aren't offered.
   */
  readonly excludeAxesThrough?: Vec3;
  /**
   * The result is used projected onto `fallbackPlane` through `anchor` (circles, polygons, arcs, rotated rectangles,
   * rotations). Snaps that could only land on the anchor once projected are left out: lines along the plane's normal,
   * every point of which projects to one spot, and points off the plane straight above or below the anchor.
   */
  readonly planar?: boolean;
}

export const DEFAULT_INFERENCE_TOLERANCE_PX = 10;
/** Points within this angle (as a sine) of an axis through the anchor count as aligned with it. */
const AXIS_ALIGNMENT_SINE = 1e-4;

/** Drawing axes in world coordinates: an origin and three perpendicular unit directions. */
export interface AxisFrame {
  readonly origin: Vec3;
  readonly x: Vec3;
  readonly y: Vec3;
  readonly z: Vec3;
}

export const WORLD_AXIS_FRAME: AxisFrame = Object.freeze({ origin: ZERO, x: AXIS_X, y: AXIS_Y, z: AXIS_Z });

/** The document's drawing axes as a frame. */
export function axisFrameOf(doc: ModelDocument): AxisFrame {
  const { origin, xAxis, yAxis } = doc.axes;
  return { origin, x: xAxis, y: yAxis, z: normalize(cross(xAxis, yAxis)) ?? AXIS_Z };
}

interface AxisEntry {
  readonly axis: Axis;
  readonly direction: Vec3;
  readonly label: string;
}

function axisEntries(frame: AxisFrame): readonly AxisEntry[] {
  return [
    { axis: 'x', direction: frame.x, label: 'On Red Axis' },
    { axis: 'y', direction: frame.y, label: 'On Green Axis' },
    { axis: 'z', direction: frame.z, label: 'On Blue Axis' },
  ];
}

/** Lower wins. Points on geometry beat points along lines. */
const PRIORITY: Readonly<Record<InferenceKind, number>> = {
  endpoint: 0,
  origin: 0,
  midpoint: 1,
  center: 1,
  'on-edge': 3,
  // After edges, so an edge lying on an axis reads On Edge.
  'on-drawing-axis': 3.5,
  'on-face': 4,
  'on-axis': 2,
  parallel: 2,
  perpendicular: 2,
  extension: 3,
  'from-point': 3,
  locked: 0,
  free: 5,
};

/** Among linear inferences within this many pixels of each other, the lower rank wins. */
const LINEAR_TIE_PX = 0.5;
/**
 * A line passing this close to a point the model offers (in pixels at the point's depth) goes through that point: a
 * From Point line lying along an edge, say. The two are worked out differently, so only rounding tells them apart.
 */
const SAME_PLACE_PX = 0.5;
/** Points within this many pixels of each other count as equally close, and the one nearer the camera wins. */
const DEPTH_TIE_PX = 0.5;
/**
 * Candidates tested for faces hiding them on each pointer move, nearest-ranked first. Any past this count as
 * visible, as every candidate did before visibility was tested, so a dense model can't make the pointer lag.
 */
const MAX_OCCLUSION_TESTS = 16;
const LINEAR_RANK: Partial<Record<InferenceKind, number>> = {
  'on-axis': 0,
  parallel: 1,
  perpendicular: 1,
  extension: 2,
  'from-point': 2,
};
/** Settles lines of the same rank that tie: an edge's extension names the edge, a From Point line only a point. */
const LINEAR_ORDER: readonly InferenceKind[] = [
  'on-axis',
  'parallel',
  'perpendicular',
  'extension',
  'from-point',
];

interface Candidate {
  readonly inference: Inference;
  readonly pixels: number;
  /** Distance in front of the camera. */
  readonly depth: number;
  /** A point on an edge of the model, which Back Edges shows through faces. */
  readonly onEdge: boolean;
}

/** Collects the candidates within `tolerance` pixels of the cursor that `accept` lets through. */
function candidateList(
  camera: CameraState,
  size: ViewportSize,
  screen: ScreenPoint,
  tolerance: number,
  accept: (inference: Inference) => boolean = () => true,
): { readonly list: Candidate[]; readonly offer: (inference: Inference, onEdge?: boolean) => void } {
  const list: Candidate[] = [];
  const offer = (inference: Inference, onEdge = false): void => {
    if (!accept(inference)) return;
    const projected = projectToScreen(camera, inference.point, size);
    if (!projected) return;
    const pixels = Math.hypot(projected.x - screen.x, projected.y - screen.y);
    if (pixels <= tolerance) list.push({ inference, pixels, depth: projected.depth, onEdge });
  };
  return { list, offer };
}

/** What a `planar` request leaves out (see {@link InferenceRequest.planar}). */
interface PlanarRules {
  /** A line running along the plane's normal: every point of it projects to one spot. */
  readonly alongNormal: (direction: Vec3) => boolean;
  /** A point off the plane that projects onto the anchor, which would give a result of no size. */
  readonly landsOnAnchor: (point: Vec3) => boolean;
}

function planarRules(request: InferenceRequest): PlanarRules | null {
  const { anchor, fallbackPlane } = request;
  const normal = request.planar === true && anchor && fallbackPlane ? normalize(fallbackPlane.normal) : null;
  if (!anchor || !normal) return null;
  // Half a pixel at the anchor: nearer than that, a projected point is the anchor as far as anyone can see.
  const reach = SAME_PLACE_PX * worldUnitsPerPixel(request.camera, anchor, request.size);
  return {
    alongNormal: (direction) => {
      const unit = normalize(direction);
      return unit !== null && length(cross(unit, normal)) <= AXIS_ALIGNMENT_SINE;
    },
    landsOnAnchor: (point) => {
      const height = dot(sub(point, anchor), normal);
      return Math.abs(height) > reach && distance(sub(point, scale(normal, height)), anchor) <= reach;
    },
  };
}

/**
 * SketchUp infers only what the user can see: faces hide the points behind them, except in X-ray and wireframe, and
 * Back Edges keeps points on edges visible. Results are remembered for the request, and past a budget candidates
 * count as visible.
 */
function visibilityTest(
  doc: ModelDocument,
  context: DefinitionId,
  contextTransform: Mat4,
  request: InferenceRequest,
  boundsCache: Map<DefinitionId, Aabb>,
): (candidate: Candidate) => boolean {
  const rules = visibilityRules(doc.style);
  if (!rules.occlusion) return () => true;
  const scene: OcclusionScene = {
    doc,
    context,
    contextTransform,
    camera: request.camera,
    size: request.size,
    boundsCache,
    ...(request.clip ? { clip: request.clip } : {}),
  };
  const known = new Map<string, boolean>();
  let tests = 0;
  return (candidate) => {
    if (candidate.onEdge && rules.edgePointsAlwaysVisible) return true;
    const { point } = candidate.inference;
    const key = `${String(point.x)},${String(point.y)},${String(point.z)}`;
    let visible = known.get(key);
    if (visible === undefined) {
      visible = tests >= MAX_OCCLUSION_TESTS || !isOccluded(point, scene);
      tests++;
      known.set(key, visible);
    }
    return visible;
  };
}

/**
 * The first visible candidate of a sorted list; among the visible ones that tie with it (`ties`, and within
 * {@link DEPTH_TIE_PX}), the one nearest the camera, so a corner beats the corner hidden right behind it.
 */
function firstVisible(
  sorted: readonly Candidate[],
  visible: (candidate: Candidate) => boolean,
  ties: (candidate: Candidate, first: Candidate) => boolean,
): Candidate | null {
  const index = sorted.findIndex(visible);
  const first = sorted[index];
  if (!first) return null;
  let best = first;
  for (const other of sorted.slice(index + 1)) {
    if (!ties(other, first) || other.pixels > first.pixels + DEPTH_TIE_PX) break;
    if (other.depth < best.depth && visible(other)) best = other;
  }
  return best;
}

export function axisOf(direction: Vec3, frame: AxisFrame = WORLD_AXIS_FRAME): Axis | undefined {
  const unit = normalize(direction);
  if (!unit) return undefined;
  return axisEntries(frame).find(({ direction: axis }) => length(cross(unit, axis)) <= AXIS_ALIGNMENT_SINE)
    ?.axis;
}

/** The point on the line through `point` along `direction` closest to the ray. */
export function closestPointOnLineToRay(point: Vec3, direction: Vec3, ray: Ray): Vec3 {
  const w = sub(point, ray.origin);
  const a = dot(direction, direction);
  const b = dot(direction, ray.direction);
  const c = dot(ray.direction, ray.direction);
  const d = dot(direction, w);
  const e = dot(ray.direction, w);
  const denominator = a * c - b * b;
  if (Math.abs(denominator) < 1e-12 * a * c) return point;
  return add(point, scale(direction, (b * e - c * d) / denominator));
}

/**
 * Finds the inferred point under the cursor: snapping to geometry, the origin and the axes, and honoring locks.
 * `contextTransform` maps the active context's coordinates to world coordinates.
 */
export function infer(
  doc: ModelDocument,
  context: DefinitionId,
  contextTransform: Mat4,
  request: InferenceRequest,
): Inference {
  const { camera, size, screen, anchor, exclude } = request;
  const tolerance = request.tolerancePx ?? DEFAULT_INFERENCE_TOLERANCE_PX;
  const frame = axisFrameOf(doc);
  const axes = axisEntries(frame);
  const ray = rayThroughScreen(camera, screen, size);
  const clip = request.clip ?? NO_SECTION_CLIPPING;
  const boundsCache = request.boundsCache ?? new Map<DefinitionId, Aabb>();
  const visible = visibilityTest(doc, context, contextTransform, request, boundsCache);
  const planar = planarRules(request);
  const accept = (inference: Inference): boolean => !planar?.landsOnAnchor(inference.point);
  const { list: points, offer } = candidateList(camera, size, screen, tolerance, accept);

  // The axes aren't cut by sections, so the origin never is.
  offer({ point: frame.origin, kind: 'origin', label: 'Origin', inGroup: false });
  traverseAlongRay(
    doc,
    context,
    contextTransform,
    {
      camera,
      size,
      ray,
      tolerancePx: tolerance,
      boundsCache,
      clip,
      ...(exclude ? { skipInstances: exclude.instances } : {}),
    },
    (visit) => {
      const inGroup = visit.topLevel !== null;
      // Exclusions name entities of the active context, not of the definitions nested in it.
      const excluded = visit.topLevel === null ? exclude : undefined;
      const cuts = visit.clipPlanes;
      const worldStart = transformPoint(visit.toWorld, visit.start);
      const worldEnd = transformPoint(visit.toWorld, visit.end);
      for (const edgeId of visit.store.queryEdges(visit.box)) {
        const edge = visit.store.getEdge(edgeId);
        if (edge.attributes.hidden || !isTagVisible(doc, edge.attributes.tagId)) continue;
        if (excluded?.edges.has(edgeId) === true) continue;
        const a = transformPoint(visit.toWorld, visit.store.position(edge.v0));
        const b = transformPoint(visit.toWorld, visit.store.position(edge.v1));
        const entity: EntityRef = visit.topLevel ?? { kind: 'edge', id: edgeId };
        const common = { inGroup, edge: { a, b }, entity };
        // An edge attached to moving geometry stretches, so only its fixed end is where the document has it.
        const movingA = excluded?.vertices.has(edge.v0) === true;
        const movingB = excluded?.vertices.has(edge.v1) === true;
        if (!movingA && !isClipped(a, cuts))
          offer({ ...common, point: a, kind: 'endpoint', label: 'Endpoint' }, true);
        if (!movingB && !isClipped(b, cuts))
          offer({ ...common, point: b, kind: 'endpoint', label: 'Endpoint' }, true);
        if (movingA || movingB) continue;
        const middle = lerp(a, b, 0.5);
        if (!isClipped(middle, cuts))
          offer({ ...common, point: middle, kind: 'midpoint', label: 'Midpoint' }, true);
        const shown = clipSegment(a, b, cuts);
        if (!shown) continue;
        const closest = closestPointsOnSegments(worldStart, worldEnd, shown[0], shown[1]);
        offer({ ...common, point: closest.pointOnSecond, kind: 'on-edge', label: 'On Edge' }, true);
      }
      for (const curve of visit.store.curves()) {
        if (curve.params.kind === 'polyline') continue;
        if (excluded?.curves.has(curve.id) === true) continue;
        const first = curve.edges[0] === undefined ? undefined : visit.store.edge(curve.edges[0]);
        if (first && (first.attributes.hidden || !isTagVisible(doc, first.attributes.tagId))) continue;
        const center = transformPoint(visit.toWorld, curve.params.center);
        if (isClipped(center, cuts)) continue;
        offer({ point: center, kind: 'center', label: 'Center', inGroup });
      }
    },
  );

  // The drawing axes are lines through the model like guides; they are drawn with depth testing, so a point on them
  // counts only where nothing hides it. Sections don't cut them.
  if (request.drawingAxes !== false) {
    const through = request.excludeAxesThrough;
    for (const { axis, direction, label } of axes) {
      if (through && length(cross(sub(through, frame.origin), direction)) <= EPS_LEN) continue;
      if (planar?.alongNormal(direction)) continue;
      offer({
        point: closestPointOnLineToRay(frame.origin, direction, ray),
        kind: 'on-drawing-axis',
        label,
        inGroup: false,
        drawingAxis: axis,
      });
    }
  }

  for (const guide of doc.store(context).guides()) {
    if (guide.attributes.hidden || !isTagVisible(doc, guide.attributes.tagId)) continue;
    const point = transformPoint(contextTransform, guide.geometry.point);
    if (guide.geometry.kind === 'point') {
      offer({ point, kind: 'endpoint', label: 'Guide Point', inGroup: false });
    } else {
      const direction = transformDirection(contextTransform, guide.geometry.direction);
      if (planar?.alongNormal(direction)) continue;
      offer({
        point: closestPointOnLineToRay(point, direction, ray),
        kind: 'on-edge',
        label: 'On Guide',
        inGroup: false,
        edge: { a: point, b: add(point, direction) },
      });
    }
  }

  points.sort((p, q) => PRIORITY[p.inference.kind] - PRIORITY[q.inference.kind] || p.pixels - q.pixels);
  const geometric = firstVisible(
    points,
    visible,
    (candidate, first) => PRIORITY[candidate.inference.kind] === PRIORITY[first.inference.kind],
  );
  const withAxis = (inference: Inference): Inference => {
    if (!anchor) return inference;
    const axis = axisOf(sub(inference.point, anchor), frame);
    return axis && distance(inference.point, anchor) > 0 ? { ...inference, axis } : inference;
  };

  if (anchor && request.lockDirection) {
    const direction = normalize(request.lockDirection);
    if (direction) {
      const axis = axisOf(direction, frame);
      const strong = geometric && PRIORITY[geometric.inference.kind] <= 1 ? geometric.inference : null;
      const point = strong
        ? add(anchor, scale(direction, dot(sub(strong.point, anchor), direction)))
        : closestPointOnLineToRay(anchor, direction, ray);
      const axisLabel = axes.find((entry) => entry.axis === axis)?.label;
      return {
        point,
        kind: 'locked',
        label: strong ? `${strong.label} (locked)` : (axisLabel ?? 'Locked direction'),
        inGroup: strong?.inGroup ?? false,
        ...(axis ? { axis } : {}),
      };
    }
  }

  if (geometric && PRIORITY[geometric.inference.kind] <= 1) return withAxis(geometric.inference);

  const linear =
    request.linear === false
      ? null
      : bestLinearInference(request, ray, tolerance, frame, visible, points, planar, accept);
  if (linear) {
    // Lines through the anchor may win a tie with geometry; lines elsewhere only when strictly closer.
    const throughAnchor = linear.inference.kind !== 'extension' && linear.inference.kind !== 'from-point';
    if (
      !geometric ||
      linear.pixels < geometric.pixels ||
      (throughAnchor && linear.pixels <= geometric.pixels)
    ) {
      return linear.inference.kind === 'on-axis' ? linear.inference : withAxis(linear.inference);
    }
  }

  if (geometric) return withAxis(geometric.inference);

  const hit = pick(doc, context, contextTransform, {
    camera,
    size,
    screen,
    edgeTolerancePx: 0,
    clip,
    boundsCache,
    ...(exclude?.faceTargets ? { skip: exclude.faceTargets } : {}),
  });
  if (hit && hit.ref.kind !== 'edge') {
    let facePlane: Plane | undefined;
    if (hit.ref.kind === 'face') {
      const plane = doc.store(context).face(hit.ref.id as FaceId)?.plane;
      const normal = plane ? transformNormal(contextTransform, plane.normal) : null;
      const unit = normal ? normalize(normal) : null;
      if (unit) facePlane = planeFromPointNormal(hit.point, unit);
    }
    return withAxis({
      point: hit.point,
      kind: 'on-face',
      label: hit.ref.kind === 'face' ? 'On Face' : 'On Face in Group',
      inGroup: hit.ref.kind === 'instance',
      entity: hit.ref,
      ...(facePlane ? { facePlane } : {}),
    });
  }

  return withAxis({ point: freePoint(request, ray, frame), kind: 'free', label: '', inGroup: false });
}

/**
 * The closest visible linear inference: an axis, or a line parallel or perpendicular to a recent edge, through the
 * anchor; the extension of a recent edge; or an axis line through a recent point. Among lines about as close as the
 * closest, the lower rank wins, then the kind listed first in {@link LINEAR_ORDER}. A line through one of the points
 * the model `offers` yields to it, so moving along an edge reads On Edge all the way.
 */
function bestLinearInference(
  request: InferenceRequest,
  ray: Ray,
  tolerance: number,
  frame: AxisFrame,
  visible: (candidate: Candidate) => boolean,
  offers: readonly Candidate[],
  planar: PlanarRules | null,
  accept: (inference: Inference) => boolean,
): Candidate | null {
  const { anchor, references } = request;
  const axes = axisEntries(frame);
  const { list: candidates, offer: offerAny } = candidateList(
    request.camera,
    request.size,
    request.screen,
    tolerance,
    accept,
  );
  // For a planar tool, a line along the plane's normal would put every point in one spot.
  const offer = (inference: Inference, direction: Vec3): void => {
    if (!planar?.alongNormal(direction)) offerAny(inference);
  };

  if (anchor) {
    for (const { axis, direction, label } of axes) {
      const point = closestPointOnLineToRay(anchor, direction, ray);
      if (distance(point, anchor) > 0)
        offer({ point, kind: 'on-axis', label, inGroup: false, axis }, direction);
    }
    for (const edge of references?.edges ?? []) {
      const along = normalize(sub(edge.b, edge.a));
      // Axis-aligned edges add nothing the axis inferences don't already give.
      if (!along || axisOf(along, frame)) continue;
      const parallel = closestPointOnLineToRay(anchor, along, ray);
      if (distance(parallel, anchor) > 0) {
        offer({ point: parallel, kind: 'parallel', label: 'Parallel to Edge', inGroup: false, edge }, along);
      }
      const planeNormal = normalize(cross(along, sub(anchor, edge.a))) ?? frame.z;
      const across = normalize(cross(planeNormal, along));
      if (!across) continue;
      const perpendicular = closestPointOnLineToRay(anchor, across, ray);
      if (distance(perpendicular, anchor) > 0) {
        offer(
          {
            point: perpendicular,
            kind: 'perpendicular',
            label: 'Perpendicular to Edge',
            inGroup: false,
            edge,
          },
          across,
        );
      }
    }
  }

  for (const edge of references?.edges ?? []) {
    const along = normalize(sub(edge.b, edge.a));
    if (!along) continue;
    const point = closestPointOnLineToRay(edge.a, along, ray);
    const parameter = dot(sub(point, edge.a), along);
    if (parameter < 0 || parameter > distance(edge.a, edge.b)) {
      offer({ point, kind: 'extension', label: 'On Edge Extension', inGroup: false, edge }, along);
    }
  }
  for (const reference of references?.points ?? []) {
    for (const { direction } of axes) {
      const point = closestPointOnLineToRay(reference, direction, ray);
      if (distance(point, reference) > 0) {
        offer({ point, kind: 'from-point', label: 'From Point', inGroup: false }, direction);
      }
    }
  }

  // Rounding would otherwise decide, on every pointer move, between a line and the point it passes through. A line
  // there is as hidden as the point, so leaving it out loses nothing the camera sees.
  const lines = candidates.filter((line) => {
    const { point } = line.inference;
    const reach = SAME_PLACE_PX * worldUnitsPerPixel(request.camera, point, request.size);
    return !offers.some((offer) => distance(offer.inference.point, point) <= reach);
  });
  lines.sort((p, q) => p.pixels - q.pixels);
  const index = lines.findIndex(visible);
  const first = lines[index];
  if (!first) return null;
  let best = first;
  const rankOf = (candidate: Candidate): number => LINEAR_RANK[candidate.inference.kind] ?? 0;
  const orderOf = (candidate: Candidate): number => LINEAR_ORDER.indexOf(candidate.inference.kind);
  const beats = (other: Candidate): boolean =>
    rankOf(other) < rankOf(best) || (rankOf(other) === rankOf(best) && orderOf(other) < orderOf(best));
  for (const other of lines.slice(index + 1)) {
    if (other.pixels > first.pixels + LINEAR_TIE_PX) break;
    if (beats(other) && visible(other)) best = other;
  }
  return best;
}

/** Where a ray meets the fallback plane: the given one, a plane through the anchor, or the ground. */
function freePoint(request: InferenceRequest, ray: Ray, frame: AxisFrame): Vec3 {
  const { camera, size, screen, anchor } = request;
  let plane = request.fallbackPlane;
  if (!plane) {
    if (anchor) {
      const forward = cameraBasis(camera).forward;
      const facing = axisEntries(frame).reduce((bestAxis, entry) =>
        Math.abs(dot(entry.direction, forward)) > Math.abs(dot(bestAxis.direction, forward))
          ? entry
          : bestAxis,
      );
      plane = planeFromPointNormal(anchor, facing.direction);
    } else {
      plane = planeFromPointNormal(frame.origin, frame.z);
    }
  }
  const denominator = dot(plane.normal, ray.direction);
  if (Math.abs(denominator) > 1e-9) {
    const t = (plane.offset - dot(plane.normal, ray.origin)) / denominator;
    if (t > 0 && Number.isFinite(t)) return add(ray.origin, scale(ray.direction, t));
  }
  return pointOnTargetPlane(camera, screen, size);
}
