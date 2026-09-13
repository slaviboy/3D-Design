import { describe, expect, it } from 'vitest';
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
import { scaling } from '../../../src/kernel/math/mat4';
import { vec3 } from '../../../src/kernel/math/vec3';
import type { Change } from '../../../src/kernel/model/changes';
import { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import {
  DEFAULT_EDGE_ATTRIBUTES,
  DEFAULT_FACE_ATTRIBUTES,
  DEFAULT_GUIDE_ATTRIBUTES,
  DEFAULT_INSTANCE_ATTRIBUTES,
  type Loop,
} from '../../../src/kernel/model/types';
import { validateDocument } from '../../../src/kernel/model/validate';
import { EPS_LEN } from '../../../src/kernel/tolerance';

/*
 * The validator's job is to catch corruption that correct operations never produce. These tests build corrupt
 * documents directly from raw changes (bypassing the mutation checks) and assert that each problem is reported.
 */

const ROOT = 1 as DefinitionId;

function vertex(id: number, x: number, y: number, z = 0): Change {
  return { kind: 'vertex.add', context: ROOT, data: { id: id as VertexId, position: vec3(x, y, z) } };
}

function edge(id: number, v0: number, v1: number, attributes = DEFAULT_EDGE_ATTRIBUTES): Change {
  return {
    kind: 'edge.add',
    context: ROOT,
    data: { id: id as EdgeId, v0: v0 as VertexId, v1: v1 as VertexId, attributes },
  };
}

function loop(...uses: readonly [number, boolean][]): Loop {
  return uses.map(([id, reversed]) => ({ edge: id as EdgeId, reversed }));
}

function face(
  id: number,
  outer: Loop,
  inners: readonly Loop[] = [],
  attributes = DEFAULT_FACE_ATTRIBUTES,
): Change {
  return { kind: 'face.add', context: ROOT, data: { id: id as FaceId, outer, inners, attributes } };
}

/** Square with corners (x0, y0) and (x1, y1): vertices base+1..base+4, counter-clockwise edges base+11..base+14. */
function square(base: number, x0: number, y0: number, x1: number, y1: number, z = 0): Change[] {
  return [
    vertex(base + 1, x0, y0, z),
    vertex(base + 2, x1, y0, z),
    vertex(base + 3, x1, y1, z),
    vertex(base + 4, x0, y1, z),
    edge(base + 11, base + 1, base + 2),
    edge(base + 12, base + 2, base + 3),
    edge(base + 13, base + 3, base + 4),
    edge(base + 14, base + 4, base + 1),
  ];
}

function ccw(base: number): Loop {
  return loop([base + 11, false], [base + 12, false], [base + 13, false], [base + 14, false]);
}

function cw(base: number): Loop {
  return loop([base + 14, true], [base + 13, true], [base + 12, true], [base + 11, true]);
}

function problemCodes(changes: readonly Change[]): string[] {
  const doc = new ModelDocument({}, { rootDefinitionId: ROOT, nextId: 10_000 });
  doc.applyWithoutHistory(changes);
  return validateDocument(doc).problems.map((problem) => problem.code);
}

describe('validator detects corrupt geometry', () => {
  it('accepts a valid face with a hole', () => {
    expect(
      problemCodes([...square(0, 0, 0, 4, 4), ...square(100, 1, 1, 2, 2), face(900, ccw(0), [cw(100)])]),
    ).toEqual([]);
  });

  it.each<[string, Change[]]>([
    ['duplicate-edge', [vertex(1, 0, 0), vertex(2, 1, 0), edge(10, 1, 2), edge(11, 2, 1)]],
    ['degenerate-edge', [vertex(1, 0, 0), edge(10, 1, 1)]],
    ['short-edge', [vertex(1, 0, 0), vertex(2, EPS_LEN / 2, 0), edge(10, 1, 2)]],
    ['unwelded-vertices', [vertex(1, 0, 0), vertex(2, EPS_LEN / 2, 0)]],
    ['non-finite-vertex', [vertex(1, Number.NaN, 0)]],
    [
      't-junction',
      [vertex(1, 0, 0), vertex(2, 2, 0), vertex(3, 1, 0), vertex(4, 1, 1), edge(10, 1, 2), edge(11, 3, 4)],
    ],
    [
      'edges-intersect',
      [vertex(1, 0, 0), vertex(2, 2, 0), vertex(3, 1, -1), vertex(4, 1, 1), edge(10, 1, 2), edge(11, 3, 4)],
    ],
    ['short-loop', [...square(0, 0, 0, 1, 1), face(900, loop([11, false]))]],
    [
      'edge-repeated-in-face',
      [...square(0, 0, 0, 1, 1), face(900, loop([11, false], [11, false], [12, false]))],
    ],
    ['open-loop', [...square(0, 0, 0, 1, 1), face(900, loop([11, false], [13, false], [12, false]))]],
    [
      'loop-not-simple',
      [
        vertex(1, 0, 0),
        vertex(2, 2, 0),
        vertex(3, 2, 2),
        vertex(4, 0, 2),
        vertex(5, 1, 1),
        edge(10, 1, 5),
        edge(11, 5, 2),
        edge(12, 2, 3),
        edge(13, 3, 5),
        edge(14, 5, 4),
        edge(15, 4, 1),
        face(900, loop([10, false], [11, false], [12, false], [13, false], [14, false], [15, false])),
      ],
    ],
    [
      'degenerate-face',
      [
        vertex(1, 0, 0),
        vertex(2, 1, 0),
        vertex(3, 2, 0),
        edge(10, 1, 2),
        edge(11, 2, 3),
        edge(12, 3, 1),
        face(900, loop([10, false], [11, false], [12, false])),
      ],
    ],
    [
      'non-planar-face',
      [
        vertex(1, 0, 0),
        vertex(2, 1, 0),
        vertex(3, 1, 1, 1),
        vertex(4, 0, 1),
        edge(11, 1, 2),
        edge(12, 2, 3),
        edge(13, 3, 4),
        edge(14, 4, 1),
        face(900, ccw(0)),
      ],
    ],
    [
      'inner-loop-orientation',
      [...square(0, 0, 0, 4, 4), ...square(100, 1, 1, 2, 2), face(900, ccw(0), [ccw(100)])],
    ],
    [
      'hole-outside-face',
      [...square(0, 0, 0, 4, 4), ...square(100, 6, 6, 7, 7), face(900, ccw(0), [cw(100)])],
    ],
    [
      'overlapping-holes',
      [
        ...square(0, 0, 0, 10, 10),
        ...square(100, 1, 1, 3, 3),
        ...square(200, 2, 2, 4, 4),
        face(900, ccw(0), [cw(100), cw(200)]),
      ],
    ],
    ['overlapping-faces', [...square(0, 0, 0, 1, 1), face(900, ccw(0)), face(901, ccw(0))]],
    [
      'missing-reference',
      [
        ...square(0, 0, 0, 1, 1),
        face(900, ccw(0), [], { ...DEFAULT_FACE_ATTRIBUTES, frontMaterialId: 77 as MaterialId }),
      ],
    ],
    [
      'missing-reference',
      [vertex(1, 0, 0), vertex(2, 1, 0), edge(10, 1, 2, { ...DEFAULT_EDGE_ATTRIBUTES, tagId: 5 as never })],
    ],
    [
      'curve-not-chained',
      [
        vertex(1, 0, 0),
        vertex(2, 1, 0),
        vertex(3, 5, 5),
        vertex(4, 6, 5),
        edge(10, 1, 2),
        edge(11, 3, 4),
        {
          kind: 'curve.add',
          context: ROOT,
          data: { id: 50 as CurveId, params: { kind: 'polyline' }, edges: [10 as EdgeId, 11 as EdgeId] },
        },
      ],
    ],
    [
      'edge-in-several-curves',
      [
        vertex(1, 0, 0),
        vertex(2, 1, 0),
        edge(10, 1, 2),
        {
          kind: 'curve.add',
          context: ROOT,
          data: { id: 50 as CurveId, params: { kind: 'polyline' }, edges: [10 as EdgeId, 10 as EdgeId] },
        },
      ],
    ],
    [
      'empty-curve',
      [
        {
          kind: 'curve.add',
          context: ROOT,
          data: { id: 50 as CurveId, params: { kind: 'polyline' }, edges: [] },
        },
      ],
    ],
    [
      'invalid-material',
      [
        {
          kind: 'material.add',
          data: {
            id: 60 as MaterialId,
            name: 'Bad',
            color: { r: 2, g: 0, b: 0 },
            opacity: 1,
            metalness: 0,
            roughness: 1,
            texture: null,
          },
        },
      ],
    ],
    [
      'invalid-guide',
      [
        {
          kind: 'guide.add',
          context: ROOT,
          data: {
            id: 80 as GuideId,
            geometry: { kind: 'line', point: vec3(0, 0, 0), direction: vec3(1, 1, 0) },
            attributes: DEFAULT_GUIDE_ATTRIBUTES,
          },
        },
      ],
    ],
    [
      'invalid-guide',
      [
        {
          kind: 'guide.add',
          context: ROOT,
          data: {
            id: 80 as GuideId,
            geometry: { kind: 'point', point: vec3(Number.NaN, 0, 0) },
            attributes: DEFAULT_GUIDE_ATTRIBUTES,
          },
        },
      ],
    ],
    [
      'missing-reference',
      [
        {
          kind: 'guide.add',
          context: ROOT,
          data: {
            id: 80 as GuideId,
            geometry: { kind: 'point', point: vec3(0, 0, 0) },
            attributes: { ...DEFAULT_GUIDE_ATTRIBUTES, tagId: 5 as TagId },
          },
        },
      ],
    ],
    [
      'invalid-transform',
      [
        { kind: 'definition.add', data: { id: 70 as DefinitionId, name: 'Part', isGroup: false } },
        {
          kind: 'instance.add',
          context: ROOT,
          data: {
            id: 71 as InstanceId,
            definitionId: 70 as DefinitionId,
            transform: scaling(vec3(0, 1, 1)),
            attributes: DEFAULT_INSTANCE_ATTRIBUTES,
          },
        },
      ],
    ],
    [
      'missing-reference',
      [
        { kind: 'definition.add', data: { id: 70 as DefinitionId, name: 'Part', isGroup: false } },
        {
          kind: 'instance.add',
          context: ROOT,
          data: {
            id: 71 as InstanceId,
            definitionId: 70 as DefinitionId,
            transform: scaling(vec3(1, 1, 1)),
            attributes: { ...DEFAULT_INSTANCE_ATTRIBUTES, materialId: 99 as MaterialId },
          },
        },
      ],
    ],
  ])('reports %s', (code, changes) => {
    expect(problemCodes(changes)).toContain(code);
  });

  it('limits validation to the requested definitions', () => {
    const doc = new ModelDocument({}, { rootDefinitionId: ROOT, nextId: 10_000 });
    doc.applyWithoutHistory([
      { kind: 'definition.add', data: { id: 70 as DefinitionId, name: 'Part', isGroup: false } },
      {
        kind: 'vertex.add',
        context: 70 as DefinitionId,
        data: { id: 80 as VertexId, position: vec3(0, 0, 0) },
      },
      {
        kind: 'vertex.add',
        context: 70 as DefinitionId,
        data: { id: 81 as VertexId, position: vec3(0, 0, 0) },
      },
    ]);
    expect(validateDocument(doc, { definitions: [ROOT] }).ok).toBe(true);
    expect(validateDocument(doc, { definitions: [70 as DefinitionId, 999 as DefinitionId] }).ok).toBe(false);
  });
});
