import type {
  CurveId,
  DefinitionId,
  EdgeId,
  FaceId,
  GuideId,
  InstanceId,
  MaterialId,
  TagId,
  VertexId,
} from '../ids';
import { isMat4 } from '../math/mat4';
import type { Vec3 } from '../math/vec3';
import { err, ok, type Result } from '../result';
import type { Change } from './changes';
import { ModelDocument, type DocumentOptions } from './ModelDocument';
import type {
  CurveData,
  CurveParams,
  EdgeAttributes,
  EdgeData,
  FaceAttributes,
  FaceData,
  GuideAttributes,
  GuideData,
  GuideGeometry,
  InstanceAttributes,
  InstanceData,
  Loop,
  MaterialData,
  TagData,
  VertexData,
} from './types';
import { validateDocument } from './validate';

export const SNAPSHOT_FORMAT = 'planar-document';
export const SNAPSHOT_VERSION = 1;
const MAX_REPORTED_ERRORS = 10;

export interface DefinitionSnapshot {
  readonly id: DefinitionId;
  readonly name: string;
  readonly isGroup: boolean;
  readonly vertices: readonly VertexData[];
  readonly edges: readonly EdgeData[];
  readonly faces: readonly FaceData[];
  readonly curves: readonly CurveData[];
  readonly instances: readonly InstanceData[];
  readonly guides: readonly GuideData[];
}

/** Plain-JSON form of a document's contents. History is not included. */
export interface DocumentSnapshot {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly version: typeof SNAPSHOT_VERSION;
  readonly nextId: number;
  readonly rootDefinitionId: DefinitionId;
  readonly materials: readonly MaterialData[];
  readonly tags: readonly TagData[];
  readonly definitions: readonly DefinitionSnapshot[];
}

// -------------------------------------------------------------------------------------------------- writing

const vec = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const loopCopy = (loop: Loop): Loop => loop.map((use) => ({ edge: use.edge, reversed: use.reversed }));
const edgeAttributes = (a: EdgeAttributes): EdgeAttributes => ({
  soft: a.soft,
  smooth: a.smooth,
  hidden: a.hidden,
  materialId: a.materialId,
  tagId: a.tagId,
});
const faceAttributes = (a: FaceAttributes): FaceAttributes => ({
  frontMaterialId: a.frontMaterialId,
  backMaterialId: a.backMaterialId,
  tagId: a.tagId,
  hidden: a.hidden,
});
const instanceAttributes = (a: InstanceAttributes): InstanceAttributes => ({
  name: a.name,
  tagId: a.tagId,
  materialId: a.materialId,
  hidden: a.hidden,
  locked: a.locked,
  castShadows: a.castShadows,
  receiveShadows: a.receiveShadows,
});
const guideAttributes = (a: GuideAttributes): GuideAttributes => ({ hidden: a.hidden, tagId: a.tagId });

function guideGeometryCopy(geometry: GuideGeometry): GuideGeometry {
  return geometry.kind === 'line'
    ? { kind: 'line', point: vec(geometry.point), direction: vec(geometry.direction) }
    : { kind: 'point', point: vec(geometry.point) };
}

function curveParamsCopy(params: CurveParams): CurveParams {
  if (params.kind === 'polyline') return { kind: 'polyline' };
  const frame = {
    center: vec(params.center),
    normal: vec(params.normal),
    xAxis: vec(params.xAxis),
    radius: params.radius,
  };
  switch (params.kind) {
    case 'circle':
      return { kind: 'circle', ...frame, segments: params.segments };
    case 'polygon':
      return { kind: 'polygon', ...frame, sides: params.sides };
    case 'arc':
      return {
        kind: 'arc',
        ...frame,
        startAngle: params.startAngle,
        endAngle: params.endAngle,
        segments: params.segments,
      };
  }
}

const byId = <T extends { readonly id: number }>(a: T, b: T): number => a.id - b.id;

