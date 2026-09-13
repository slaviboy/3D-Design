import { describe, expect, it } from 'vitest';
import { KernelError } from '../../../src/kernel/errors';
import { vec3 } from '../../../src/kernel/math/vec3';
import { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import { addVertex } from '../../../src/kernel/model/mutations';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { faceArea } from '../../../src/kernel/ops/planar/regions';
import { insertTriangleMesh, type TriangleMesh } from '../../../src/kernel/ops/solids/mesh';
import { draw, expectValid } from '../helpers';

/** An n × n height field of 10 cm cells where no two neighbouring triangles are coplanar. */
function heightField(n: number): TriangleMesh {
  const side = n + 1;
  const positions = new Float64Array(side * side * 3);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const k = (j * side + i) * 3;
      positions[k] = i * 0.1;
      positions[k + 1] = j * 0.1;
      positions[k + 2] = 0.3 * Math.sin(i * 0.37) * Math.cos(j * 0.23) + 0.0007 * i * j;
    }
  }
  const indices = new Uint32Array(n * n * 6);
  let t = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i;
      indices.set([a, a + 1, a + side + 1, a, a + side + 1, a + side], t);
      t += 6;
    }
  }
  return { positions, indices, faceIds: new Uint32Array(n * n * 2).map((_, i) => i + 1) };
}

function faceAreas(doc: ModelDocument): number[] {
  const store = doc.rootStore;
  return [...store.faces()].map((face) => faceArea(store, face.id)).sort((a, b) => a - b);
}

describe('transaction savepoints', () => {
  it('revert later changes and keep earlier ones, inside the same transaction', () => {
    const doc = new ModelDocument();
    doc.transact('Build', () => {
      addVertex(doc, doc.rootDefinitionId, vec3(0, 0, 0));
      const mark = doc.savepoint();
      addVertex(doc, doc.rootDefinitionId, vec3(1, 0, 0));
      addVertex(doc, doc.rootDefinitionId, vec3(2, 0, 0));
      doc.revertToSavepoint(mark);
    });
    expect(doc.rootStore.vertexCount).toBe(1);
    doc.undo();
    expect(doc.rootStore.vertexCount).toBe(0);
    expect(doc.canUndo).toBe(false);
  });

  it('need an active transaction and a savepoint from it', () => {
    const doc = new ModelDocument();
    expect(() => doc.savepoint()).toThrow(KernelError);
    expect(() => {
      doc.revertToSavepoint(0);
    }).toThrow(KernelError);
    doc.transact('Build', () => {
      addVertex(doc, doc.rootDefinitionId, vec3(0, 0, 0));
      expect(() => {
        doc.revertToSavepoint(5);
      }).toThrow(KernelError);
    });
  });
});

describe('inserting a triangle mesh into an empty context', () => {
  it('builds the same faces as sticky insertion, and undoes to the same document', () => {
    const mesh = heightField(12);

    const direct = new ModelDocument();
    const before = hashDocument(direct);
    const result = insertTriangleMesh(direct, direct.rootDefinitionId, mesh, new Map());
    expectValid(direct);

    // A far-away edge makes the context non-empty, which forces the sticky-geometry path as a reference.
    const sticky = new ModelDocument();
    draw(sticky, [{ a: vec3(100, 100, 0), b: vec3(101, 100, 0) }]);
    insertTriangleMesh(sticky, sticky.rootDefinitionId, mesh, new Map());
    expectValid(sticky);

    expect(result.faces).toHaveLength(12 * 12 * 2);
    expect(direct.rootStore.faceCount).toBe(sticky.rootStore.faceCount);
    expect(direct.rootStore.vertexCount).toBe(sticky.rootStore.vertexCount - 2);
    expect(direct.rootStore.edgeCount).toBe(sticky.rootStore.edgeCount - 1);
    const areas = faceAreas(direct);
    faceAreas(sticky).forEach((area, index) => {
      expect(areas[index]).toBeCloseTo(area, 9);
    });
    for (const face of direct.rootStore.faces()) {
      expect(direct.rootStore.getFacePlane(face.id).normal.z).toBeGreaterThan(0);
    }

    direct.undo();
    expect(hashDocument(direct)).toBe(before);
  });

  it('falls back to sticky insertion when the mesh intersects itself', () => {
    // Two triangles that cross through each other: their faces must be split where they meet.
    const positions = new Float64Array([0, 0, 0, 2, 0, 0, 1, 2, 0, 1, 1, -1, 1, 1, 1, 1, -1, 0.5]);
    const mesh: TriangleMesh = {
      positions,
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      faceIds: new Uint32Array([1, 2]),
    };
    const doc = new ModelDocument();
    const before = hashDocument(doc);
    const result = insertTriangleMesh(doc, doc.rootDefinitionId, mesh, new Map());
    expectValid(doc);
    expect(result.faces.length).toBeGreaterThanOrEqual(2);
    doc.undo();
    expect(hashDocument(doc)).toBe(before);
  });
});
