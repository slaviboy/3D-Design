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

import { add, cross, distance, dot, lerp, normalize, scale, sub, type Vec3 } from '../math/vec3';
import type { AnnotationView, EntityStore } from '../model/EntityStore';
import type { AnnotationAnchor, AnnotationKind } from '../model/types';

/** Where an annotation is drawn, in its context's coordinates, and what it measures. */
export interface ResolvedAnnotation {
  readonly kind: AnnotationKind;
  /** Extension, dimension and leader lines. */
  readonly lines: readonly (readonly [Vec3, Vec3])[];
  /** Where the label sits, or null for screen text, which is placed in view coordinates. */
  readonly labelPoint: Vec3 | null;
  /** The measured length for dimensions, in meters; null for text or when the measured entity is gone. */
  readonly value: number | null;
}

/** The anchor's current position: its vertex while that still exists, otherwise the stored point. */
export function anchorPosition(store: EntityStore, anchor: AnnotationAnchor): Vec3 {
  return anchor.vertex !== null && store.vertex(anchor.vertex) ? store.position(anchor.vertex) : anchor.point;
}

export function resolveAnnotation(store: EntityStore, annotation: AnnotationView): ResolvedAnnotation {
  const { geometry } = annotation;
  switch (geometry.kind) {
    case 'linear-dimension': {
      const a = anchorPosition(store, geometry.start);
      const b = anchorPosition(store, geometry.end);
      const a2 = add(a, geometry.offset);
      const b2 = add(b, geometry.offset);
      return {
        kind: geometry.kind,
        lines: [
          [a, a2],
          [b, b2],
          [a2, b2],
        ],
        labelPoint: lerp(a2, b2, 0.5),
        value: distance(a, b),
      };
    }
    case 'radial-dimension': {
      const curve = store.curve(geometry.curve);
      if (!curve || curve.params.kind === 'polyline') {
        return { kind: geometry.kind, lines: [], labelPoint: geometry.labelPoint, value: null };
      }
      const { center, normal, xAxis, radius } = curve.params;
      const toLabel = sub(geometry.labelPoint, center);
      const inPlane = sub(toLabel, scale(normal, dot(toLabel, normal)));
      const direction = normalize(inPlane) ?? normalize(cross(normal, cross(xAxis, normal))) ?? xAxis;
      const rim = add(center, scale(direction, radius));
      const from = geometry.diameter ? sub(center, scale(direction, radius)) : center;
      return {
        kind: geometry.kind,
        lines: [
          [from, rim],
          [rim, geometry.labelPoint],
        ],
        labelPoint: geometry.labelPoint,
        value: geometry.diameter ? 2 * radius : radius,
      };
    }
    case 'leader-text': {
      const target = anchorPosition(store, geometry.target);
      const label = add(target, geometry.offset);
      return { kind: geometry.kind, lines: [[target, label]], labelPoint: label, value: null };
    }
    case 'screen-text':
      return { kind: geometry.kind, lines: [], labelPoint: null, value: null };
  }
}
