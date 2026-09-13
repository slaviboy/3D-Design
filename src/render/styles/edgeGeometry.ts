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

import * as THREE from 'three';
import type { FaceId, VertexId } from '../../kernel/ids';
import type { EntityStore } from '../../kernel/model/EntityStore';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import type { StyleSettings } from '../../kernel/model/types';
import { isTagVisible } from '../../kernel/model/visibility';
import { triangulateFace } from '../../kernel/ops/triangulate';
import { VIEW_COLORS } from '../palette';
import { srgbColor } from './edgeStyle';

/** Edges closer than this to an axis direction (by the cosine of the angle) take the axis color. */
const AXIS_PARALLEL_COSINE = 1 - 1e-9;

/** Vertex data for a definition's visible edges in the current style. */
export interface EdgeStyleArrays {
  /** Two points per edge. */
  readonly positions: number[];
  /** Linear RGB per point. */
  readonly colors: number[];
  /** For each point, the other end of its edge (for extensions). */
  readonly others: number[];
  /** Distance along the edge per point: 0 at the start, the edge length at the end (for dashes). */
  readonly distances: number[];
  /** One point per distinct edge end. */
  readonly endpoints: number[];
  /** Edges that bound at least one visible face, two points each; empty unless profiles are requested. */
  readonly profilePositions: number[];
  /** Per profile edge: the direction from the edge into its first face. */
  readonly profileInA: number[];
  /** Per profile edge: the direction into its second face, or zero when it bounds only one. */
  readonly profileInB: number[];
}

const key = (a: VertexId, b: VertexId): string =>
  a < b ? `${String(a)}:${String(b)}` : `${String(b)}:${String(a)}`;

/**
 * Builds vertex data for edges, skipping hidden and soft edges and edges on hidden tags (as the plain edge renderer
 * does). Edge colors follow the style's color mode; axis colors compare edge directions in the definition's own
 * coordinates with the document's drawing axes.
 */
export function buildEdgeStyleArrays(
  doc: ModelDocument,
  store: EntityStore,
  style: StyleSettings,
  withProfiles: boolean,
): EdgeStyleArrays {
  const arrays: EdgeStyleArrays = {
    positions: [],
    colors: [],
    others: [],
    distances: [],
    endpoints: [],
    profilePositions: [],
    profileInA: [],
    profileInB: [],
  };
  const base = srgbColor(style.edgeColor);
  const axisColors = [VIEW_COLORS.axisX, VIEW_COLORS.axisY, VIEW_COLORS.axisZ].map((hex) =>
    new THREE.Color().setHex(hex),
  );
  const { xAxis, yAxis } = doc.axes;
  const zAxis = new THREE.Vector3(xAxis.x, xAxis.y, xAxis.z).cross(
    new THREE.Vector3(yAxis.x, yAxis.y, yAxis.z),
  );
  const axes = [
    new THREE.Vector3(xAxis.x, xAxis.y, xAxis.z),
    new THREE.Vector3(yAxis.x, yAxis.y, yAxis.z),
    zAxis,
  ].map((axis) => axis.normalize());
  const materialColors = new Map<number, THREE.Color>();
  const seenEnds = new Set<VertexId>();
  const corners: FaceCorners = new Map();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const direction = new THREE.Vector3();

  for (const edge of store.edges()) {
    if (edge.attributes.hidden || !isTagVisible(doc, edge.attributes.tagId)) continue;
    const pa = store.position(edge.v0);
    const pb = store.position(edge.v1);
    a.set(pa.x, pa.y, pa.z);
    b.set(pb.x, pb.y, pb.z);
    if (withProfiles) addProfile(doc, store, corners, edge.faces, edge.v0, edge.v1, a, b, arrays);
    if (edge.attributes.soft) continue;

    let color = base;
    if (style.edgeColorMode === 'byAxis') {
      direction.subVectors(b, a).normalize();
      const index = axes.findIndex((axis) => Math.abs(axis.dot(direction)) >= AXIS_PARALLEL_COSINE);
      color = axisColors[index] ?? base;
    } else if (style.edgeColorMode === 'byMaterial' && edge.attributes.materialId !== null) {
      const id = edge.attributes.materialId;
      let materialColor = materialColors.get(id);
      const data = doc.material(id);
      if (!materialColor && data) {
        // Material colors are linear RGB.
        materialColor = new THREE.Color().setRGB(data.color.r, data.color.g, data.color.b);
        materialColors.set(id, materialColor);
      }
      color = materialColor ?? base;
    }
    arrays.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    arrays.others.push(b.x, b.y, b.z, a.x, a.y, a.z);
    arrays.colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    arrays.distances.push(0, a.distanceTo(b));
    for (const [vertex, point] of [
      [edge.v0, a],
      [edge.v1, b],
    ] as const) {
      if (seenEnds.has(vertex)) continue;
      seenEnds.add(vertex);
      arrays.endpoints.push(point.x, point.y, point.z);
    }
  }
  return arrays;
}

/** Third corners of the triangles along each boundary segment of a face, by face and vertex pair. */
type FaceCorners = Map<FaceId, Map<string, VertexId>>;

function cornerBeside(
  store: EntityStore,
  byFace: FaceCorners,
  faceId: FaceId,
  v0: VertexId,
  v1: VertexId,
): VertexId | undefined {
  let corners = byFace.get(faceId);
  if (!corners) {
    corners = new Map();
    const { vertices, indices } = triangulateFace(store, faceId);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const tri = [
        vertices[indices[i] ?? -1],
        vertices[indices[i + 1] ?? -1],
        vertices[indices[i + 2] ?? -1],
      ];
      const [p, q, r] = tri;
      if (p === undefined || q === undefined || r === undefined) continue;
      corners.set(key(p, q), r);
      corners.set(key(q, r), p);
      corners.set(key(r, p), q);
    }
    byFace.set(faceId, corners);
  }
  return corners.get(key(v0, v1));
}

function addProfile(
  doc: ModelDocument,
  store: EntityStore,
  corners: FaceCorners,
  faces: readonly FaceId[],
  v0: VertexId,
  v1: VertexId,
  a: THREE.Vector3,
  b: THREE.Vector3,
  arrays: EdgeStyleArrays,
): void {
  const inward: THREE.Vector3[] = [];
  const edgeDirection = new THREE.Vector3().subVectors(b, a);
  const lengthSquared = edgeDirection.lengthSq();
  if (lengthSquared === 0) return;
  for (const faceId of faces) {
    if (inward.length === 2) break;
    const face = store.getFace(faceId);
    if (face.attributes.hidden || !face.plane || !isTagVisible(doc, face.attributes.tagId)) continue;
    const corner = cornerBeside(store, corners, faceId, v0, v1);
    if (corner === undefined) continue;
    const p = store.position(corner);
    const t = new THREE.Vector3(p.x, p.y, p.z).sub(a);
    t.addScaledVector(edgeDirection, -t.dot(edgeDirection) / lengthSquared);
    if (t.lengthSq() === 0) continue;
    inward.push(t.normalize());
  }
  const [first, second] = inward;
  if (!first) return;
  arrays.profilePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  arrays.profileInA.push(first.x, first.y, first.z);
  arrays.profileInB.push(second?.x ?? 0, second?.y ?? 0, second?.z ?? 0);
}
