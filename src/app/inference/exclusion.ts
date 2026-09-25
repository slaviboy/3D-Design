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

import type { CurveId, DefinitionId, EdgeId, FaceId, InstanceId, VertexId } from '../../kernel/ids';
import type { EntityStore } from '../../kernel/model/EntityStore';
import type { TransactionRecord } from '../../kernel/model/ModelDocument';
import { movingParts, type TransformSelection } from '../../kernel/ops/transform';
import type { PickSkip } from '../picking/picker';

/**
 * Geometry of the active context that the pointer must not snap to, because an operation is changing it. It still
 * hides what lies behind it, as it does on screen.
 */
export interface InferenceExclusion {
  /** Vertices that aren't snap targets. Edges touching them lose their midpoint and on-edge points too. */
  readonly vertices: ReadonlySet<VertexId>;
  readonly edges: ReadonlySet<EdgeId>;
  /** Curves whose center isn't a snap target. */
  readonly curves: ReadonlySet<CurveId>;
  /** Instances that aren't snap targets, with everything inside them. */
  readonly instances: ReadonlySet<InstanceId>;
  /**
   * Faces and instances that can't be the face under the pointer either, because they follow it: a point on them
   * would feed the operation's own result back into it.
   */
  readonly faceTargets: PickSkip | null;
}

export const NO_EXCLUSION: InferenceExclusion = Object.freeze({
  vertices: new Set<VertexId>(),
  edges: new Set<EdgeId>(),
  curves: new Set<CurveId>(),
  instances: new Set<InstanceId>(),
  faceTargets: null,
});

function curvesOf(store: EntityStore, edges: ReadonlySet<EdgeId>): Set<CurveId> {
  const curves = new Set<CurveId>();
  for (const id of edges) {
    const curve = store.edge(id)?.curve;
    if (curve !== undefined && curve !== null) curves.add(curve);
  }
  return curves;
}

/** Faces with a corner at one of the vertices: they move or stretch with them. */
function facesTouching(store: EntityStore, vertices: ReadonlySet<VertexId>): Set<FaceId> {
  const faces = new Set<FaceId>();
  for (const vertexId of vertices) {
    for (const edgeId of store.vertex(vertexId)?.edges ?? []) {
      for (const faceId of store.edge(edgeId)?.faces ?? []) faces.add(faceId);
    }
  }
  return faces;
}

/** For Move and Rotate before the first preview: the geometry about to move, which will follow the pointer. */
export function exclusionForMove(store: EntityStore, selection: TransformSelection): InferenceExclusion {
  const parts = movingParts(store, selection);
  const instances = new Set(parts.instances);
  return {
    vertices: parts.vertices,
    edges: parts.edges,
    curves: curvesOf(store, parts.edges),
    instances,
    faceTargets: { faces: facesTouching(store, parts.vertices), instances },
  };
}

/**
 * For Push/Pull and Offset: the outline being pushed or offset. Snapping to it would only measure a distance of
 * zero. Its face can still be the face under the pointer.
 */
export function exclusionForBoundary(
  store: EntityStore,
  source: { readonly faces?: readonly FaceId[]; readonly edges?: readonly EdgeId[] },
): InferenceExclusion {
  const edges = new Set<EdgeId>((source.edges ?? []).filter((id) => store.edge(id)));
  for (const face of source.faces ?? []) {
    if (store.face(face)) for (const edge of store.faceEdges(face)) edges.add(edge);
  }
  const vertices = new Set<VertexId>();
  for (const id of edges) {
    const edge = store.getEdge(id);
    vertices.add(edge.v0);
    vertices.add(edge.v1);
  }
  return { vertices, edges, curves: curvesOf(store, edges), instances: new Set(), faceTargets: null };
}

/**
 * For a preview drawn into the model (a speculative attempt): everything it added, moved or reshaped in `context`.
 * The preview sits under the pointer, so it's neither a snap target nor the face under the pointer.
 */
export function exclusionForChanges(
  store: EntityStore,
  context: DefinitionId,
  record: TransactionRecord | undefined,
): InferenceExclusion {
  if (!record) return NO_EXCLUSION;
  const vertices = new Set<VertexId>();
  const edges = new Set<EdgeId>();
  const faces = new Set<FaceId>();
  const curves = new Set<CurveId>();
  const instances = new Set<InstanceId>();
  for (const change of record.changes) {
    if (!('context' in change) || change.context !== context) continue;
    switch (change.kind) {
      case 'vertex.add':
        vertices.add(change.data.id);
        break;
      case 'vertex.move':
        vertices.add(change.id);
        break;
      case 'edge.add':
        edges.add(change.data.id);
        break;
      case 'face.add':
        faces.add(change.data.id);
        break;
      case 'face.loops':
        faces.add(change.id);
        break;
      case 'curve.add':
        curves.add(change.data.id);
        break;
      case 'curve.params':
      case 'curve.edges':
        curves.add(change.id);
        break;
      case 'instance.add':
        instances.add(change.data.id);
        break;
      case 'instance.transform':
        instances.add(change.id);
        break;
      default:
        break;
    }
  }
  for (const face of facesTouching(store, vertices)) faces.add(face);
  return { vertices, edges, curves, instances, faceTargets: { faces, instances } };
}

/** Everything any of the exclusions leaves out. */
export function combineExclusions(...exclusions: readonly InferenceExclusion[]): InferenceExclusion {
  const union = <T>(sets: readonly (ReadonlySet<T> | undefined)[]): Set<T> => {
    const all = new Set<T>();
    for (const set of sets) for (const item of set ?? []) all.add(item);
    return all;
  };
  const targets = exclusions.flatMap((exclusion) => (exclusion.faceTargets ? [exclusion.faceTargets] : []));
  return {
    vertices: union(exclusions.map((exclusion) => exclusion.vertices)),
    edges: union(exclusions.map((exclusion) => exclusion.edges)),
    curves: union(exclusions.map((exclusion) => exclusion.curves)),
    instances: union(exclusions.map((exclusion) => exclusion.instances)),
    faceTargets:
      targets.length === 0
        ? null
        : {
            faces: union(targets.map((target) => target.faces)),
            instances: union(targets.map((target) => target.instances)),
          },
  };
}
