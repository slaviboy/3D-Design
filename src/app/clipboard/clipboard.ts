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

import type { DefinitionId, EdgeId, FaceId, InstanceId } from '../../kernel/ids';
import { aabbFromPoints, aabbIsEmpty, aabbUnion, EMPTY_AABB, type Aabb } from '../../kernel/math/aabb';
import { translation } from '../../kernel/math/mat4';
import type { Vec3 } from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import {
  captureFragment,
  insertFragment,
  type GeometryFragment,
  type InsertedFragment,
} from '../../kernel/ops/fragment';
import { definitionBounds, transformAabb } from '../geometry/bounds';
import type { EntityRef } from '../selection/Selection';

/** Shown when a paste would put a group or component inside itself. */
export const NESTED_PASTE_MESSAGE = "A group or component can't be pasted into itself";

export interface ClipboardCounts {
  readonly faces: number;
  readonly edges: number;
  readonly instances: number;
}

/**
 * Geometry held for pasting. The fragment's instances name definitions of `doc`, so a clipboard can only be pasted
 * into the document it was copied from; pasting into another document is refused rather than guessed.
 */
export interface Clipboard {
  readonly doc: ModelDocument;
  readonly fragment: GeometryFragment;
  /** Bounds in the coordinates of the context the copy came from, used to put the paste under the cursor. */
  readonly bounds: Aabb;
  readonly counts: ClipboardCounts;
}

/** Bounds of everything in a fragment, including the definitions its instances place. */
export function fragmentBounds(doc: ModelDocument, fragment: GeometryFragment): Aabb {
  const points: Vec3[] = [];
  for (const edge of fragment.edges) points.push(edge.a, edge.b);
  for (const face of fragment.faces) {
    points.push(...face.outer);
    for (const inner of face.inners) points.push(...inner);
  }
  let bounds = points.length > 0 ? aabbFromPoints(points) : EMPTY_AABB;
  for (const instance of fragment.instances) {
    const box = definitionBounds(doc, instance.definitionId);
    if (!aabbIsEmpty(box)) bounds = aabbUnion(bounds, transformAabb(box, instance.transform));
  }
  return bounds;
}

/** Copies the selected faces, edges and instances of `context`. Returns null when there is nothing to copy. */
export function copySelection(
  doc: ModelDocument,
  context: DefinitionId,
  refs: readonly EntityRef[],
): Clipboard | null {
  const store = doc.store(context);
  const ids = (kind: EntityRef['kind']): number[] =>
    refs.filter((ref) => ref.kind === kind).map((ref) => ref.id);
  const fragment = captureFragment(store, {
    faces: ids('face') as FaceId[],
    edges: ids('edge') as EdgeId[],
    instances: ids('instance') as InstanceId[],
  });
  const counts: ClipboardCounts = {
    faces: fragment.faces.length,
    edges: fragment.edges.length,
    instances: fragment.instances.length,
  };
  if (counts.faces + counts.edges + counts.instances === 0) return null;
  return { doc, fragment, bounds: fragmentBounds(doc, fragment), counts };
}

/**
 * True when pasting here would place a group or component inside itself. The kernel refuses such a cycle, so Paste
 * is disabled instead (this is what happens after copying a group and then opening it).
 */
export function pasteWouldNest(doc: ModelDocument, context: DefinitionId, clipboard: Clipboard): boolean {
  return clipboard.fragment.instances.some(
    (instance) => instance.definitionId === context || doc.definitionContains(instance.definitionId, context),
  );
}

/** Pastes a clipboard into `context`, moved by `offset`, merging with the geometry already there. */
export function pasteFragment(
  doc: ModelDocument,
  context: DefinitionId,
  clipboard: Clipboard,
  offset: Vec3,
): InsertedFragment {
  return doc.transact('Paste', () => insertFragment(doc, context, clipboard.fragment, translation(offset)));
}

/** The pasted entities, as a selection. */
export function insertedRefs(inserted: InsertedFragment): EntityRef[] {
  return [
    ...inserted.instances.map((id): EntityRef => ({ kind: 'instance', id })),
    ...inserted.faces.map((id): EntityRef => ({ kind: 'face', id })),
    ...inserted.edges.map((id): EntityRef => ({ kind: 'edge', id })),
  ];
}

/** "2 faces, 1 group", for status hints and notifications. */
export function describeClipboard(counts: ClipboardCounts): string {
  const parts: string[] = [];
  const add = (count: number, singular: string, plural: string): void => {
    if (count > 0) parts.push(`${String(count)} ${count === 1 ? singular : plural}`);
  };
  add(counts.instances, 'group or component', 'groups and components');
  add(counts.faces, 'face', 'faces');
  add(counts.edges, 'edge', 'edges');
  return parts.join(', ');
}
