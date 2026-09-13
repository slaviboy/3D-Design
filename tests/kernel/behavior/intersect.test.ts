import { describe, expect, it } from 'vitest';
import type { FaceId } from '../../../src/kernel/ids';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { makeGroup } from '../../../src/kernel/ops/hierarchy';
import { intersectFaces } from '../../../src/kernel/ops/intersect';
import { boxEdges, counts, draw, expectValid, faceIds, newDocument, rectangle } from '../helpers';

/** Rows K1–K4 of docs/BEHAVIOR_MATRIX.md. */
describe('behavior matrix K: Intersect Faces', () => {
  it('K1: two crossing boxes get a closed loop of intersection edges and split faces', () => {
    const doc = newDocument();
    const root = doc.rootDefinitionId;
    draw(doc, boxEdges(0, 0, 0, 2, 2, 2));
    draw(doc, boxEdges(1, 1, 1, 3, 3, 3));
    expect(counts(doc)).toEqual({ v: 16, e: 24, f: 12 });
    const before = hashDocument(doc);

    const created = intersectFaces(doc, root, faceIds(doc.rootStore), { with: 'model' });
    expect(created).toHaveLength(6);
    expect(counts(doc)).toEqual({ v: 22, e: 36, f: 18 });
    // The new edges form one closed loop: every endpoint is shared by exactly two of them.
    const uses = new Map<number, number>();
    for (const id of created) {
      const edge = doc.rootStore.getEdge(id);
      for (const vertex of [edge.v0, edge.v1]) uses.set(vertex, (uses.get(vertex) ?? 0) + 1);
      // Each lies on a split face of both boxes.
      expect(edge.faces).toHaveLength(4);
    }
    expect([...uses.values()]).toEqual([2, 2, 2, 2, 2, 2]);
    expectValid(doc);

    doc.undo();
    expect(hashDocument(doc)).toBe(before);
    doc.redo();
    expect(counts(doc)).toEqual({ v: 22, e: 36, f: 18 });
  });

  it('K2: a slab through a box cuts a ring around the box and a hole in the slab', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    draw(doc, rectangle(-1, -1, 2, 2, 0.5));
    expect(counts(doc)).toEqual({ v: 12, e: 16, f: 7 });
    const slab = faceIds(doc.rootStore).find(
      (id) =>
        doc.rootStore.getFace(id).outer.length === 4 &&
        doc.rootStore.getFacePlane(id).offset !== 0 &&
        Math.abs(Math.abs(doc.rootStore.getFacePlane(id).offset) - 0.5) < 1e-9 &&
        Math.abs(doc.rootStore.getFacePlane(id).normal.z) > 0.5,
    ) as FaceId;
    intersectFaces(doc, doc.rootDefinitionId, [slab], { with: 'model' });
    expect(counts(doc)).toEqual({ v: 16, e: 24, f: 12 });
    expect(doc.rootStore.getFace(slab).inners).toHaveLength(1);
    expectValid(doc);
  });

  it('K3: coplanar faces produce no edges and no history entry', () => {
    const doc = newDocument();
    const root = doc.rootDefinitionId;
    draw(doc, rectangle(0, 0, 2, 2));
    makeGroup(doc, root, { faces: faceIds(doc.rootStore) });
    draw(doc, rectangle(1, 1, 3, 3));
    const before = hashDocument(doc);
    const depth = doc.undoDepth;
    expect(intersectFaces(doc, root, faceIds(doc.rootStore), { with: 'model' })).toEqual([]);
    expect(hashDocument(doc)).toBe(before);
    expect(doc.undoDepth).toBe(depth);
  });

  it('K4: intersecting with a group edits only the open context', () => {
    const doc = newDocument();
    const root = doc.rootDefinitionId;
    draw(doc, boxEdges(1, 1, 1, 3, 3, 3));
    const group = makeGroup(doc, root, { faces: faceIds(doc.rootStore) });
    draw(doc, boxEdges(0, 0, 0, 2, 2, 2));
    const groupHash = counts(doc, group.definition);
    intersectFaces(doc, root, faceIds(doc.rootStore), { with: 'model' });
    expect(counts(doc, group.definition)).toEqual(groupHash);
    expect(counts(doc)).toEqual({ v: 14, e: 21, f: 9 });
    expectValid(doc);
  });

  it('K5: with the selection only, faces are intersected with each other', () => {
    const doc = newDocument();
    const root = doc.rootDefinitionId;
    draw(doc, boxEdges(0, 0, 0, 2, 2, 2));
    draw(doc, rectangle(-1, -1, 3, 3, 1));
    const store = doc.rootStore;
    const top = faceIds(store).find((id) => Math.abs(store.getFacePlane(id).normal.x) > 0.5) as FaceId;
    // A single selected face has nothing to intersect with.
    expect(intersectFaces(doc, root, [top], { with: 'selection' })).toEqual([]);
    const slab = faceIds(store).find((id) => {
      const plane = store.getFacePlane(id);
      return Math.abs(plane.normal.z) > 0.5 && Math.abs(Math.abs(plane.offset) - 1) < 1e-9;
    }) as FaceId;
    expect(intersectFaces(doc, root, [top, slab], { with: 'selection' })).toHaveLength(1);
    expectValid(doc);
  });
});