/** Canonical snapshot: entities sorted by id, with a fixed key order, so equal documents serialize identically. */
export function createSnapshot(doc: ModelDocument): DocumentSnapshot {
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    nextId: doc.ids.next,
    rootDefinitionId: doc.rootDefinitionId,
    materials: [...doc.materials()].sort(byId).map((m) => ({
      id: m.id,
      name: m.name,
      color: { r: m.color.r, g: m.color.g, b: m.color.b },
      opacity: m.opacity,
    })),
    tags: [...doc.tags()].sort(byId).map((t) => ({ id: t.id, name: t.name, visible: t.visible })),
    definitions: [...doc.definitions()].sort(byId).map((definition) => {
      const store = definition.store;
      return {
        id: definition.id,
        name: definition.attributes.name,
        isGroup: definition.attributes.isGroup,
        vertices: [...store.vertices()].sort(byId).map((v) => ({ id: v.id, position: vec(v.position) })),
        edges: [...store.edges()]
          .sort(byId)
          .map((e) => ({ id: e.id, v0: e.v0, v1: e.v1, attributes: edgeAttributes(e.attributes) })),
        faces: [...store.faces()].sort(byId).map((f) => ({
          id: f.id,
          outer: loopCopy(f.outer),
          inners: f.inners.map(loopCopy),
          attributes: faceAttributes(f.attributes),
        })),
        curves: [...store.curves()]
          .sort(byId)
          .map((c) => ({ id: c.id, params: curveParamsCopy(c.params), edges: [...c.edges] })),
        instances: [...store.instances()].sort(byId).map((i) => ({
          id: i.id,
          definitionId: i.definitionId,
          transform: [...i.transform],
          attributes: instanceAttributes(i.attributes),
        })),
        guides: [...store.guides()].sort(byId).map((g) => ({
          id: g.id,
          geometry: guideGeometryCopy(g.geometry),
          attributes: guideAttributes(g.attributes),
        })),
      };
    }),
  };
}

/**
 * Content hash of a document (history and the id counter are excluded). Two documents with identical contents,
 * including entity ids, have the same hash. Used to check undo/redo and serialization round trips.
 */
export function hashDocument(doc: ModelDocument): string {
  return cyrb53(JSON.stringify({ ...createSnapshot(doc), nextId: 0 }));
}

/** 53-bit non-cryptographic string hash (cyrb53, public domain). */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

// -------------------------------------------------------------------------------------------------- reading

type Json = Record<string, unknown>;

/** Collects structural errors with JSON paths while reading untrusted input. */
class Reader {
  readonly errors: string[] = [];

  fail(path: string, message: string): void {
    if (this.errors.length < MAX_REPORTED_ERRORS) this.errors.push(`${path}: ${message}`);
  }

  record(value: unknown, path: string): Json {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Json;
    this.fail(path, 'expected an object');
    return {};
  }

  list(value: unknown, path: string): unknown[] {
    if (Array.isArray(value)) return value;
    this.fail(path, 'expected an array');
    return [];
  }

  // The reader is the trust boundary where nominal id brands are applied, so the caller chooses the brand.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  id<T extends number>(value: unknown, path: string): T {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value as T;
    this.fail(path, 'expected a positive integer id');
    return 0 as T;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  nullableId<T extends number>(value: unknown, path: string): T | null {
    return value === null ? null : this.id<T>(value, path);
  }

  number(value: unknown, path: string): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    this.fail(path, 'expected a finite number');
    return 0;
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value === 'boolean') return value;
    this.fail(path, 'expected a boolean');
    return false;
  }

  string(value: unknown, path: string): string {
    if (typeof value === 'string') return value;
    this.fail(path, 'expected a string');
    return '';
  }

  vec3(value: unknown, path: string): Vec3 {
    const v = this.record(value, path);
    return {
      x: this.number(v.x, `${path}.x`),
      y: this.number(v.y, `${path}.y`),
      z: this.number(v.z, `${path}.z`),
    };
  }

  loop(value: unknown, path: string): Loop {
    return this.list(value, path).map((entry, index) => {
      const use = this.record(entry, `${path}[${String(index)}]`);
      return {
        edge: this.id<EdgeId>(use.edge, `${path}[${String(index)}].edge`),
        reversed: this.boolean(use.reversed, `${path}[${String(index)}].reversed`),
      };
    });
  }
}

