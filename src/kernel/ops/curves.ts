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

import { KernelError } from '../errors';
import type { CurveId, DefinitionId, EdgeId, FaceId } from '../ids';
import { transformDirection, transformPoint, type Mat4 } from '../math/mat4';
import { add, cross, dot, length, normalize, scale, type Vec3 } from '../math/vec3';
import type { EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import { addCurve, removeCurve, setCurveEdges, setCurveParams } from '../model/mutations';
import type { CurveParams, EdgeAttributes, FaceAttributes } from '../model/types';
import { EPS_LEN, EPS_PARALLEL, lengthsEqual } from '../tolerance';
import { insertSegments } from './insertSegments';

export const DEFAULT_CIRCLE_SEGMENTS = 24;
export const DEFAULT_ARC_SEGMENTS = 12;
export const MIN_CLOSED_CURVE_SEGMENTS = 3;
export const MAX_CURVE_SEGMENTS = 999;

const FULL_TURN = 2 * Math.PI;

type FramedParams = Exclude<CurveParams, { kind: 'polyline' }>;

function assertFrame(params: FramedParams): void {
  const { center, normal, xAxis, radius } = params;
  const finite = [center.x, center.y, center.z, radius].every(Number.isFinite);
  if (!finite || !(radius > EPS_LEN)) {
    throw new KernelError(
      'invalid-geometry',
      'A curve needs a finite center and a radius above the length tolerance',
    );
  }
  if (
    !lengthsEqual(length(normal), 1) ||
    !lengthsEqual(length(xAxis), 1) ||
    Math.abs(dot(normal, xAxis)) > EPS_PARALLEL
  ) {
    throw new KernelError('invalid-geometry', 'A curve frame needs unit, perpendicular normal and x axis');
  }
}

function assertCount(count: number, minimum: number, what: string): void {
  if (!Number.isInteger(count) || count < minimum || count > MAX_CURVE_SEGMENTS) {
    throw new KernelError(
      'invalid-geometry',
      `${what} must be a whole number from ${String(minimum)} to ${String(MAX_CURVE_SEGMENTS)}`,
    );
  }
}

/** The vertices of a curve and whether it closes on itself. */
export function curvePoints(params: CurveParams): { points: Vec3[]; closed: boolean } {
  if (params.kind === 'polyline') {
    throw new KernelError('invalid-operation', 'A polyline has no parametric points');
  }
  assertFrame(params);
  const yAxis = cross(params.normal, params.xAxis);
  const at = (angle: number): Vec3 =>
    add(
      params.center,
      add(
        scale(params.xAxis, params.radius * Math.cos(angle)),
        scale(yAxis, params.radius * Math.sin(angle)),
      ),
    );
  switch (params.kind) {
    case 'circle': {
      assertCount(params.segments, MIN_CLOSED_CURVE_SEGMENTS, 'Circle segments');
      return {
        points: Array.from({ length: params.segments }, (_, i) => at((FULL_TURN * i) / params.segments)),
        closed: true,
      };
    }
    case 'polygon': {
      assertCount(params.sides, MIN_CLOSED_CURVE_SEGMENTS, 'Polygon sides');
      return {
        points: Array.from({ length: params.sides }, (_, i) => at((FULL_TURN * i) / params.sides)),
        closed: true,
      };
    }
    case 'arc': {
      assertCount(params.segments, 1, 'Arc segments');
      const sweep = params.endAngle - params.startAngle;
      if (!Number.isFinite(sweep) || Math.abs(sweep) <= 0 || Math.abs(sweep) >= FULL_TURN) {
        throw new KernelError('invalid-geometry', 'An arc must sweep more than 0° and less than 360°');
      }
      return {
        points: Array.from({ length: params.segments + 1 }, (_, i) =>
          at(params.startAngle + (sweep * i) / params.segments),
        ),
        closed: false,
      };
    }
  }
}

export interface InsertCurveOptions {
  readonly edgeAttributes?: EdgeAttributes;
  readonly faceAttributes?: FaceAttributes;
  readonly orientationHint?: Vec3;
}

export interface InsertCurveResult {
  /** The new curve entity, or `null` when its edges merged with an existing curve and couldn't become one. */
  readonly curve: CurveId | null;
  readonly edges: readonly EdgeId[];
  readonly createdFaces: readonly FaceId[];
}

/** Draws a circle, polygon or arc. Its edges behave like drawn lines, and it closes faces where possible. */
export function insertCurve(
  doc: ModelDocument,
  context: DefinitionId,
  params: FramedParams,
  options: InsertCurveOptions = {},
): InsertCurveResult {
  return doc.transact(`Draw ${params.kind}`, () => {
    const { points, closed } = curvePoints(params);
    const segmentCount = closed ? points.length : points.length - 1;
    const segments = Array.from({ length: segmentCount }, (_, i) => {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (!a || !b) throw new KernelError('invalid-geometry', 'Curve point generation failed');
      return options.edgeAttributes ? { a, b, attributes: options.edgeAttributes } : { a, b };
    });
    const result = insertSegments(doc, context, segments, {
      autoFace: true,
      ...(options.faceAttributes ? { faceAttributes: options.faceAttributes } : {}),
      ...(options.orientationHint ? { orientationHint: options.orientationHint } : {}),
    });
    const edges = result.segmentEdges.flat();
    const store = doc.store(context);
    const unique = new Set(edges).size === edges.length;
    const free = edges.every((id) => store.getEdge(id).curve === null);
    const curve = unique && free && edges.length > 0 ? addCurve(doc, context, params, edges) : null;
    return { curve, edges, createdFaces: result.createdFaces };
  });
}

/** Splits an ordered edge list into runs where consecutive edges share a vertex, joining the ends of a closed chain. */
export function splitCurveChains(store: EntityStore, edges: readonly EdgeId[]): EdgeId[][] {
  const chains: EdgeId[][] = [];
  const connected = (a: EdgeId, b: EdgeId): boolean => {
    const ea = store.getEdge(a);
    const eb = store.getEdge(b);
    return ea.v0 === eb.v0 || ea.v0 === eb.v1 || ea.v1 === eb.v0 || ea.v1 === eb.v1;
  };
  for (const edgeId of edges) {
    const current = chains.at(-1);
    const last = current?.at(-1);
    if (current && last !== undefined && connected(last, edgeId)) current.push(edgeId);
    else chains.push([edgeId]);
  }
  const first = chains[0];
  const lastChain = chains.at(-1);
  if (chains.length > 1 && first && lastChain) {
    const tail = lastChain.at(-1);
    const head = first[0];
    if (tail !== undefined && head !== undefined && connected(tail, head)) {
      chains.pop();
      chains[0] = [...lastChain, ...first];
    }
  }
  return chains;
}

/**
 * Removes an edge from its curve (before the edge itself is deleted). Circles, polygons and arcs that lose an edge
 * become polylines, and a chain broken in the middle becomes several curves.
 */
export function detachEdgeFromCurve(
  doc: ModelDocument,
  context: DefinitionId,
  curveId: CurveId,
  edgeId: EdgeId,
): void {
  const store = doc.store(context);
  const curve = store.getCurve(curveId);
  const remaining = curve.edges.filter((id) => id !== edgeId);
  const chains = splitCurveChains(store, remaining);
  const [firstChain, ...otherChains] = chains;
  if (!firstChain) {
    removeCurve(doc, context, curveId);
    return;
  }
  const params: CurveParams = { kind: 'polyline' };
  setCurveEdges(doc, context, curveId, firstChain);
  if (curve.params.kind !== 'polyline') setCurveParams(doc, context, curveId, params);
  for (const chain of otherChains) addCurve(doc, context, params, chain);
}

/**
 * Curve parameters after a transform. Circular parameters stay circular under similarity transforms, with mirror
 * transforms flipping the frame. Any other transform turns the curve into a polyline.
 */
export function transformCurveParams(params: CurveParams, transform: Mat4): CurveParams {
  if (params.kind === 'polyline') return params;
  const x = transformDirection(transform, params.xAxis);
  const y = transformDirection(transform, cross(params.normal, params.xAxis));
  const lengthX = length(x);
  const lengthY = length(y);
  const similar =
    lengthX > 0 &&
    lengthsEqual(lengthX * params.radius, lengthY * params.radius) &&
    Math.abs(dot(x, y)) <= EPS_PARALLEL * lengthX * lengthY;
  const xAxis = normalize(x);
  const normal = normalize(cross(x, y));
  if (!similar || !xAxis || !normal) return { kind: 'polyline' };
  // The frame is rebuilt from the transformed axes (normal = x × y), so arc angles keep their meaning under mirroring.
  return {
    ...params,
    center: transformPoint(transform, params.center),
    normal,
    xAxis,
    radius: params.radius * lengthX,
  };
}
