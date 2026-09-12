import type { ValidationProblem } from '../errors';
import type { CurveId, DefinitionId, EdgeId, FaceId, VertexId } from '../ids';
import { aabbExpand } from '../math/aabb';
import {
  classifyPointInPolygon,
  classifyPointInRing,
  interiorPoint,
  signedArea,
  type Point2,
} from '../math/geom2d';
import { invertAffine, isMat4 } from '../math/mat4';
import { isPointOnPlane, planeBasis, planesCoincide, projectTo2D, type PlaneBasis } from '../math/plane';
import { closestPointsOnSegments, distancePointToSegment } from '../math/segment';
import { distance, isFiniteVec3 } from '../math/vec3';
import { EPS_AREA, EPS_LEN } from '../tolerance';
import type { EntityStore, FaceView } from './EntityStore';
import type { ModelDocument } from './ModelDocument';

export interface ValidationReport {
  readonly ok: boolean;
  readonly problems: readonly ValidationProblem[];
}

export interface ValidationScope {
  /** Only validate these definitions. Defaults to all. */
  readonly definitions?: Iterable<DefinitionId>;
}

type Reporter = (code: string, message: string, ids: readonly number[]) => void;

/**
 * Checks the kernel invariants listed in GEOMETRY.md ("Invariants"). It never modifies the document.
 * Pairwise geometric checks use the store's spatial indexes, so validating a normal-sized model stays close
 * to O(n log n).
 */
export function validateDocument(doc: ModelDocument, scope: ValidationScope = {}): ValidationReport {
  const problems: ValidationProblem[] = [];
  const definitionIds = scope.definitions ? [...scope.definitions] : [...doc.definitions()].map((d) => d.id);
  for (const id of definitionIds) {
    const definition = doc.definition(id);
    if (!definition) continue;
    const report: Reporter = (code, message, ids) => problems.push({ code, message, definitionId: id, ids });
    validateStore(doc, definition.store, report);
  }
  validateDocumentLevel(doc, (code, message, ids) =>
    problems.push({ code, message, definitionId: null, ids }),
  );
  return { ok: problems.length === 0, problems };
}