function readCurveParams(r: Reader, value: unknown, path: string): CurveParams {
  const p = r.record(value, path);
  if (p.kind === 'polyline') return { kind: 'polyline' };
  const frame = {
    center: r.vec3(p.center, `${path}.center`),
    normal: r.vec3(p.normal, `${path}.normal`),
    xAxis: r.vec3(p.xAxis, `${path}.xAxis`),
    radius: r.number(p.radius, `${path}.radius`),
  };
  switch (p.kind) {
    case 'circle':
      return { kind: 'circle', ...frame, segments: r.number(p.segments, `${path}.segments`) };
    case 'polygon':
      return { kind: 'polygon', ...frame, sides: r.number(p.sides, `${path}.sides`) };
    case 'arc':
      return {
        kind: 'arc',
        ...frame,
        startAngle: r.number(p.startAngle, `${path}.startAngle`),
        endAngle: r.number(p.endAngle, `${path}.endAngle`),
        segments: r.number(p.segments, `${path}.segments`),
      };
    default:
      r.fail(`${path}.kind`, 'unknown curve kind');
      return { kind: 'polyline' };
  }
}

function readGuideGeometry(r: Reader, value: unknown, path: string): GuideGeometry {
  const g = r.record(value, path);
  const point = r.vec3(g.point, `${path}.point`);
  switch (g.kind) {
    case 'line':
      return { kind: 'line', point, direction: r.vec3(g.direction, `${path}.direction`) };
    case 'point':
      return { kind: 'point', point };
    default:
      r.fail(`${path}.kind`, 'unknown guide kind');
      return { kind: 'point', point };
  }
}

