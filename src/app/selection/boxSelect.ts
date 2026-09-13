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

import type { DefinitionId, VertexId } from '../../kernel/ids';
import { aabbIsEmpty, type Aabb } from '../../kernel/math/aabb';
import { classifyPointInRing, orient, type Point2 } from '../../kernel/math/geom2d';
import { multiply, transformPoint, type Mat4 } from '../../kernel/math/mat4';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import { isTagVisible } from '../../kernel/model/visibility';
import {
  projectToScreen,
  type CameraState,
  type ScreenPoint,
  type ScreenProjection,
  type ViewportSize,
} from '../camera/camera';
import { aabbCorners, definitionBounds } from '../geometry/bounds';
import { isEdgeSelectable } from './queries';
import type { EntityRef } from './Selection';

/** Window selects entities entirely inside the rectangle; crossing selects anything the rectangle touches. */
export type BoxSelectMode = 'window' | 'crossing';

export interface ScreenRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function rectFromCorners(a: ScreenPoint, b: ScreenPoint): ScreenRect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** True when a projected point exists (is in front of the camera) and lies in the rectangle. */
function inside(rect: ScreenRect, p: Point2 | null): boolean {
  return p !== null && p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
}

function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

function segmentTouchesRect(rect: ScreenRect, a: Point2, b: Point2): boolean {
  if (inside(rect, a) || inside(rect, b)) return true;
  const corners: Point2[] = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
  return corners.some((corner, i) => {
    const next = corners[(i + 1) % corners.length];
    return next !== undefined && segmentsCross(a, b, corner, next);
  });
}

/**
 * Entities of `context` selected by a screen rectangle. Instances are tested by their projected bounding box.
 * `contextTransform` maps the context's coordinates to world coordinates.
 */
export function boxSelect(
  doc: ModelDocument,
  context: DefinitionId,
  contextTransform: Mat4,
  camera: CameraState,
  size: ViewportSize,
  rect: ScreenRect,
  mode: BoxSelectMode,
): EntityRef[] {
  const store = doc.store(context);
  const projected = new Map<VertexId, Point2 | null>();
  const screenOf = (vertex: VertexId): Point2 | null => {
    if (!projected.has(vertex)) {
      projected.set(
        vertex,
        projectToScreen(camera, transformPoint(contextTransform, store.position(vertex)), size),
      );
    }
    return projected.get(vertex) ?? null;
  };
  const refs: EntityRef[] = [];

  for (const edge of store.edges()) {
    if (!isEdgeSelectable(store, edge.id) || !isTagVisible(doc, edge.attributes.tagId)) continue;
    const a = screenOf(edge.v0);
    const b = screenOf(edge.v1);
    const selected =
      mode === 'window'
        ? inside(rect, a) && inside(rect, b)
        : a !== null && b !== null
          ? segmentTouchesRect(rect, a, b)
          : inside(rect, a) || inside(rect, b);
    if (selected) refs.push({ kind: 'edge', id: edge.id });
  }

  const center: Point2 = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
  for (const face of store.faces()) {
    if (face.attributes.hidden || !isTagVisible(doc, face.attributes.tagId)) continue;
    const outline = store.loopVertices(face.outer).map(screenOf);
    let selected: boolean;
    if (mode === 'window') {
      selected = outline.every((p) => inside(rect, p));
    } else {
      const visible = outline.filter((p): p is Point2 => p !== null);
      selected =
        visible.some((p) => inside(rect, p)) ||
        visible.some((p, i) => {
          const next = visible[(i + 1) % visible.length];
          return next !== undefined && segmentTouchesRect(rect, p, next);
        }) ||
        (visible.length === outline.length && classifyPointInRing(center, visible) === 'inside');
    }
    if (selected) refs.push({ kind: 'face', id: face.id });
  }

  const boundsCache = new Map<DefinitionId, Aabb>();
  for (const instance of store.instances()) {
    if (instance.attributes.hidden || !isTagVisible(doc, instance.attributes.tagId)) continue;
    const bounds = definitionBounds(doc, instance.definitionId, boundsCache);
    if (aabbIsEmpty(bounds)) continue;
    const toWorld = multiply(contextTransform, instance.transform);
    const corners = aabbCorners(bounds).map((corner) =>
      projectToScreen(camera, transformPoint(toWorld, corner), size),
    );
    let selected: boolean;
    if (mode === 'window') {
      selected = corners.every((p) => inside(rect, p));
    } else {
      const visible = corners.filter((p): p is ScreenProjection => p !== null);
      const minX = Math.min(...visible.map((p) => p.x));
      const maxX = Math.max(...visible.map((p) => p.x));
      const minY = Math.min(...visible.map((p) => p.y));
      const maxY = Math.max(...visible.map((p) => p.y));
      selected =
        visible.length > 0 &&
        minX <= rect.maxX &&
        maxX >= rect.minX &&
        minY <= rect.maxY &&
        maxY >= rect.minY;
    }
    if (selected) refs.push({ kind: 'instance', id: instance.id });
  }
  return refs;
}
