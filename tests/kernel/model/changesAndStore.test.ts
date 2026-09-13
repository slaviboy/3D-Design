import { describe, expect, it } from 'vitest';
import { KernelError } from '../../../src/kernel/errors';
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
} from '../../../src/kernel/ids';
import { IdAllocator } from '../../../src/kernel/ids';
import { IDENTITY, translation } from '../../../src/kernel/math/mat4';
import { vec3 } from '../../../src/kernel/math/vec3';
import { changeContext, invertChange, type Change } from '../../../src/kernel/model/changes';
import { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import {
  DEFAULT_EDGE_ATTRIBUTES,
  DEFAULT_FACE_ATTRIBUTES,
  DEFAULT_GUIDE_ATTRIBUTES,
  DEFAULT_INSTANCE_ATTRIBUTES,
  type GuideData,
} from '../../../src/kernel/model/types';

const ROOT = 1 as DefinitionId;
const V = (id: number): VertexId => id as VertexId;
const E = (id: number): EdgeId => id as EdgeId;
const G = (id: number): GuideId => id as GuideId;

const GUIDE_LINE: GuideData = {
  id: G(11),
  geometry: { kind: 'line', point: vec3(0, 0, 0), direction: vec3(1, 0, 0) },
  attributes: DEFAULT_GUIDE_ATTRIBUTES,
};

/** One representative change of every kind. */
const SAMPLE_CHANGES: Change[] = [
  { kind: 'vertex.add', context: ROOT, data: { id: V(2), position: vec3(0, 0, 0) } },
  { kind: 'vertex.remove', context: ROOT, data: { id: V(2), position: vec3(0, 0, 0) } },
  { kind: 'vertex.move', context: ROOT, id: V(2), from: vec3(0, 0, 0), to: vec3(1, 0, 0) },
  {
    kind: 'edge.add',
    context: ROOT,
    data: { id: E(3), v0: V(2), v1: V(4), attributes: DEFAULT_EDGE_ATTRIBUTES },
  },
  {
    kind: 'edge.remove',
    context: ROOT,
    data: { id: E(3), v0: V(2), v1: V(4), attributes: DEFAULT_EDGE_ATTRIBUTES },
  },
  {
    kind: 'edge.attributes',
    context: ROOT,
    id: E(3),
    from: DEFAULT_EDGE_ATTRIBUTES,
    to: { ...DEFAULT_EDGE_ATTRIBUTES, soft: true },
  },
  {
    kind: 'face.add',
    context: ROOT,
    data: { id: 5 as FaceId, outer: [], inners: [], attributes: DEFAULT_FACE_ATTRIBUTES },
  },
  {
    kind: 'face.remove',
    context: ROOT,
    data: { id: 5 as FaceId, outer: [], inners: [], attributes: DEFAULT_FACE_ATTRIBUTES },
  },
  {
    kind: 'face.loops',
    context: ROOT,
    id: 5 as FaceId,
    from: { outer: [], inners: [] },
    to: { outer: [{ edge: E(3), reversed: true }], inners: [] },
  },
  {
    kind: 'face.attributes',
    context: ROOT,
    id: 5 as FaceId,
    from: DEFAULT_FACE_ATTRIBUTES,
    to: { ...DEFAULT_FACE_ATTRIBUTES, hidden: true },
  },
  {
    kind: 'curve.add',
    context: ROOT,
    data: { id: 6 as CurveId, params: { kind: 'polyline' }, edges: [E(3)] },
  },
  {
    kind: 'curve.remove',
    context: ROOT,
    data: { id: 6 as CurveId, params: { kind: 'polyline' }, edges: [E(3)] },
  },
  { kind: 'curve.edges', context: ROOT, id: 6 as CurveId, from: [E(3)], to: [] },
  {
    kind: 'curve.params',
    context: ROOT,
    id: 6 as CurveId,
    from: { kind: 'polyline' },
    to: {
      kind: 'circle',
      center: vec3(0, 0, 0),
      normal: vec3(0, 0, 1),
      xAxis: vec3(1, 0, 0),
      radius: 1,
      segments: 8,
    },
  },
  {
    kind: 'instance.add',
    context: ROOT,
    data: {
      id: 7 as InstanceId,
      definitionId: 8 as DefinitionId,
      transform: IDENTITY,
      attributes: DEFAULT_INSTANCE_ATTRIBUTES,
    },
  },
  {
    kind: 'instance.remove',
    context: ROOT,
    data: {
      id: 7 as InstanceId,
      definitionId: 8 as DefinitionId,
      transform: IDENTITY,
      attributes: DEFAULT_INSTANCE_ATTRIBUTES,
    },
  },
  {
    kind: 'instance.transform',
    context: ROOT,
    id: 7 as InstanceId,
    from: IDENTITY,
    to: translation(vec3(1, 2, 3)),
  },
  {
    kind: 'instance.attributes',
    context: ROOT,
    id: 7 as InstanceId,
    from: DEFAULT_INSTANCE_ATTRIBUTES,
    to: { ...DEFAULT_INSTANCE_ATTRIBUTES, locked: true },
  },
  { kind: 'guide.add', context: ROOT, data: GUIDE_LINE },
  { kind: 'guide.remove', context: ROOT, data: GUIDE_LINE },
  {
    kind: 'guide.attributes',
    context: ROOT,
    id: G(11),
    from: DEFAULT_GUIDE_ATTRIBUTES,
    to: { ...DEFAULT_GUIDE_ATTRIBUTES, hidden: true },
  },
  { kind: 'definition.add', data: { id: 8 as DefinitionId, name: 'Part', isGroup: false } },
  { kind: 'definition.remove', data: { id: 8 as DefinitionId, name: 'Part', isGroup: false } },
  {
    kind: 'definition.attributes',
    id: 8 as DefinitionId,
    from: { name: 'Part', isGroup: false },
    to: { name: 'Bolt', isGroup: false },
  },
  {
    kind: 'material.add',
    data: { id: 9 as MaterialId, name: 'Oak', color: { r: 1, g: 1, b: 1 }, opacity: 1 },
  },
  {
    kind: 'material.remove',
    data: { id: 9 as MaterialId, name: 'Oak', color: { r: 1, g: 1, b: 1 }, opacity: 1 },
  },
  {
    kind: 'material.attributes',
    id: 9 as MaterialId,
    from: { name: 'Oak', color: { r: 1, g: 1, b: 1 }, opacity: 1 },
    to: { name: 'Oak', color: { r: 1, g: 1, b: 1 }, opacity: 0.5 },
  },
  { kind: 'tag.add', data: { id: 10 as TagId, name: 'Walls', visible: true, color: { r: 1, g: 0, b: 0 } } },
  {
    kind: 'tag.remove',
    data: { id: 10 as TagId, name: 'Walls', visible: true, color: { r: 1, g: 0, b: 0 } },
  },
  {
    kind: 'tag.attributes',
    id: 10 as TagId,
    from: { name: 'Walls', visible: true, color: { r: 1, g: 0, b: 0 } },
    to: { name: 'Walls', visible: false, color: { r: 1, g: 0, b: 0 } },
  },
];

describe('changes', () => {
  it.each(SAMPLE_CHANGES.map((change) => [change.kind, change] as const))(
    'inverting %s twice restores it',
    (_kind, change) => {
      const inverse = invertChange(change);
      expect(inverse).not.toEqual(change);
      expect(invertChange(inverse)).toEqual(change);
    },
  );

  it('pairs additions with removals and swaps update values', () => {
    expect(invertChange(SAMPLE_CHANGES[0] as Change).kind).toBe('vertex.remove');
    const move = invertChange(SAMPLE_CHANGES[2] as Change);
    expect(move).toMatchObject({ kind: 'vertex.move', from: vec3(1, 0, 0), to: vec3(0, 0, 0) });
  });

  it('reports the definition a change belongs to', () => {
    expect(changeContext(SAMPLE_CHANGES[0] as Change)).toBe(ROOT);
    expect(
      changeContext({
        kind: 'tag.add',
        data: { id: 10 as TagId, name: 'x', visible: true, color: { r: 1, g: 0, b: 0 } },
      }),
    ).toBeNull();
  });
});

function freshDocument(): ModelDocument {
  return new ModelDocument({}, { rootDefinitionId: ROOT, nextId: 1000 });
}

function expectKernelError(changes: readonly Change[], code: KernelError['code']): void {
  const doc = freshDocument();
  let caught: unknown;
  try {
    doc.applyWithoutHistory(changes);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(KernelError);
  expect((caught as KernelError).code).toBe(code);
}

const addVertex = (id: number, x = 0): Change => ({
  kind: 'vertex.add',
  context: ROOT,
  data: { id: V(id), position: vec3(x, 0, 0) },
});
const addEdge = (id: number, v0: number, v1: number): Change => ({
  kind: 'edge.add',
  context: ROOT,
  data: { id: E(id), v0: V(v0), v1: V(v1), attributes: DEFAULT_EDGE_ATTRIBUTES },
});

describe('entity store and document preconditions', () => {
  it.each<[string, Change[], KernelError['code']]>([
    ['duplicate vertex', [addVertex(2), addVertex(2)], 'duplicate-entity'],
    [
      'duplicate edge id',
      [addVertex(2), addVertex(3, 1), addEdge(4, 2, 3), addEdge(4, 2, 3)],
      'duplicate-entity',
    ],
    ['edge to missing vertex', [addVertex(2), addEdge(4, 2, 99)], 'missing-entity'],
    [
      'removing a used vertex',
      [
        addVertex(2),
        addVertex(3, 1),
        addEdge(4, 2, 3),
        { kind: 'vertex.remove', context: ROOT, data: { id: V(2), position: vec3(0, 0, 0) } },
      ],
      'invalid-operation',
    ],
    [
      'removing an edge that bounds a face',
      [
        addVertex(2),
        addVertex(3, 1),
        addEdge(4, 2, 3),
        {
          kind: 'face.add',
          context: ROOT,
          data: {
            id: 5 as FaceId,
            outer: [{ edge: E(4), reversed: false }],
            inners: [],
            attributes: DEFAULT_FACE_ATTRIBUTES,
          },
        },
        {
          kind: 'edge.remove',
          context: ROOT,
          data: { id: E(4), v0: V(2), v1: V(3), attributes: DEFAULT_EDGE_ATTRIBUTES },
        },
      ],
      'invalid-operation',
    ],
    [
      'removing an edge that belongs to a curve',
      [
        addVertex(2),
        addVertex(3, 1),
        addEdge(4, 2, 3),
        {
          kind: 'curve.add',
          context: ROOT,
          data: { id: 6 as CurveId, params: { kind: 'polyline' }, edges: [E(4)] },
        },
        {
          kind: 'edge.remove',
          context: ROOT,
          data: { id: E(4), v0: V(2), v1: V(3), attributes: DEFAULT_EDGE_ATTRIBUTES },
        },
      ],
      'invalid-operation',
    ],
    [
      'an edge in two curves',
      [
        addVertex(2),
        addVertex(3, 1),
        addEdge(4, 2, 3),
        {
          kind: 'curve.add',
          context: ROOT,
          data: { id: 6 as CurveId, params: { kind: 'polyline' }, edges: [E(4)] },
        },
        {
          kind: 'curve.add',
          context: ROOT,
          data: { id: 7 as CurveId, params: { kind: 'polyline' }, edges: [E(4)] },
        },
      ],
      'invalid-operation',
    ],
    [
      'face with a missing edge',
      [
        {
          kind: 'face.add',
          context: ROOT,
          data: {
            id: 5 as FaceId,
            outer: [{ edge: E(4), reversed: false }],
            inners: [],
            attributes: DEFAULT_FACE_ATTRIBUTES,
          },
        },
      ],
      'missing-entity',
    ],
    [
      'loops of a missing face',
      [
        {
          kind: 'face.loops',
          context: ROOT,
          id: 5 as FaceId,
          from: { outer: [], inners: [] },
          to: { outer: [], inners: [] },
        },
      ],
      'missing-entity',
    ],
    [
      'edges of a missing curve',
      [{ kind: 'curve.edges', context: ROOT, id: 6 as CurveId, from: [], to: [] }],
      'missing-entity',
    ],
    [
      'params of a missing curve',
      [
        {
          kind: 'curve.params',
          context: ROOT,
          id: 6 as CurveId,
          from: { kind: 'polyline' },
          to: { kind: 'polyline' },
        },
      ],
      'missing-entity',
    ],
    [
      'transform of a missing instance',
      [{ kind: 'instance.transform', context: ROOT, id: 7 as InstanceId, from: IDENTITY, to: IDENTITY }],
      'missing-entity',
    ],
    [
      'attributes of a missing instance',
      [
        {
          kind: 'instance.attributes',
          context: ROOT,
          id: 7 as InstanceId,
          from: DEFAULT_INSTANCE_ATTRIBUTES,
          to: DEFAULT_INSTANCE_ATTRIBUTES,
        },
      ],
      'missing-entity',
    ],
    [
      'removing a missing instance',
      [
        {
          kind: 'instance.remove',
          context: ROOT,
          data: {
            id: 7 as InstanceId,
            definitionId: ROOT,
            transform: IDENTITY,
            attributes: DEFAULT_INSTANCE_ATTRIBUTES,
          },
        },
      ],
      'missing-entity',
    ],
    [
      'a duplicate instance id',
      [
        { kind: 'definition.add', data: { id: 8 as DefinitionId, name: 'Part', isGroup: false } },
        {
          kind: 'instance.add',
          context: ROOT,
          data: {
            id: 7 as InstanceId,
            definitionId: 8 as DefinitionId,
            transform: IDENTITY,
            attributes: DEFAULT_INSTANCE_ATTRIBUTES,
          },
        },
        {
          kind: 'instance.add',
          context: ROOT,
          data: {
            id: 7 as InstanceId,
            definitionId: 8 as DefinitionId,
            transform: IDENTITY,
            attributes: DEFAULT_INSTANCE_ATTRIBUTES,
          },
        },
      ],
      'duplicate-entity',
    ],
    [
      'a duplicate guide id',
      [
        { kind: 'guide.add', context: ROOT, data: GUIDE_LINE },
        { kind: 'guide.add', context: ROOT, data: GUIDE_LINE },
      ],
      'duplicate-entity',
    ],
    [
      'removing a missing guide',
      [{ kind: 'guide.remove', context: ROOT, data: GUIDE_LINE }],
      'missing-entity',
    ],
    [
      'updating a missing guide',
      [
        {
          kind: 'guide.attributes',
          context: ROOT,
          id: G(11),
          from: DEFAULT_GUIDE_ATTRIBUTES,
          to: { ...DEFAULT_GUIDE_ATTRIBUTES, hidden: true },
        },
      ],
      'missing-entity',
    ],
    [
      'a duplicate definition',
      [{ kind: 'definition.add', data: { id: ROOT, name: 'Again', isGroup: false } }],
      'duplicate-entity',
    ],
    [
      'attributes of a missing definition',
      [
        {
          kind: 'definition.attributes',
          id: 8 as DefinitionId,
          from: { name: 'a', isGroup: false },
          to: { name: 'b', isGroup: false },
        },
      ],
      'missing-entity',
    ],
    [
      'a duplicate material',
      [
        {
          kind: 'material.add',
          data: { id: 9 as MaterialId, name: 'Oak', color: { r: 1, g: 1, b: 1 }, opacity: 1 },
        },
        {
          kind: 'material.add',
          data: { id: 9 as MaterialId, name: 'Oak', color: { r: 1, g: 1, b: 1 }, opacity: 1 },
        },
      ],
      'duplicate-entity',
    ],
    [
      'removing a missing material',
      [
        {
          kind: 'material.remove',
          data: { id: 9 as MaterialId, name: 'Oak', color: { r: 1, g: 1, b: 1 }, opacity: 1 },
        },
      ],
      'missing-entity',
    ],
    [
      'updating a missing material',
      [
        {
          kind: 'material.attributes',
          id: 9 as MaterialId,
          from: { name: 'a', color: { r: 1, g: 1, b: 1 }, opacity: 1 },
          to: { name: 'b', color: { r: 1, g: 1, b: 1 }, opacity: 1 },
        },
      ],
      'missing-entity',
    ],
    [
      'a duplicate tag',
      [
        {
          kind: 'tag.add',
          data: { id: 10 as TagId, name: 'Walls', visible: true, color: { r: 1, g: 0, b: 0 } },
        },
        {
          kind: 'tag.add',
          data: { id: 10 as TagId, name: 'Walls', visible: true, color: { r: 1, g: 0, b: 0 } },
        },
      ],
      'duplicate-entity',
    ],
    [
      'removing a missing tag',
      [
        {
          kind: 'tag.remove',
          data: { id: 10 as TagId, name: 'Walls', visible: true, color: { r: 1, g: 0, b: 0 } },
        },
      ],
      'missing-entity',
    ],
    [
      'updating a missing tag',
      [
        {
          kind: 'tag.attributes',
          id: 10 as TagId,
          from: { name: 'a', visible: true, color: { r: 1, g: 0, b: 0 } },
          to: { name: 'b', visible: true, color: { r: 1, g: 0, b: 0 } },
        },
      ],
      'missing-entity',
    ],
    [
      'changing a missing definition store',
      [{ kind: 'vertex.add', context: 42 as DefinitionId, data: { id: V(2), position: vec3(0, 0, 0) } }],
      'missing-entity',
    ],
  ])('rejects %s', (_description, changes, code) => {
    expectKernelError(changes, code);
  });

  it('throws descriptive errors for missing entities and degenerate faces', () => {
    const doc = freshDocument();
    doc.applyWithoutHistory([
      addVertex(2),
      addVertex(3, 1),
      addVertex(4, 2),
      addEdge(5, 2, 3),
      addEdge(6, 3, 4),
      addEdge(7, 4, 2),
      {
        kind: 'face.add',
        context: ROOT,
        data: {
          id: 8 as FaceId,
          outer: [
            { edge: E(5), reversed: false },
            { edge: E(6), reversed: false },
            { edge: E(7), reversed: false },
          ],
          inners: [],
          attributes: DEFAULT_FACE_ATTRIBUTES,
        },
      },
    ]);
    const store = doc.rootStore;
    expect(() => store.getFacePlane(8 as FaceId)).toThrow(
      expect.objectContaining({ code: 'invalid-geometry' }),
    );
    expect(() => store.getVertex(V(99))).toThrow(expect.objectContaining({ code: 'missing-entity' }));
    expect(() => store.getEdge(E(99))).toThrow(KernelError);
    expect(() => store.getFace(99 as FaceId)).toThrow(KernelError);
    expect(() => store.getCurve(99 as CurveId)).toThrow(KernelError);
    expect(() => store.getInstance(99 as InstanceId)).toThrow(KernelError);
    expect(() => store.getGuide(G(99))).toThrow(expect.objectContaining({ code: 'missing-entity' }));
    expect(() => store.otherVertex(E(5), V(4))).toThrow(
      expect.objectContaining({ code: 'invalid-operation' }),
    );
    expect(store.edgeBetween(V(99), V(2))).toBeUndefined();
    expect(store.isEmpty).toBe(false);
  });

  it('validates the id allocator', () => {
    expect(() => new IdAllocator(0)).toThrow();
    const ids = new IdAllocator(5);
    ids.reserveThrough(3);
    expect(ids.allocate()).toBe(5);
    ids.reserveThrough(20);
    expect(ids.next).toBe(21);
  });
});
