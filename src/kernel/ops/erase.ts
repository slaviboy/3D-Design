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

import type { DefinitionId, EdgeId, FaceId } from '../ids';
import { classifyPointInPolygon } from '../math/geom2d';
import { planeBasis, planesCoincide } from '../math/plane';
import { dot } from '../math/vec3';
import type { EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import { addFace, removeEdge, removeFace, removeVertex, setFaceLoops } from '../model/mutations';
import { detachEdgeFromCurve } from './curves';
import { buildRegions, faceArea, faceRings, loopsForRegion } from './planar/regions';

/**
 * Erases edges the way the Eraser tool does. An edge that only separates two coplanar faces facing the same
 * way heals them into one face. Otherwise the faces the edge bounds are deleted along with it. Vertices left
 * without edges are removed.
 */
export function eraseEdges(doc: ModelDocument, context: DefinitionId, edgeIds: readonly EdgeId[]): void {
  doc.transact('Erase', () => {
    const store = doc.store(context);
    for (const edgeId of edgeIds) {
      if (store.edge(edgeId)) eraseEdge(doc, context, edgeId);
    }
  });
}

/** Deletes faces without touching their edges. */
export function deleteFaces(doc: ModelDocument, context: DefinitionId, faceIds: readonly FaceId[]): void {
  doc.transact('Delete faces', () => {
    const store = doc.store(context);
    for (const faceId of faceIds) {
      if (store.face(faceId)) removeFace(doc, context, faceId);
    }
  });
}

function eraseEdge(doc: ModelDocument, context: DefinitionId, edgeId: EdgeId): void {
  const store = doc.store(context);
  const edge = store.getEdge(edgeId);
  const [first, second] = edge.faces;
  if (
    edge.faces.length === 2 &&
    first !== undefined &&
    second !== undefined &&
    canHeal(store, first, second)
  ) {
    healAcrossEdge(doc, context, first, second, edgeId);
    return;
  }
  for (const faceId of [...edge.faces]) removeFace(doc, context, faceId);
  removeEdgeAndOrphans(doc, context, edgeId);
}

function canHeal(store: EntityStore, a: FaceId, b: FaceId): boolean {
  const planeA = store.getFace(a).plane;
  const planeB = store.getFace(b).plane;
  return (
    planeA !== null &&
    planeB !== null &&
    planesCoincide(planeA, planeB) &&
    dot(planeA.normal, planeB.normal) > 0
  );
}

function healAcrossEdge(
  doc: ModelDocument,
  context: DefinitionId,
  a: FaceId,
  b: FaceId,
  edgeId: EdgeId,
): void {
  const store = doc.store(context);
  const keepId = faceArea(store, a) >= faceArea(store, b) ? a : b;
  const dropId = keepId === a ? b : a;
  const keep = store.getFace(keepId);
  const plane = store.getFacePlane(keepId);
  const basis = planeBasis(plane.normal);
  const originalRings = [faceRings(store, a, basis), faceRings(store, b, basis)];
  const edges = new Set([...store.faceEdges(a), ...store.faceEdges(b)]);
  edges.delete(edgeId);

  const regions = buildRegions(
    store,
    basis,
    [...edges].sort((x, y) => x - y),
  )
    .filter((region) =>
      originalRings.some(
        (rings) => classifyPointInPolygon(region.sample, rings.outer, rings.inners) === 'inside',
      ),
    )
    .sort((x, y) => y.area - x.area);

  const attributes = keep.attributes;
  removeFace(doc, context, dropId);
  const [largest, ...rest] = regions;
  if (largest) {
    setFaceLoops(doc, context, keepId, loopsForRegion(largest, true));
    for (const region of rest) addFace(doc, context, loopsForRegion(region, true), attributes);
  } else {
    removeFace(doc, context, keepId);
  }
  removeEdgeAndOrphans(doc, context, edgeId);
}

/** Removes a faceless edge, detaching it from its curve and deleting endpoints that no other edge uses. */
export function removeEdgeAndOrphans(doc: ModelDocument, context: DefinitionId, edgeId: EdgeId): void {
  const store = doc.store(context);
  const edge = store.getEdge(edgeId);
  if (edge.curve !== null) detachEdgeFromCurve(doc, context, edge.curve, edgeId);
  const { v0, v1 } = edge;
  removeEdge(doc, context, edgeId);
  for (const vertex of [v0, v1]) {
    const view = store.vertex(vertex);
    if (view?.edges.length === 0) removeVertex(doc, context, vertex);
  }
}