function readDefinition(r: Reader, value: unknown, path: string): DefinitionSnapshot {
  const d = r.record(value, path);
  const at = (key: string, index: number): string => `${path}.${key}[${String(index)}]`;
  return {
    id: r.id<DefinitionId>(d.id, `${path}.id`),
    name: r.string(d.name, `${path}.name`),
    isGroup: r.boolean(d.isGroup, `${path}.isGroup`),
    vertices: r.list(d.vertices, `${path}.vertices`).map((entry, i) => {
      const v = r.record(entry, at('vertices', i));
      return {
        id: r.id<VertexId>(v.id, `${at('vertices', i)}.id`),
        position: r.vec3(v.position, `${at('vertices', i)}.position`),
      };
    }),
    edges: r.list(d.edges, `${path}.edges`).map((entry, i) => {
      const p = at('edges', i);
      const e = r.record(entry, p);
      const a = r.record(e.attributes, `${p}.attributes`);
      return {
        id: r.id<EdgeId>(e.id, `${p}.id`),
        v0: r.id<VertexId>(e.v0, `${p}.v0`),
        v1: r.id<VertexId>(e.v1, `${p}.v1`),
        attributes: {
          soft: r.boolean(a.soft, `${p}.attributes.soft`),
          smooth: r.boolean(a.smooth, `${p}.attributes.smooth`),
          hidden: r.boolean(a.hidden, `${p}.attributes.hidden`),
          materialId: r.nullableId<MaterialId>(a.materialId, `${p}.attributes.materialId`),
          tagId: r.nullableId<TagId>(a.tagId, `${p}.attributes.tagId`),
        },
      };
    }),
    faces: r.list(d.faces, `${path}.faces`).map((entry, i) => {
      const p = at('faces', i);
      const f = r.record(entry, p);
      const a = r.record(f.attributes, `${p}.attributes`);
      return {
        id: r.id<FaceId>(f.id, `${p}.id`),
        outer: r.loop(f.outer, `${p}.outer`),
        inners: r.list(f.inners, `${p}.inners`).map((loop, j) => r.loop(loop, `${p}.inners[${String(j)}]`)),
        attributes: {
          frontMaterialId: r.nullableId<MaterialId>(a.frontMaterialId, `${p}.attributes.frontMaterialId`),
          backMaterialId: r.nullableId<MaterialId>(a.backMaterialId, `${p}.attributes.backMaterialId`),
          tagId: r.nullableId<TagId>(a.tagId, `${p}.attributes.tagId`),
          hidden: r.boolean(a.hidden, `${p}.attributes.hidden`),
        },
      };
    }),
    curves: r.list(d.curves, `${path}.curves`).map((entry, i) => {
      const p = at('curves', i);
      const c = r.record(entry, p);
      return {
        id: r.id<CurveId>(c.id, `${p}.id`),
        params: readCurveParams(r, c.params, `${p}.params`),
        edges: r.list(c.edges, `${p}.edges`).map((edge, j) => r.id<EdgeId>(edge, `${p}.edges[${String(j)}]`)),
      };
    }),
    instances: r.list(d.instances, `${path}.instances`).map((entry, i) => {
      const p = at('instances', i);
      const inst = r.record(entry, p);
      const a = r.record(inst.attributes, `${p}.attributes`);
      if (!isMat4(inst.transform)) r.fail(`${p}.transform`, 'expected 16 finite numbers');
      return {
        id: r.id<InstanceId>(inst.id, `${p}.id`),
        definitionId: r.id<DefinitionId>(inst.definitionId, `${p}.definitionId`),
        transform: isMat4(inst.transform) ? [...inst.transform] : [],
        attributes: {
          name: r.string(a.name, `${p}.attributes.name`),
          tagId: r.nullableId<TagId>(a.tagId, `${p}.attributes.tagId`),
          materialId: r.nullableId<MaterialId>(a.materialId, `${p}.attributes.materialId`),
          hidden: r.boolean(a.hidden, `${p}.attributes.hidden`),
          locked: r.boolean(a.locked, `${p}.attributes.locked`),
          castShadows: r.boolean(a.castShadows, `${p}.attributes.castShadows`),
          receiveShadows: r.boolean(a.receiveShadows, `${p}.attributes.receiveShadows`),
        },
      };
    }),
    // Documents saved before guides existed have no `guides` array.
    guides: (d.guides === undefined ? [] : r.list(d.guides, `${path}.guides`)).map((entry, i) => {
      const p = at('guides', i);
      const g = r.record(entry, p);
      const a = r.record(g.attributes, `${p}.attributes`);
      return {
        id: r.id<GuideId>(g.id, `${p}.id`),
        geometry: readGuideGeometry(r, g.geometry, `${p}.geometry`),
        attributes: {
          hidden: r.boolean(a.hidden, `${p}.attributes.hidden`),
          tagId: r.nullableId<TagId>(a.tagId, `${p}.attributes.tagId`),
        },
      };
    }),
  };
}

/**
 * Builds a document from an untrusted snapshot. Structure, id uniqueness and every kernel invariant are checked,
 * and nothing partial is ever returned.
 */
