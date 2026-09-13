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

import type { DefinitionId, EdgeId, FaceId, InstanceId } from '../ids';
import { multiply, transformNormal, transformPoint, type Mat4 } from '../math/mat4';
import { planeFromPolygon } from '../math/plane';
import { normalize, type Vec3 } from '../math/vec3';
import type { EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import { addCurve, addInstance } from '../model/mutations';
import type { CurveParams, EdgeAttributes, FaceAttributes, InstanceAttributes } from '../model/types';
import { splitCurveChains, transformCurveParams } from './curves';
import { insertSegments } from './insertSegments';
import { settleRegion, type CoincidentFaceRule } from './planar/settle';

/*
 * A geometry fragment is a detached copy of some entities: positions and attributes, with no ids of its own.
 * Capturing a fragment and inserting it elsewhere is how explode, copy and detached moves merge geometry into its
 * destination with the usual sticky-geometry rules.
 */

export interface FragmentSelection {
  readonly faces: readonly FaceId[];
  readonly edges: readonly EdgeId[];
  readonly instances: readonly InstanceId[];
}

interface FragmentEdge {
  readonly source: EdgeId;
  readonly a: Vec3;
  readonly b: Vec3;
  readonly attributes: EdgeAttributes;
}

interface FragmentFace {
  readonly outer: readonly Vec3[];
  readonly inners: readonly (readonly Vec3[])[];
  readonly normal: Vec3;
  readonly edges: readonly EdgeId[];
  readonly attributes: FaceAttributes;
}

interface FragmentCurve {
  readonly params: CurveParams;
  readonly edges: readonly EdgeId[];
}

interface FragmentInstance {
  readonly definitionId: DefinitionId;
  readonly transform: Mat4;
  readonly attributes: InstanceAttributes;
}

export interface GeometryFragment {
  readonly edges: readonly FragmentEdge[];
  readonly faces: readonly FragmentFace[];
  readonly curves: readonly FragmentCurve[];
  readonly instances: readonly FragmentInstance[];
}

export interface InsertedFragment {
  readonly edges: readonly EdgeId[];
  readonly faces: readonly FaceId[];
  readonly instances: readonly InstanceId[];
}

const byId = (a: number, b: number): number => a - b;

/** Captures faces (with their boundary edges), edges and instances from a definition. Nothing is modified. */
export function captureFragment(store: EntityStore, selection: FragmentSelection): GeometryFragment {
  const faceIds = [...new Set(selection.faces)].filter((id) => store.face(id)?.plane).sort(byId);
  const edgeIds = new Set(selection.edges.filter((id) => store.edge(id)));
  for (const faceId of faceIds) for (const edgeId of store.faceEdges(faceId)) edgeIds.add(edgeId);
  const sortedEdges = [...edgeIds].sort(byId);

  const edges = sortedEdges.map((id) => {
    const edge = store.getEdge(id);
    return {
      source: id,
      a: store.position(edge.v0),
      b: store.position(edge.v1),
      attributes: edge.attributes,
    };
  });
  const faces = faceIds.map((id) => {
    const face = store.getFace(id);
    return {
      outer: store.loopPoints(face.outer),
      inners: face.inners.map((loop) => store.loopPoints(loop)),
      normal: store.getFacePlane(id).normal,
      edges: store.faceEdges(id),
      attributes: face.attributes,
    };
  });
  const curves: FragmentCurve[] = [];
  const curveIds = new Set(sortedEdges.flatMap((id) => store.getEdge(id).curve ?? []));
  for (const curveId of [...curveIds].sort(byId)) {
    const curve = store.getCurve(curveId);
    const captured = curve.edges.filter((id) => edgeIds.has(id));
    const params: CurveParams = captured.length === curve.edges.length ? curve.params : { kind: 'polyline' };
    for (const chain of splitCurveChains(store, captured)) curves.push({ params, edges: chain });
  }
  const instances = [...new Set(selection.instances)]
    .filter((id) => store.instance(id))
    .sort(byId)
    .map((id) => {
      const instance = store.getInstance(id);
      return {
        definitionId: instance.definitionId,
        transform: instance.transform,
        attributes: instance.attributes,
      };
    });
  return { edges, faces, curves, instances };
}

/** Inserts a transformed fragment into a definition, merging with the geometry already there. */
export function insertFragment(
  doc: ModelDocument,
  context: DefinitionId,
  fragment: GeometryFragment,
  transform: Mat4,
  rule: CoincidentFaceRule = 'merge',
): InsertedFragment {
  return doc.transact('Insert geometry', () => {
    const inserted = insertSegments(
      doc,
      context,
      fragment.edges.map((edge) => ({
        a: transformPoint(transform, edge.a),
        b: transformPoint(transform, edge.b),
        attributes: edge.attributes,
      })),
      { autoFace: false },
    );
    const chains = new Map<EdgeId, readonly EdgeId[]>();
    fragment.edges.forEach((edge, index) => chains.set(edge.source, inserted.segmentEdges[index] ?? []));

    const faces = new Set<FaceId>();
    for (const face of fragment.faces) {
      const outer = face.outer.map((p) => transformPoint(transform, p));
      const plane = planeFromPolygon(outer);
      const transformedNormal = transformNormal(transform, face.normal);
      const normal = transformedNormal ? normalize(transformedNormal) : null;
      if (!plane || !normal) continue;
      const covering = settleRegion(doc, context, {
        plane,
        seeds: face.edges.flatMap((id) => chains.get(id) ?? []),
        outer,
        inners: face.inners.map((loop) => loop.map((p) => transformPoint(transform, p))),
        normal,
        attributes: face.attributes,
        rule,
      });
      for (const faceId of covering) faces.add(faceId);
    }

    const store = doc.store(context);
    for (const curve of fragment.curves) {
      const edges = curve.edges.flatMap((id) => chains.get(id) ?? []);
      const unique = new Set(edges).size === edges.length;
      const free = edges.every((id) => store.edge(id)?.curve === null);
      if (edges.length === 0 || !unique || !free) continue;
      const curveChains = splitCurveChains(store, edges);
      const params: CurveParams =
        curveChains.length === 1 ? transformCurveParams(curve.params, transform) : { kind: 'polyline' };
      for (const chain of curveChains) addCurve(doc, context, params, chain);
    }

    const instances = fragment.instances.map((instance) =>
      addInstance(
        doc,
        context,
        instance.definitionId,
        multiply(transform, instance.transform),
        instance.attributes,
      ),
    );
    const edges = [...new Set([...chains.values()].flat())].filter((id) => store.edge(id) !== undefined);
    return { edges, faces: [...faces].filter((id) => store.face(id) !== undefined), instances };
  });
}
