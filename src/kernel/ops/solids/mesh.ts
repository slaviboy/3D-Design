import type { DefinitionId, EdgeId, FaceId } from '../../ids';
import { classifyPointInRing, signedArea, type Point2 } from '../../math/geom2d';
import { IDENTITY, linearDeterminant, transformNormal, transformPoint, type Mat4 } from '../../math/mat4';
import {
  planeBasis,
  planeFromPointNormal,
  planesCoincide,
  projectTo2D,
  signedDistanceToPlane,
  type Plane,
} from '../../math/plane';
import { distancePointToLine } from '../../math/segment';
import { add, cross, dot, length, normalize, scale, sub, vec3, type Vec3 } from '../../math/vec3';
import type { EntityStore } from '../../model/EntityStore';
import type { ModelDocument } from '../../model/ModelDocument';
import { DEFAULT_FACE_ATTRIBUTES, type FaceAttributes } from '../../model/types';
import { EPS_AREA, EPS_LEN, EPS_MESH_SNAP, WELD_GRID_CELL_SIZE } from '../../tolerance';
import { insertSegments, type SegmentInput } from '../insertSegments';
import { settleRegion } from '../planar/settle';
import { triangulateFace } from '../triangulate';

/** An indexed triangle mesh. Triangles wind counter-clockwise seen from the front (outside) of the surface. */
export interface TriangleMesh {
  /** x, y, z per vertex. */
  readonly positions: Float64Array;
  /** Three vertex indices per triangle. */
  readonly indices: Uint32Array;
  /** Per triangle, the key of the face it came from (a face id for meshes made by {@link toTriangleMesh}). */
  readonly faceIds: Uint32Array;
}

/** What a triangle's source face looked like, so faces rebuilt from a mesh keep their plane and materials. */
export interface FaceProvenance {
  /** The source face's plane in mesh coordinates. */
  readonly plane: Plane;
  readonly attributes: FaceAttributes;
}

export type MeshProvenance = ReadonlyMap<number, FaceProvenance>;

export interface InsertedMesh {
  readonly faces: readonly FaceId[];
  readonly edges: readonly EdgeId[];
}

const byId = (a: number, b: number): number => a - b;

/** Triangulates every face of a definition into one indexed mesh in the coordinates given by `transform`. */
export function toTriangleMesh(store: EntityStore, transform: Mat4 = IDENTITY): TriangleMesh {
  const mirrored = linearDeterminant(transform) < 0;
  const vertexIndex = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const faceIds: number[] = [];
  const faces = [...store.faces()].filter((face) => face.plane).sort((a, b) => a.id - b.id);
  for (const face of faces) {
    const triangulation = triangulateFace(store, face.id);
    const local = triangulation.vertices.map((vertex) => {
      let index = vertexIndex.get(vertex);
      if (index === undefined) {
        index = positions.length / 3;
        const p = transformPoint(transform, store.position(vertex));
        positions.push(p.x, p.y, p.z);
        vertexIndex.set(vertex, index);
      }
      return index;
    });
    for (let i = 0; i + 2 < triangulation.indices.length; i += 3) {
      const a = local[triangulation.indices[i] ?? -1];
      const b = local[triangulation.indices[i + 1] ?? -1];
      const c = local[triangulation.indices[i + 2] ?? -1];
      if (a === undefined || b === undefined || c === undefined) continue;
      if (mirrored) indices.push(a, c, b);
      else indices.push(a, b, c);
      faceIds.push(face.id);
    }
  }
  return {
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
    faceIds: Uint32Array.from(faceIds),
  };
}

/** The plane and attributes of every face of a definition, keyed by face id, in `transform` coordinates. */
export function faceProvenance(store: EntityStore, transform: Mat4 = IDENTITY): Map<number, FaceProvenance> {
  const result = new Map<number, FaceProvenance>();
  for (const face of store.faces()) {
    if (!face.plane) continue;
    const [first] = store.loopPoints(face.outer);
    if (!first) continue;
    const point = transformPoint(transform, first);
    const transformed = transformNormal(transform, face.plane.normal);
    const normal = transformed ? normalize(transformed) : null;
    if (!normal) continue;
    result.set(face.id, { plane: planeFromPointNormal(point, normal), attributes: face.attributes });
  }
  return result;
}

