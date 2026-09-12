import type { FaceId, VertexId } from '../ids';
import { signedArea, triangulatePolygon } from '../math/geom2d';
import { planeBasis, projectTo2D } from '../math/plane';
import type { EntityStore } from '../model/EntityStore';
import { EPS_AREA } from '../tolerance';

export interface FaceTriangulation {
  /** Vertex ids referenced by `indices`: the outer loop followed by each hole loop. */
  readonly vertices: readonly VertexId[];
  /** Three indices into `vertices` per triangle, counter-clockwise around the face normal. */
  readonly indices: readonly number[];
  /** |triangle area − face area| / face area. Near 0 for a correct triangulation. */
  readonly relativeAreaError: number;
}

/** Triangulates a planar face with holes in its own plane basis. */
export function triangulateFace(store: EntityStore, faceId: FaceId): FaceTriangulation {
  const basis = planeBasis(store.getFacePlane(faceId).normal);
  const loops = store.faceLoops(faceId);
  const vertices = loops.flatMap((loop) => store.loopVertices(loop));
  const rings = loops.map((loop) => store.loopPoints(loop).map((p) => projectTo2D(basis, p)));
  const [outer = [], ...holes] = rings;
  const indices = triangulatePolygon(outer, holes);

  const points = rings.flat();
  const faceArea =
    Math.abs(signedArea(outer)) - holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
  let triangleArea = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = points[indices[i] ?? -1];
    const b = points[indices[i + 1] ?? -1];
    const c = points[indices[i + 2] ?? -1];
    if (a && b && c) triangleArea += Math.abs(signedArea([a, b, c]));
  }
  const relativeAreaError = Math.abs(triangleArea - faceArea) / Math.max(faceArea, EPS_AREA);

  // earcut does not guarantee winding; make every triangle counter-clockwise in the face basis.
  const oriented: number[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const ia = indices[i] ?? 0;
    const ib = indices[i + 1] ?? 0;
    const ic = indices[i + 2] ?? 0;
    const a = points[ia];
    const b = points[ib];
    const c = points[ic];
    if (a && b && c && signedArea([a, b, c]) < 0) oriented.push(ia, ic, ib);
    else oriented.push(ia, ib, ic);
  }
  return { vertices, indices: oriented, relativeAreaError };
}
