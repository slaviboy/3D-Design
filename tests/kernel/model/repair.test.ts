import { describe, expect, it } from 'vitest';
import type { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import { restoreSnapshotWithRepair } from '../../../src/kernel/model/repair';
import { createSnapshot, hashDocument, restoreSnapshot } from '../../../src/kernel/model/snapshot';
import { DEFAULT_MODEL_AXES } from '../../../src/kernel/model/types';
import { draw, expectValid, newDocument, rectangle } from '../helpers';

type Json = Record<string, unknown>;
interface MutableSnapshot extends Json {
  nextId: number;
  definitions: (Json & { vertices: Json[]; edges: Json[]; faces: (Json & { attributes: Json })[] })[];
}

function twoRectangles(): ModelDocument {
  const doc = newDocument();
  draw(doc, rectangle(0, 0, 2, 1));
  draw(doc, rectangle(5, 0, 7, 1));
  return doc;
}

function mutable(doc: ModelDocument): MutableSnapshot {
  return JSON.parse(JSON.stringify(createSnapshot(doc))) as MutableSnapshot;
}

function root(snapshot: MutableSnapshot) {
  const definition = snapshot.definitions[0];
  if (!definition) throw new Error('snapshot has no definitions');
  return definition;
}

const faceCount = (doc: ModelDocument): number => [...doc.rootStore.faces()].length;

describe('repair on open', () => {
  it('leaves a valid snapshot unchanged', () => {
    const doc = twoRectangles();
    const result = restoreSnapshotWithRepair(mutable(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repairs).toEqual([]);
    expect(hashDocument(result.value.doc)).toBe(hashDocument(doc));
  });

  it('clears references to missing materials and keeps the face', () => {
    const snapshot = mutable(twoRectangles());
    const face = root(snapshot).faces[0];
    if (!face) throw new Error('no face');
    face.attributes.frontMaterialId = snapshot.nextId + 50;
    expect(restoreSnapshot(snapshot).ok).toBe(false);

    const result = restoreSnapshotWithRepair(snapshot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(faceCount(result.value.doc)).toBe(2);
    expect(result.value.repairs).toHaveLength(1);
    expect(result.value.repairs[0]).toMatch(/Cleared references/);
    expectValid(result.value.doc);
  });

  it('leaves out a face whose edge is missing, and keeps the rest of the model', () => {
    const snapshot = mutable(twoRectangles());
    const definition = root(snapshot);
    const face = definition.faces[0] as unknown as { outer: { edge: number }[] };
    const missingEdge = face.outer[0]?.edge;
    definition.edges = definition.edges.filter((edge) => edge.id !== missingEdge);
    expect(restoreSnapshot(snapshot).ok).toBe(false);

    const result = restoreSnapshotWithRepair(snapshot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(faceCount(result.value.doc)).toBe(1);
    expect(result.value.repairs.some((repair) => repair.startsWith('Removed face'))).toBe(true);
    expectValid(result.value.doc);
  });

  it('resets invalid drawing axes to the default', () => {
    const snapshot = mutable(twoRectangles());
    snapshot.axes = {
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 2, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
    };
    expect(restoreSnapshot(snapshot).ok).toBe(false);

    const result = restoreSnapshotWithRepair(snapshot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc.axes).toEqual(DEFAULT_MODEL_AXES);
    expect(result.value.repairs).toEqual([expect.stringMatching(/^Reset the drawing axes/)]);
  });

  it('still refuses problems only topology operations could fix', () => {
    const snapshot = mutable(twoRectangles());
    const definition = root(snapshot);
    const vertex = definition.vertices[0];
    if (!vertex) throw new Error('no vertex');
    definition.vertices.push({ id: snapshot.nextId, position: vertex.position });
    snapshot.nextId += 1;

    const result = restoreSnapshotWithRepair(snapshot);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/can't be repaired/);
  });

  it('still refuses structurally broken snapshots', () => {
    const snapshot = mutable(twoRectangles());
    root(snapshot).edges = 'not a list' as unknown as Json[];
    expect(restoreSnapshotWithRepair(snapshot).ok).toBe(false);
  });
});