export function restoreSnapshot(input: unknown, options: DocumentOptions = {}): Result<ModelDocument> {
  const r = new Reader();
  const root = r.record(input, '$');
  if (root.format !== SNAPSHOT_FORMAT) return err('This is not a Planar document');
  if (root.version !== SNAPSHOT_VERSION) {
    return err(`Unsupported document version ${String(root.version)} (expected ${String(SNAPSHOT_VERSION)})`);
  }
  const nextId = r.id(root.nextId, '$.nextId');
  const rootDefinitionId = r.id<DefinitionId>(root.rootDefinitionId, '$.rootDefinitionId');
  const materials: MaterialData[] = r.list(root.materials, '$.materials').map((entry, i) => {
    const p = `$.materials[${String(i)}]`;
    const m = r.record(entry, p);
    const color = r.record(m.color, `${p}.color`);
    return {
      id: r.id<MaterialId>(m.id, `${p}.id`),
      name: r.string(m.name, `${p}.name`),
      color: {
        r: r.number(color.r, `${p}.color.r`),
        g: r.number(color.g, `${p}.color.g`),
        b: r.number(color.b, `${p}.color.b`),
      },
      opacity: r.number(m.opacity, `${p}.opacity`),
    };
  });
  const tags: TagData[] = r.list(root.tags, '$.tags').map((entry, i) => {
    const p = `$.tags[${String(i)}]`;
    const t = r.record(entry, p);
    return {
      id: r.id<TagId>(t.id, `${p}.id`),
      name: r.string(t.name, `${p}.name`),
      visible: r.boolean(t.visible, `${p}.visible`),
    };
  });
  const definitions = r
    .list(root.definitions, '$.definitions')
    .map((entry, i) => readDefinition(r, entry, `$.definitions[${String(i)}]`));
  if (r.errors.length > 0) return err(`Invalid document structure: ${r.errors.join('; ')}`);

  const allIds = [
    ...materials.map((m) => m.id),
    ...tags.map((t) => t.id),
    ...definitions.flatMap((d) => [
      d.id,
      ...d.vertices.map((v) => v.id),
      ...d.edges.map((e) => e.id),
      ...d.faces.map((f) => f.id),
      ...d.curves.map((c) => c.id),
      ...d.instances.map((instance) => instance.id),
      ...d.guides.map((g) => g.id),
    ]),
  ];
  const seen = new Set<number>();
  for (const id of allIds) {
    if (seen.has(id)) return err(`Invalid document: id ${String(id)} is used more than once`);
    if (id >= nextId) return err(`Invalid document: id ${String(id)} is not below nextId`);
    seen.add(id);
  }
  const rootDefinition = definitions.find((d) => d.id === rootDefinitionId);
  if (!rootDefinition) return err('Invalid document: the root definition is missing');

  const doc = new ModelDocument(options, { rootDefinitionId, nextId });
  const changes: Change[] = [
    {
      kind: 'definition.attributes',
      id: rootDefinitionId,
      from: doc.getDefinition(rootDefinitionId).attributes,
      to: { name: rootDefinition.name, isGroup: false },
    },
  ];
  for (const d of definitions) {
    if (d.id !== rootDefinitionId)
      changes.push({ kind: 'definition.add', data: { id: d.id, name: d.name, isGroup: d.isGroup } });
  }
  for (const data of materials) changes.push({ kind: 'material.add', data });
  for (const data of tags) changes.push({ kind: 'tag.add', data });
  for (const d of definitions) {
    const context = d.id;
    for (const data of d.vertices) changes.push({ kind: 'vertex.add', context, data });
    for (const data of d.edges) changes.push({ kind: 'edge.add', context, data });
    for (const data of d.faces) changes.push({ kind: 'face.add', context, data });
    for (const data of d.curves) changes.push({ kind: 'curve.add', context, data });
    for (const data of d.guides) changes.push({ kind: 'guide.add', context, data });
  }
  for (const d of definitions) {
    for (const data of d.instances) changes.push({ kind: 'instance.add', context: d.id, data });
  }

  try {
    doc.applyWithoutHistory(changes);
  } catch (error) {
    return err(`Invalid document: ${error instanceof Error ? error.message : String(error)}`);
  }
  const report = validateDocument(doc);
  if (!report.ok) {
    const details = report.problems
      .slice(0, MAX_REPORTED_ERRORS)
      .map((problem) => `${problem.code} (${problem.message})`)
      .join('; ');
    return err(`Invalid document geometry: ${details}`);
  }
  return ok(doc);
}