/** Signed volume of a closed mesh (positive when its triangles face outward). */
export function meshVolume(mesh: TriangleMesh): number {
  let volume = 0;
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = pointAt(mesh.positions, mesh.indices[t] ?? 0);
    const b = pointAt(mesh.positions, mesh.indices[t + 1] ?? 0);
    const c = pointAt(mesh.positions, mesh.indices[t + 2] ?? 0);
    volume += dot(a, cross(b, c)) / 6;
  }
  return volume;
}

/** The same mesh with every triangle facing the other way. */
export function reverseMesh(mesh: TriangleMesh): TriangleMesh {
  const indices = new Uint32Array(mesh.indices.length);
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    indices[t] = mesh.indices[t] ?? 0;
    indices[t + 1] = mesh.indices[t + 2] ?? 0;
    indices[t + 2] = mesh.indices[t + 1] ?? 0;
  }
  return { positions: mesh.positions, indices, faceIds: mesh.faceIds };
}

/** Gives each mesh's face keys a range of its own, so meshes of instances that share a definition stay distinguishable. */
export function rekeyMeshes(
  inputs: readonly { readonly mesh: TriangleMesh; readonly provenance: MeshProvenance }[],
): { meshes: TriangleMesh[]; provenance: Map<number, FaceProvenance> } {
  const provenance = new Map<number, FaceProvenance>();
  let nextKey = 1;
  const meshes = inputs.map(({ mesh, provenance: source }) => {
    const keys = new Map<number, number>();
    const faceIds = new Uint32Array(mesh.faceIds.length);
    mesh.faceIds.forEach((id, index) => {
      let key = keys.get(id);
      if (key === undefined) {
        key = nextKey++;
        keys.set(id, key);
        const info = source.get(id);
        if (info) provenance.set(key, info);
      }
      faceIds[index] = key;
    });
    return { positions: mesh.positions, indices: mesh.indices, faceIds };
  });
  return { meshes, provenance };
}

function pointAt(positions: Float64Array, index: number): Vec3 {
  return vec3(positions[index * 3] ?? 0, positions[index * 3 + 1] ?? 0, positions[index * 3 + 2] ?? 0);
}

