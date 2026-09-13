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

import type { AnnotationId, DefinitionId } from '../../kernel/ids';
import { IDENTITY, multiply, transformPoint, type Mat4 } from '../../kernel/math/mat4';
import type { Vec3 } from '../../kernel/math/vec3';
import type { AnnotationView } from '../../kernel/model/EntityStore';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import type { AnnotationKind } from '../../kernel/model/types';
import { isTagVisible } from '../../kernel/model/visibility';
import { resolveAnnotation, type ResolvedAnnotation } from '../../kernel/ops/annotations';
import { formatLength, type UnitSettings } from '../../kernel/units/units';

/** Shown when a dimension's measured entity no longer exists. */
export const MISSING_MEASUREMENT = '?';

export interface AnnotationLabel {
  /** Unique across instances: the same annotation appears once per instance of its definition. */
  readonly key: string;
  readonly context: DefinitionId;
  readonly id: AnnotationId;
  readonly kind: AnnotationKind;
  readonly text: string;
  /** World position of the label, or null for screen text. */
  readonly world: Vec3 | null;
  /** Screen text position as fractions of the view's width and height, or null. */
  readonly screen: { readonly x: number; readonly y: number } | null;
}

/** The text an annotation shows: its own text, or the measured value for dimensions. */
export function annotationText(
  annotation: AnnotationView,
  resolved: ResolvedAnnotation,
  units: UnitSettings,
): string {
  if (annotation.attributes.text !== null) return annotation.attributes.text;
  if (resolved.value === null) return MISSING_MEASUREMENT;
  const measured = formatLength(resolved.value, units);
  if (annotation.geometry.kind === 'radial-dimension') {
    return annotation.geometry.diameter ? `Ø ${measured}` : `R ${measured}`;
  }
  return measured;
}

/** Every visible annotation in the model with its text and position, following instance transforms. */
export function collectAnnotationLabels(doc: ModelDocument, units: UnitSettings): AnnotationLabel[] {
  const labels: AnnotationLabel[] = [];
  const visit = (definitionId: DefinitionId, transform: Mat4, path: string, ancestors: Set<DefinitionId>) => {
    if (ancestors.has(definitionId)) return;
    const store = doc.store(definitionId);
    for (const annotation of store.annotations()) {
      if (annotation.attributes.hidden || !isTagVisible(doc, annotation.attributes.tagId)) continue;
      const resolved = resolveAnnotation(store, annotation);
      const { geometry } = annotation;
      labels.push({
        key: `${path}/${String(annotation.id)}`,
        context: definitionId,
        id: annotation.id,
        kind: geometry.kind,
        text: annotationText(annotation, resolved, units),
        world: resolved.labelPoint ? transformPoint(transform, resolved.labelPoint) : null,
        screen: geometry.kind === 'screen-text' ? { x: geometry.x, y: geometry.y } : null,
      });
    }
    const nested = new Set(ancestors).add(definitionId);
    for (const instance of store.instances()) {
      if (instance.attributes.hidden || !isTagVisible(doc, instance.attributes.tagId)) continue;
      visit(
        instance.definitionId,
        multiply(transform, instance.transform),
        `${path}/${String(instance.id)}`,
        nested,
      );
    }
  };
  visit(doc.rootDefinitionId, IDENTITY, '', new Set());
  return labels;
}
