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
import type { DefinitionId, EdgeId, FaceId } from '../ids';
import { isPointOnPlane } from '../math/plane';
import { cross, dot, length, scale, type Vec3 } from '../math/vec3';
import type { EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import { setEdgeAttributes } from '../model/mutations';

export interface SoftenByAngleOptions {
  /** Edges whose two faces meet at an angle up to this (between their normals, 0…π) are softened. */
  readonly maxAngleRadians: number;
  /** Also soften edges between coplanar faces. */
  readonly softenCoplanar: boolean;
  /** Softened edges are also smooth. */
  readonly smooth: boolean;
}

export interface EdgeFaceAngle {
  /** Angle between the two face normals, oriented consistently across the edge. 0 means flat. */
  readonly angle: number;
  readonly coplanar: boolean;
}

const byId = (a: number, b: number): number => a - b;

/**
 * Softens edges by the angle between their faces, like the Soften Edges panel. Each edge with exactly two faces is
 * made soft (and smooth when `smooth` is set) when its face angle is at most `maxAngleRadians`; coplanar pairs only
 * when `softenCoplanar` is set. Every other listed edge, including edges without exactly two faces, is made neither
 * soft nor smooth. Returns the number of edges whose flags changed.
 */
export function softenEdgesByAngle(
  doc: ModelDocument,
  context: DefinitionId,
  edgeIds: readonly EdgeId[],
  options: SoftenByAngleOptions,
): number {
  const { maxAngleRadians } = options;
  if (!Number.isFinite(maxAngleRadians) || maxAngleRadians < 0 || maxAngleRadians > Math.PI) {
    throw new KernelError('invalid-operation', 'The soften angle must be between 0° and 180°');
  }
  return doc.transact('Soften edges', () => {
    const store = doc.store(context);
    let changed = 0;
    for (const edgeId of [...new Set(edgeIds)].sort(byId)) {
      const edge = store.edge(edgeId);
      if (!edge) continue;
      const measured = edgeFaceAngle(store, edgeId);
      const soften =
        measured !== null && (measured.coplanar ? options.softenCoplanar : measured.angle <= maxAngleRadians);
      const soft = soften;
      const smooth = soften && options.smooth;
      if (edge.attributes.soft === soft && edge.attributes.smooth === smooth) continue;
      setEdgeAttributes(doc, context, edgeId, { soft, smooth });
      changed++;
    }
    return changed;
  });
}

/**
 * The angle between the faces of an edge that has exactly two faces, or `null` otherwise. Consistently oriented
 * faces traverse a shared edge in opposite directions; when both traverse it the same way, one normal is flipped
 * first so the angle measures the fold, not the orientation mismatch.
 */
export function edgeFaceAngle(store: EntityStore, edgeId: EdgeId): EdgeFaceAngle | null {
  const faces = store.getEdge(edgeId).faces;
  const [first, second] = faces;
  if (faces.length !== 2 || first === undefined || second === undefined) return null;
  const planeA = store.getFace(first).plane;
  const planeB = store.getFace(second).plane;
  const useA = findUse(store, first, edgeId);
  const useB = findUse(store, second, edgeId);
  if (!planeA || !planeB || useA === undefined || useB === undefined) return null;
  const normalA = planeA.normal;
  const normalB: Vec3 = useA === useB ? scale(planeB.normal, -1) : planeB.normal;
  const angle = Math.atan2(length(cross(normalA, normalB)), dot(normalA, normalB));
  // Coplanarity is decided by vertex distances, never by the normal angle (GEOMETRY.md, "Tolerances").
  const coplanar =
    dot(normalA, normalB) > 0 &&
    facePointsOn(store, second, (p) => isPointOnPlane(planeA, p)) &&
    facePointsOn(store, first, (p) => isPointOnPlane(planeB, p));
  return { angle, coplanar };
}

/** Whether the face's loop traverses the edge reversed, or `undefined` when it doesn't use it. */
function findUse(store: EntityStore, faceId: FaceId, edgeId: EdgeId): boolean | undefined {
  return store
    .faceLoops(faceId)
    .flat()
    .find((use) => use.edge === edgeId)?.reversed;
}

function facePointsOn(store: EntityStore, faceId: FaceId, test: (p: Vec3) => boolean): boolean {
  return store.faceLoops(faceId).every((loop) => store.loopPoints(loop).every(test));
}