function sameMembers(actual: readonly number[], expected: readonly number[]): boolean {
  if (actual.length !== expected.length) return false;
  const a = [...actual].sort((x, y) => x - y);
  const b = [...expected].sort((x, y) => x - y);
  return a.every((value, index) => value === b[index]);
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function validateStore(doc: ModelDocument, store: EntityStore, report: Reporter): void {
  const expectedVertexEdges = new Map<VertexId, EdgeId[]>();
  const expectedEdgeFaces = new Map<EdgeId, FaceId[]>();
  const expectedEdgeCurve = new Map<EdgeId, CurveId>();
  const edgeByVertexPair = new Map<string, EdgeId>();

  for (const vertex of store.vertices()) {
    if (!isFiniteVec3(vertex.position))
      report('non-finite-vertex', 'Vertex has non-finite coordinates', [vertex.id]);
  }

  // Edges: references, length, duplicates.
  for (const edge of store.edges()) {
    if (!store.vertex(edge.v0) || !store.vertex(edge.v1)) {
      report('missing-reference', 'Edge references a missing vertex', [edge.id]);
      continue;
    }
    pushTo(expectedVertexEdges, edge.v0, edge.id);
    if (edge.v0 === edge.v1) {
      report('degenerate-edge', 'Edge starts and ends at the same vertex', [edge.id]);
      continue;
    }
    pushTo(expectedVertexEdges, edge.v1, edge.id);
    if (distance(store.position(edge.v0), store.position(edge.v1)) <= EPS_LEN) {
      report('short-edge', 'Edge is shorter than the length tolerance', [edge.id]);
    }
    const key =
      edge.v0 < edge.v1 ? `${String(edge.v0)}:${String(edge.v1)}` : `${String(edge.v1)}:${String(edge.v0)}`;
    const duplicate = edgeByVertexPair.get(key);
    if (duplicate !== undefined)
      report('duplicate-edge', 'Two edges join the same vertices', [duplicate, edge.id]);
    else edgeByVertexPair.set(key, edge.id);
    if (edge.attributes.materialId !== null && !doc.material(edge.attributes.materialId)) {
      report('missing-reference', 'Edge references a missing material', [edge.id]);
    }
    if (edge.attributes.tagId !== null && !doc.tag(edge.attributes.tagId)) {
      report('missing-reference', 'Edge references a missing tag', [edge.id]);
    }
  }

  for (const vertex of store.vertices()) {
    if (!sameMembers(vertex.edges, expectedVertexEdges.get(vertex.id) ?? [])) {
      report('vertex-adjacency', 'Vertex edge list is out of date', [vertex.id]);
    }
  }

  // Faces: loops, planarity, orientation, holes.
  for (const face of store.faces()) {
    if (validateFaceTopology(store, face, expectedEdgeFaces, report))
      validateFaceGeometry(store, face, report);
    const { frontMaterialId, backMaterialId, tagId } = face.attributes;
    for (const materialId of [frontMaterialId, backMaterialId]) {
      if (materialId !== null && !doc.material(materialId)) {
        report('missing-reference', 'Face references a missing material', [face.id]);
      }
    }
    if (tagId !== null && !doc.tag(tagId))
      report('missing-reference', 'Face references a missing tag', [face.id]);
  }

  for (const edge of store.edges()) {
    if (!sameMembers(edge.faces, expectedEdgeFaces.get(edge.id) ?? [])) {
      report('edge-face-adjacency', 'Edge face list is out of date', [edge.id]);
    }
  }

  // Curves: chains and back references.
  for (const curve of store.curves()) {
    if (curve.edges.length === 0) report('empty-curve', 'Curve has no edges', [curve.id]);
    let previous: { v0: VertexId; v1: VertexId } | undefined;
    for (const edgeId of curve.edges) {
      const edge = store.edge(edgeId);
      if (!edge) {
        report('missing-reference', 'Curve references a missing edge', [curve.id, edgeId]);
        previous = undefined;
        continue;
      }
      if (expectedEdgeCurve.has(edgeId)) {
        report('edge-in-several-curves', 'Edge is listed by more than one curve entry', [curve.id, edgeId]);
      }
      expectedEdgeCurve.set(edgeId, curve.id);
      if (
        previous &&
        previous.v0 !== edge.v0 &&
        previous.v0 !== edge.v1 &&
        previous.v1 !== edge.v0 &&
        previous.v1 !== edge.v1
      ) {
        report('curve-not-chained', 'Consecutive curve edges do not share a vertex', [curve.id, edgeId]);
      }
      previous = edge;
    }
  }
  for (const edge of store.edges()) {
    if ((expectedEdgeCurve.get(edge.id) ?? null) !== edge.curve) {
      report('edge-curve-link', 'Edge curve reference is out of date', [edge.id]);
    }
  }

  // Instances.
  for (const instance of store.instances()) {
    if (!doc.definition(instance.definitionId)) {
      report('missing-reference', 'Instance references a missing definition', [instance.id]);
    }
    if (!isMat4(instance.transform) || !invertAffine(instance.transform)) {
      report('invalid-transform', 'Instance transform is not finite and invertible', [instance.id]);
    }
    const { tagId, materialId } = instance.attributes;
    if (tagId !== null && !doc.tag(tagId))
      report('missing-reference', 'Instance references a missing tag', [instance.id]);
    if (materialId !== null && !doc.material(materialId)) {
      report('missing-reference', 'Instance references a missing material', [instance.id]);
    }
  }

  validateWelding(store, report);
  validateEdgeIntersections(store, report);
  validateCoplanarFaces(store, report);
}

/** Returns true when the face's loops are structurally sound enough for geometric checks. */
function validateFaceTopology(
  store: EntityStore,
  face: FaceView,
  expectedEdgeFaces: Map<EdgeId, FaceId[]>,
  report: Reporter,
): boolean {
  const loops = [face.outer, ...face.inners];
  const edgesInFace = new Set<EdgeId>();
  let sound = true;
  for (const loop of loops) {
    if (loop.length < 3) {
      report('short-loop', 'Face loop has fewer than three edges', [face.id]);
      sound = false;
    }
    let loopResolvable = true;
    for (const use of loop) {
      if (!store.edge(use.edge)) {
        report('missing-reference', 'Face references a missing edge', [face.id, use.edge]);
        loopResolvable = false;
        continue;
      }
      if (edgesInFace.has(use.edge)) {
        report('edge-repeated-in-face', 'Face uses the same edge more than once', [face.id, use.edge]);
        sound = false;
      } else {
        edgesInFace.add(use.edge);
        pushTo(expectedEdgeFaces, use.edge, face.id);
      }
    }
    if (!loopResolvable) {
      sound = false;
      continue;
    }
    for (let i = 0; i < loop.length; i++) {
      const use = loop[i];
      const next = loop[(i + 1) % loop.length];
      if (!use || !next) continue;
      if (store.useEnd(use) !== store.useStart(next)) {
        report('open-loop', 'Face loop is not closed', [face.id, use.edge]);
        sound = false;
      }
    }
    // Loops of one face may touch at a vertex (invariant 10), but a single loop must not revisit one.
    const verticesInLoop = new Set<VertexId>();
    for (const vertex of store.loopVertices(loop)) {
      if (verticesInLoop.has(vertex)) {
        report('loop-not-simple', 'A vertex appears more than once in a face loop', [face.id, vertex]);
        sound = false;
      }
      verticesInLoop.add(vertex);
    }
  }
  return sound;
}

function faceRings(store: EntityStore, face: FaceView, basis: PlaneBasis): Point2[][] {
  return [face.outer, ...face.inners].map((loop) => store.loopPoints(loop).map((p) => projectTo2D(basis, p)));
}

function validateFaceGeometry(store: EntityStore, face: FaceView, report: Reporter): void {
  const plane = face.plane;
  if (!plane) {
    report('degenerate-face', 'Face outline has no area', [face.id]);
    return;
  }
  const allPoints = [face.outer, ...face.inners].flatMap((loop) => store.loopPoints(loop));
  if (!allPoints.every((p) => isPointOnPlane(plane, p))) {
    report('non-planar-face', 'Face vertices are not coplanar', [face.id]);
    return;
  }
  const [outer, ...inners] = faceRings(store, face, planeBasis(plane.normal));
  if (!outer) return;
  if (signedArea(outer) <= EPS_AREA) {
    report('outer-loop-orientation', 'Outer loop is not counter-clockwise around the face normal', [face.id]);
  }
  inners.forEach((inner, index) => {
    if (signedArea(inner) >= -EPS_AREA) {
      report('inner-loop-orientation', 'Hole loop is not clockwise around the face normal', [face.id]);
    }
    // Holes may touch the outer loop or each other at vertices (invariant 13), so a single boundary vertex proves
    // nothing. Check that no vertex lies on the wrong side and that a point strictly inside the hole is contained.
    const island = interiorPoint(inner, []);
    const escapesOuter =
      inner.some((p) => classifyPointInRing(p, outer) === 'outside') ||
      (island !== null && classifyPointInRing(island, outer) !== 'inside');
    if (escapesOuter) report('hole-outside-face', 'Hole is not inside the outer loop', [face.id]);
    inners.forEach((other, otherIndex) => {
      if (otherIndex === index) return;
      const overlaps =
        inner.some((p) => classifyPointInRing(p, other) === 'inside') ||
        (island !== null && classifyPointInRing(island, other) === 'inside');
      if (overlaps) report('overlapping-holes', 'Holes overlap or are nested', [face.id]);
    });
  });
}

function validateWelding(store: EntityStore, report: Reporter): void {
  for (const vertex of store.vertices()) {
    for (const other of store.verticesWithin(vertex.position, EPS_LEN)) {
      if (other > vertex.id) {
        report('unwelded-vertices', 'Two vertices are closer than the length tolerance', [vertex.id, other]);
      }
    }
  }
}

function validateEdgeIntersections(store: EntityStore, report: Reporter): void {
  for (const edge of store.edges()) {
    if (!store.vertex(edge.v0) || !store.vertex(edge.v1) || edge.v0 === edge.v1) continue;
    const a = store.position(edge.v0);
    const b = store.position(edge.v1);
    for (const otherId of store.queryEdges(aabbExpand(store.edgeBounds(edge.id), EPS_LEN))) {
      if (otherId === edge.id) continue;
      const other = store.edge(otherId);
      if (!other || !store.vertex(other.v0) || !store.vertex(other.v1)) continue;
      // T-junction: an endpoint of the other edge lies on this edge's interior.
      for (const vertex of [other.v0, other.v1]) {
        if (vertex === edge.v0 || vertex === edge.v1) continue;
        if (distancePointToSegment(store.position(vertex), a, b) <= EPS_LEN) {
          report('t-junction', 'A vertex lies on the interior of an edge it does not belong to', [
            edge.id,
            vertex,
          ]);
        }
      }
      if (otherId < edge.id) continue;
      const sharesVertex =
        other.v0 === edge.v0 || other.v0 === edge.v1 || other.v1 === edge.v0 || other.v1 === edge.v1;
      if (sharesVertex) continue;
      const closest = closestPointsOnSegments(a, b, store.position(other.v0), store.position(other.v1));
      if (closest.distance <= EPS_LEN) {
        report('edges-intersect', 'Two edges cross or touch without sharing a vertex', [edge.id, otherId]);
      }
    }
  }
}

function validateCoplanarFaces(store: EntityStore, report: Reporter): void {
  for (const face of store.faces()) {
    const plane = face.plane;
    if (!plane) continue;
    for (const otherId of store.queryFaces(aabbExpand(store.faceBounds(face.id), EPS_LEN))) {
      if (otherId <= face.id) continue;
      const other = store.getFace(otherId);
      if (!other.plane || !planesCoincide(plane, other.plane)) continue;
      const basis = planeBasis(plane.normal);
      const [outerA, ...holesA] = faceRings(store, face, basis);
      const [outerB, ...holesB] = faceRings(store, other, basis);
      if (!outerA || !outerB) continue;
      const sampleA = interiorPoint(outerA, holesA);
      const sampleB = interiorPoint(outerB, holesB);
      const overlaps =
        (sampleA !== null && classifyPointInPolygon(sampleA, outerB, holesB) === 'inside') ||
        (sampleB !== null && classifyPointInPolygon(sampleB, outerA, holesA) === 'inside');
      if (overlaps) report('overlapping-faces', 'Two coplanar faces cover the same area', [face.id, otherId]);
    }
  }
}

function validateDocumentLevel(doc: ModelDocument, report: Reporter): void {
  if (!doc.definition(doc.rootDefinitionId)) report('missing-root', 'Root definition is missing', []);
  for (const definition of doc.definitions()) {
    for (const instance of definition.store.instances()) {
      if (
        doc.definition(instance.definitionId) &&
        doc.definitionContains(instance.definitionId, definition.id)
      ) {
        report('definition-cycle', 'A definition contains itself through its instances', [instance.id]);
      }
      if (instance.definitionId === doc.rootDefinitionId) {
        report('root-instanced', 'The root definition is instanced', [instance.id]);
      }
    }
  }
  const inUnitRange = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
  for (const material of doc.materials()) {
    const { r, g, b } = material.color;
    if (![r, g, b, material.opacity].every(inUnitRange)) {
      report('invalid-material', 'Material color or opacity is outside [0, 1]', [material.id]);
    }
  }
}