/** Merges vertices closer than the length tolerance. Returns the representative index of every vertex. */
function weldVertices(points: readonly Vec3[]): number[] {
  const cells = new Map<string, number[]>();
  const cellKey = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`;
  return points.map((p, index) => {
    const cx = Math.floor(p.x / WELD_GRID_CELL_SIZE);
    const cy = Math.floor(p.y / WELD_GRID_CELL_SIZE);
    const cz = Math.floor(p.z / WELD_GRID_CELL_SIZE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const other of cells.get(cellKey(cx + dx, cy + dy, cz + dz)) ?? []) {
            const q = points[other];
            if (q && length(sub(p, q)) <= EPS_LEN) return other;
          }
        }
      }
    }
    const key = cellKey(cx, cy, cz);
    const list = cells.get(key);
    if (list) list.push(index);
    else cells.set(key, [index]);
    return index;
  });
}

/**
 * The point nearest `start` that best satisfies all `planes` (least squares with a tiny pull toward `start`, so a
 * vertex on one plane is projected onto it, on two planes onto their line, and on three or more to their corner).
 */
function snapToPlanes(start: Vec3, planes: readonly Plane[]): Vec3 {
  if (planes.length === 0) return start;
  const pull = 1e-12;
  const m = [pull, 0, 0, 0, pull, 0, 0, 0, pull];
  const rhs = [pull * start.x, pull * start.y, pull * start.z];
  for (const { normal: n, offset } of planes) {
    const components = [n.x, n.y, n.z];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++)
        m[r * 3 + c] = (m[r * 3 + c] ?? 0) + (components[r] ?? 0) * (components[c] ?? 0);
      rhs[r] = (rhs[r] ?? 0) + (components[r] ?? 0) * offset;
    }
  }
  const at = (r: number, c: number): number => m[r * 3 + c] ?? 0;
  const det =
    at(0, 0) * (at(1, 1) * at(2, 2) - at(1, 2) * at(2, 1)) -
    at(0, 1) * (at(1, 0) * at(2, 2) - at(1, 2) * at(2, 0)) +
    at(0, 2) * (at(1, 0) * at(2, 1) - at(1, 1) * at(2, 0));
  if (!Number.isFinite(det) || det === 0) return start;
  const solve = (column: number): number => {
    const col = (r: number, c: number): number => (c === column ? (rhs[r] ?? 0) : at(r, c));
    return (
      (col(0, 0) * (col(1, 1) * col(2, 2) - col(1, 2) * col(2, 1)) -
        col(0, 1) * (col(1, 0) * col(2, 2) - col(1, 2) * col(2, 0)) +
        col(0, 2) * (col(1, 0) * col(2, 1) - col(1, 1) * col(2, 0))) /
      det
    );
  };
  const snapped = vec3(solve(0), solve(1), solve(2));
  return length(sub(snapped, start)) <= EPS_MESH_SNAP ? snapped : start;
}

class UnionFind {
  readonly #parent: number[];

  constructor(size: number) {
    this.#parent = Array.from({ length: size }, (_, i) => i);
  }

  find(i: number): number {
    let root = i;
    while ((this.#parent[root] ?? root) !== root) root = this.#parent[root] ?? root;
    let current = i;
    while (current !== root) {
      const next = this.#parent[current] ?? root;
      this.#parent[current] = root;
      current = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.#parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

interface MeshTriangle {
  readonly corners: readonly [number, number, number];
  readonly key: number;
  readonly normal: Vec3;
  /** The source face plane when the triangle lies on it, else the triangle's own plane. */
  plane: Plane;
  readonly fromSource: boolean;
}

const sameAttributes = (a: FaceAttributes, b: FaceAttributes): boolean =>
  a.frontMaterialId === b.frontMaterialId &&
  a.backMaterialId === b.backMaterialId &&
  a.tagId === b.tagId &&
  a.hidden === b.hidden;

/**
 * Rebuilds faces from a triangle mesh. Adjacent coplanar triangles with the same attributes are regrouped into one
 * polygon (the edges between them are dropped), vertices are snapped back onto their source face planes, and each
 * polygon is inserted with the usual sticky-geometry rules, restoring the source face's materials.
 * GEOMETRY.md ("Algorithm: mesh round trip").
 */
export function insertTriangleMesh(
  doc: ModelDocument,
  context: DefinitionId,
  mesh: TriangleMesh,
  provenance: MeshProvenance,
): InsertedMesh {
  const vertexCount = Math.floor(mesh.positions.length / 3);
  const raw = Array.from({ length: vertexCount }, (_, i) => pointAt(mesh.positions, i));
  const representative = weldVertices(raw);

  // Triangles with welded corners; degenerate ones are dropped.
  const triangles: MeshTriangle[] = [];
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const corners = [0, 1, 2].map((k) => representative[mesh.indices[t + k] ?? 0] ?? 0) as [
      number,
      number,
      number,
    ];
    const [a, b, c] = corners;
    if (a === b || b === c || a === c) continue;
    const pa = raw[a] ?? vec3(0, 0, 0);
    const n = cross(sub(raw[b] ?? pa, pa), sub(raw[c] ?? pa, pa));
    if (length(n) / 2 <= EPS_AREA) continue;
    const normal = normalize(n) ?? vec3(0, 0, 1);
    const key = mesh.faceIds[t / 3] ?? 0;
    const source = provenance.get(key)?.plane;
    const onSource =
      source !== undefined &&
      corners.every((corner) => Math.abs(signedDistanceToPlane(source, raw[corner] ?? pa)) <= EPS_MESH_SNAP);
    triangles.push({
      corners,
      key,
      normal,
      plane: onSource ? source : planeFromPointNormal(pa, normal),
      fromSource: onSource,
    });
  }

  // Snap each vertex onto the source planes of the triangles around it.
  const planesAt = new Map<number, Plane[]>();
  for (const triangle of triangles) {
    if (!triangle.fromSource) continue;
    for (const corner of triangle.corners) {
      const list = planesAt.get(corner) ?? [];
      if (!list.some((plane) => planesCoincide(plane, triangle.plane))) list.push(triangle.plane);
      planesAt.set(corner, list);
    }
  }
  const position = raw.map((p, i) => (representative[i] === i ? snapToPlanes(p, planesAt.get(i) ?? []) : p));

  // Group adjacent coplanar triangles that face the same way and share attributes.
  const attributesOf = (triangle: MeshTriangle): FaceAttributes =>
    provenance.get(triangle.key)?.attributes ?? DEFAULT_FACE_ATTRIBUTES;
  const edgeKey = (a: number, b: number): string =>
    a < b ? `${String(a)}:${String(b)}` : `${String(b)}:${String(a)}`;
  const trianglesByEdge = new Map<string, number[]>();
  triangles.forEach((triangle, index) => {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(triangle.corners[k] ?? 0, triangle.corners[(k + 1) % 3] ?? 0);
      const list = trianglesByEdge.get(key);
      if (list) list.push(index);
      else trianglesByEdge.set(key, [index]);
    }
  });
  const groups = new UnionFind(triangles.length);
  const coplanar = (first: MeshTriangle, second: MeshTriangle): boolean => {
    if (dot(first.normal, second.normal) <= 0) return false;
    if (first.fromSource && second.fromSource && first.key === second.key) return true;
    return (
      second.corners.every(
        (corner) =>
          Math.abs(signedDistanceToPlane(first.plane, position[corner] ?? vec3(0, 0, 0))) <= EPS_LEN,
      ) &&
      first.corners.every(
        (corner) =>
          Math.abs(signedDistanceToPlane(second.plane, position[corner] ?? vec3(0, 0, 0))) <= EPS_LEN,
      )
    );
  };
  for (const list of trianglesByEdge.values()) {
    const [i, j] = list;
    if (list.length !== 2 || i === undefined || j === undefined) continue;
    const first = triangles[i];
    const second = triangles[j];
    if (
      first &&
      second &&
      sameAttributes(attributesOf(first), attributesOf(second)) &&
      coplanar(first, second)
    ) {
      groups.union(i, j);
    }
  }
  const members = new Map<number, number[]>();
  triangles.forEach((_, index) => {
    const root = groups.find(index);
    const list = members.get(root);
    if (list) list.push(index);
    else members.set(root, [index]);
  });

  // Boundary edges of each group, and how many boundary edges meet at each vertex over all groups.
  const boundaryByGroup = new Map<number, [number, number][]>();
  const featureEdges = new Set<string>();
  for (const [root, list] of members) {
    const directed = new Set<string>();
    for (const index of list) {
      const { corners } = triangles[index] ?? { corners: [0, 0, 0] };
      for (let k = 0; k < 3; k++) directed.add(`${String(corners[k])}>${String(corners[(k + 1) % 3])}`);
    }
    const boundary: [number, number][] = [];
    for (const index of list) {
      const { corners } = triangles[index] ?? { corners: [0, 0, 0] };
      for (let k = 0; k < 3; k++) {
        const a = corners[k] ?? 0;
        const b = corners[(k + 1) % 3] ?? 0;
        if (directed.has(`${String(b)}>${String(a)}`)) continue;
        boundary.push([a, b]);
        featureEdges.add(edgeKey(a, b));
      }
    }
    boundaryByGroup.set(root, boundary);
  }
  const featureNeighbours = new Map<number, Set<number>>();
  for (const key of featureEdges) {
    const [a, b] = key.split(':').map(Number) as [number, number];
    featureNeighbours.set(a, (featureNeighbours.get(a) ?? new Set()).add(b));
    featureNeighbours.set(b, (featureNeighbours.get(b) ?? new Set()).add(a));
  }
  /** A vertex in the middle of a straight run of boundary, which no face needs as a corner. */
  const removable = (vertex: number): boolean => {
    const neighbours = featureNeighbours.get(vertex);
    if (neighbours?.size !== 2) return false;
    const [a, b] = [...neighbours];
    const p = position[vertex];
    const pa = a === undefined ? undefined : position[a];
    const pb = b === undefined ? undefined : position[b];
    return (
      p !== undefined && pa !== undefined && pb !== undefined && distancePointToLine(p, pa, pb) <= EPS_LEN
    );
  };

  interface GroupPolygon {
    readonly outer: Vec3[];
    readonly inners: Vec3[][];
    readonly normal: Vec3;
    readonly plane: Plane;
    readonly attributes: FaceAttributes;
    readonly loops: number[][];
  }
  const polygons: GroupPolygon[] = [];
  for (const [root, list] of [...members].sort((x, y) => x[0] - y[0])) {
    const first = triangles[list[0] ?? -1];
    if (!first) continue;
    let weighted = vec3(0, 0, 0);
    for (const index of list) {
      const triangle = triangles[index];
      if (!triangle) continue;
      const [a, b, c] = triangle.corners.map((corner) => position[corner] ?? vec3(0, 0, 0)) as [
        Vec3,
        Vec3,
        Vec3,
      ];
      weighted = add(weighted, cross(sub(b, a), sub(c, a)));
    }
    let normal = normalize(weighted) ?? first.normal;
    let plane: Plane;
    if (first.fromSource) {
      normal = dot(first.plane.normal, normal) >= 0 ? first.plane.normal : scale(first.plane.normal, -1);
      plane = {
        normal,
        offset: dot(normal, first.plane.normal) > 0 ? first.plane.offset : -first.plane.offset,
      };
    } else {
      plane = planeFromPointNormal(position[first.corners[0]] ?? vec3(0, 0, 0), normal);
    }

    // Trace boundary loops.
    const outgoing = new Map<number, number[]>();
    for (const [a, b] of boundaryByGroup.get(root) ?? []) {
      const next = outgoing.get(a);
      if (next) next.push(b);
      else outgoing.set(a, [b]);
    }
    const loops: number[][] = [];
    for (const [start] of outgoing) {
      while ((outgoing.get(start)?.length ?? 0) > 0) {
        const loop: number[] = [start];
        let current = outgoing.get(start)?.pop() ?? start;
        let guard = 0;
        while (current !== start && guard++ <= featureEdges.size) {
          loop.push(current);
          const next = outgoing.get(current)?.pop();
          if (next === undefined) break;
          current = next;
        }
        if (current === start) {
          const kept = loop.filter((vertex) => !removable(vertex));
          if (kept.length >= 3) loops.push(kept);
        }
      }
    }

    const basis = planeBasis(normal);
    const rings = loops.map((loop) =>
      loop.map((vertex): Point2 => projectTo2D(basis, position[vertex] ?? vec3(0, 0, 0))),
    );
    const outers: number[] = [];
    const holes: number[] = [];
    rings.forEach((ring, index) => {
      const area = signedArea(ring);
      if (area > EPS_AREA) outers.push(index);
      else if (area < -EPS_AREA) holes.push(index);
    });
    const holesOf = new Map<number, number[]>(outers.map((index) => [index, []]));
    for (const hole of holes) {
      const ring = rings[hole] ?? [];
      let container: number | undefined;
      let containerArea = Infinity;
      for (const outer of outers) {
        const outerRing = rings[outer] ?? [];
        const area = signedArea(outerRing);
        if (area >= containerArea) continue;
        if (ring.some((point) => classifyPointInRing(point, outerRing) === 'inside')) {
          container = outer;
          containerArea = area;
        }
      }
      if (container !== undefined) holesOf.get(container)?.push(hole);
    }
    const attributes = attributesOf(first);
    for (const outer of outers) {
      const loopIndices = [outer, ...(holesOf.get(outer) ?? [])];
      const toPoints = (index: number): Vec3[] =>
        (loops[index] ?? []).map((vertex) => position[vertex] ?? vec3(0, 0, 0));
      polygons.push({
        outer: toPoints(outer),
        inners: (holesOf.get(outer) ?? []).map(toPoints),
        normal,
        plane,
        attributes,
        loops: loopIndices.map((index) => loops[index] ?? []),
      });
    }
  }

  return doc.transact('Insert mesh', () => {
    const store = doc.store(context);
    const segments: SegmentInput[] = [];
    const segmentIndex = new Map<string, number>();
    const segmentOf = (a: number, b: number): number => {
      const key = edgeKey(a, b);
      let index = segmentIndex.get(key);
      if (index === undefined) {
        index = segments.push({ a: position[a] ?? vec3(0, 0, 0), b: position[b] ?? vec3(0, 0, 0) }) - 1;
        segmentIndex.set(key, index);
      }
      return index;
    };
    const polygonSegments = polygons.map((polygon) =>
      polygon.loops.flatMap((loop) =>
        loop.map((vertex, i) => segmentOf(vertex, loop[(i + 1) % loop.length] ?? vertex)),
      ),
    );
    const inserted = insertSegments(doc, context, segments, { autoFace: false });
    const faces = new Set<FaceId>();
    polygons.forEach((polygon, index) => {
      const covering = settleRegion(doc, context, {
        plane: polygon.plane,
        seeds: (polygonSegments[index] ?? []).flatMap((segment) => inserted.segmentEdges[segment] ?? []),
        outer: polygon.outer,
        inners: polygon.inners,
        normal: polygon.normal,
        attributes: polygon.attributes,
        rule: 'merge',
      });
      for (const faceId of covering) faces.add(faceId);
    });
    return {
      faces: [...faces].filter((id) => store.face(id) !== undefined).sort(byId),
      edges: [...new Set(inserted.segmentEdges.flat())]
        .filter((id) => store.edge(id) !== undefined)
        .sort(byId),
    };
  });
}
