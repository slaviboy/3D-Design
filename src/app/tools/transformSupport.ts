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

import type { EdgeId, FaceId, InstanceId } from '../../kernel/ids';
import { aabbFromPoints, aabbIsEmpty, aabbUnion, type Aabb } from '../../kernel/math/aabb';
import {
  invertAffine,
  multiply,
  rotationAxisAngle,
  scaling,
  transformDirection,
  translation,
  type Mat4,
} from '../../kernel/math/mat4';
import { planeFromPointNormal, type Plane } from '../../kernel/math/plane';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import type { TransformResult, TransformSelection } from '../../kernel/ops/transform';
import { formatAngle } from '../../kernel/units/units';
import { worldUnitsPerPixel } from '../camera/camera';
import type { Editor } from '../Editor';
import { definitionBounds, transformAabb } from '../geometry/bounds';
import type { Inference } from '../inference/inference';
import type { EntityRef, Selection } from '../selection/Selection';
import type { PreviewLine } from './Tool';
import { drawingPlane, planeAxes, projectOntoPlane, modelFrame } from './toolSupport';

/** Rotations snap to multiples of this angle while the pointer is close to one. */
export const ANGLE_SNAP_STEP = Math.PI / 12;
const ANGLE_SNAP_TOLERANCE = (2.5 * Math.PI) / 180;
/** Angles smaller than this are treated as no rotation. */
export const MIN_ANGLE = 1e-9;
/** On-screen radius of the protractor drawn by angle tools. */
export const PROTRACTOR_RADIUS_PX = 48;
const PROTRACTOR_SEGMENTS = 48;
const PROTRACTOR_TICK_FRACTION = 0.82;

export function transformSelectionOf(selection: Selection): TransformSelection {
  return {
    faces: selection.ids('face') as FaceId[],
    edges: selection.ids('edge') as EdgeId[],
    instances: selection.ids('instance') as InstanceId[],
  };
}

export function refsOfResult(result: TransformResult): EntityRef[] {
  return [
    ...result.instances.map((id): EntityRef => ({ kind: 'instance', id })),
    ...result.faces.map((id): EntityRef => ({ kind: 'face', id })),
    ...result.edges.map((id): EntityRef => ({ kind: 'edge', id })),
  ];
}

/** A world-space transform expressed in the active context's coordinates. */
export function toLocalTransform(editor: Editor, world: Mat4): Mat4 {
  const context = editor.session.activeContextTransform;
  const inverse = invertAffine(context);
  if (!inverse) throw new Error('The open group has a singular transform');
  return multiply(inverse, multiply(world, context));
}

/** `linear` applied about `point` instead of the origin. */
export function aboutPoint(point: Vec3, linear: Mat4): Mat4 {
  return multiply(translation(point), multiply(linear, translation(scale(point, -1))));
}

export function rotationAbout(center: Vec3, axis: Vec3, angle: number): Mat4 {
  return aboutPoint(center, rotationAxisAngle(axis, angle));
}

export function scalingAbout(anchor: Vec3, factors: Vec3): Mat4 {
  return aboutPoint(anchor, scaling(factors));
}

export function rotateDirection(direction: Vec3, axis: Vec3, angle: number): Vec3 {
  return transformDirection(rotationAxisAngle(axis, angle), direction);
}

/** Bounds of the selected entities in the active context's coordinates, or null when nothing is selected. */
export function selectionBounds(editor: Editor, selection: TransformSelection): Aabb | null {
  const { session } = editor;
  const store = session.doc.store(session.activeContext);
  const points: Vec3[] = [];
  for (const id of selection.faces ?? []) {
    if (!store.face(id)) continue;
    for (const loop of store.faceLoops(id)) points.push(...store.loopPoints(loop));
  }
  for (const id of selection.edges ?? []) {
    const edge = store.edge(id);
    if (edge) points.push(store.position(edge.v0), store.position(edge.v1));
  }
  let box = aabbFromPoints(points);
  for (const id of selection.instances ?? []) {
    const instance = store.instance(id);
    if (!instance) continue;
    const bounds = definitionBounds(session.doc, instance.definitionId);
    if (!aabbIsEmpty(bounds)) box = aabbUnion(box, transformAabb(bounds, instance.transform));
  }
  return aabbIsEmpty(box) ? null : box;
}

/** Angle from `from` to `to` about `normal`, in (−π, π]. */
export function signedAngle(from: Vec3, to: Vec3, normal: Vec3): number {
  return Math.atan2(dot(cross(from, to), normal), dot(from, to));
}

export function snapAngle(angle: number): number {
  const snapped = Math.round(angle / ANGLE_SNAP_STEP) * ANGLE_SNAP_STEP;
  return Math.abs(snapped - angle) <= ANGLE_SNAP_TOLERANCE ? snapped : angle;
}

export function formatAngleValue(editor: Editor, radians: number): string {
  return formatAngle(radians, editor.units);
}

/** The plane an angle tool measures in: locked to an axis, the face under the cursor, or the usual drawing plane. */
export function protractorPlane(editor: Editor, inference: Inference, lockNormal: Vec3 | null): Plane {
  return lockNormal ? planeFromPointNormal(inference.point, lockNormal) : drawingPlane(editor, inference);
}

/** Unit direction from `center` to `point` projected into `plane`, or null when they coincide. */
export function directionInPlane(plane: Plane, center: Vec3, point: Vec3): Vec3 | null {
  return normalize(sub(projectOntoPlane(plane, point), center));
}

/** A protractor circle with 15° ticks, sized to stay the same on screen. */
export function protractorLines(
  editor: Editor,
  center: Vec3,
  normal: Vec3,
  reference: Vec3 | null,
): PreviewLine[] {
  const radius =
    worldUnitsPerPixel(editor.session.camera, center, editor.viewportSize) * PROTRACTOR_RADIUS_PX;
  const u = reference ?? planeAxes(normal, modelFrame(editor)).u;
  const v = cross(normal, u);
  const at = (angle: number, r: number): Vec3 =>
    add(center, add(scale(u, r * Math.cos(angle)), scale(v, r * Math.sin(angle))));
  const lines: PreviewLine[] = [];
  for (let i = 0; i < PROTRACTOR_SEGMENTS; i++) {
    const a0 = (2 * Math.PI * i) / PROTRACTOR_SEGMENTS;
    const a1 = (2 * Math.PI * (i + 1)) / PROTRACTOR_SEGMENTS;
    lines.push({ a: at(a0, radius), b: at(a1, radius), style: 'guide' });
  }
  for (let angle = 0; angle < 2 * Math.PI - MIN_ANGLE; angle += ANGLE_SNAP_STEP) {
    lines.push({ a: at(angle, radius * PROTRACTOR_TICK_FRACTION), b: at(angle, radius), style: 'guide' });
  }
  return lines;
}
