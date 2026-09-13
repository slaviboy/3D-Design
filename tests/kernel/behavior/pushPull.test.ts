import { describe, expect, it } from 'vitest';
import { KernelError } from '../../../src/kernel/errors';
import type { FaceId } from '../../../src/kernel/ids';
import { dot, sub, vec3, type Vec3 } from '../../../src/kernel/math/vec3';
import type { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { insertCurve } from '../../../src/kernel/ops/curves';
import { faceArea } from '../../../src/kernel/ops/planar/regions';
import { pushPull, pushPullMode } from '../../../src/kernel/ops/pushPull';
import {
  counts,
  draw,
  expectValid,
  newDocument,
  orientationConsistent,
  polygon,
  rectangle,
} from '../helpers';

const root = (doc: ModelDocument) => doc.rootDefinitionId;

function facesWhere(doc: ModelDocument, predicate: (normal: Vec3, centroid: Vec3) => boolean): FaceId[] {
  const store = doc.rootStore;
  return [...store.faces()]
    .filter((face) => {
      const plane = face.plane;
      if (!plane) return false;
      const points = store.loopPoints(face.outer);
      const centroid = points.reduce(
        (sum, p) =>
          vec3(sum.x + p.x / points.length, sum.y + p.y / points.length, sum.z + p.z / points.length),
        vec3(0, 0, 0),
      );
      return predicate(plane.normal, centroid);
    })
    .map((face) => face.id)
    .sort((a, b) => faceArea(store, a) - faceArea(store, b));
}

function onlyFace(doc: ModelDocument, predicate: (normal: Vec3, centroid: Vec3) => boolean): FaceId {
  const [face] = facesWhere(doc, predicate);
  if (face === undefined) throw new Error('face not found');
  return face;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** Unit box made by pulling a ground rectangle up by 1. Returns the top face. */
function unitBox(doc: ModelDocument): FaceId {
  draw(doc, rectangle(0, 0, 1, 1));
  const ground = onlyFace(doc, () => true);
  pushPull(doc, root(doc), ground, -1);
  return onlyFace(doc, (normal, c) => normal.z > 0.5 && near(c.z, 1));
}

function outwardFrom(doc: ModelDocument, center: Vec3): boolean {
  return (
    facesWhere(doc, () => true).length ===
    facesWhere(doc, (normal, c) => dot(normal, sub(c, center)) > 0).length
  );
}

/** Rows B1–B14 of docs/BEHAVIOR_MATRIX.md. */
describe('behavior matrix B: Push/Pull', () => {
  it('B1: pulling a ground rectangle up makes a closed box with outward faces', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const ground = onlyFace(doc, () => true);
    expect(pushPullMode(doc.rootStore, ground)).toBe('extrude');
    const result = pushPull(doc, root(doc), ground, -1);
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    expect(outwardFrom(doc, vec3(0.5, 0.5, 0.5))).toBe(true);
    expect(doc.rootStore.getFacePlane(result.face as FaceId).normal.z).toBeCloseTo(1);
  });

  it('B2: pulling the top of a box stretches it without new entities', () => {
    const doc = newDocument();
    const top = unitBox(doc);
    expect(pushPullMode(doc.rootStore, top)).toBe('stretch');
    const result = pushPull(doc, root(doc), top, 0.5);
    expect(result).toEqual({ mode: 'stretch', face: top });
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expect(doc.rootStore.getFacePlane(top).offset).toBeCloseTo(1.5);
  });

  it('B3: pushing the top flush with the bottom is refused and changes nothing', () => {
    const doc = newDocument();
    const top = unitBox(doc);
    const before = hashDocument(doc);
    const depth = doc.undoDepth;
    expect(() => pushPull(doc, root(doc), top, -1)).toThrow(KernelError);
    expect(hashDocument(doc)).toBe(before);
    expect(doc.undoDepth).toBe(depth);
  });

  function boxWithInnerSquare(doc: ModelDocument): FaceId {
    unitBox(doc);
    draw(doc, rectangle(0.25, 0.25, 0.75, 0.75, 1));
    expect(counts(doc)).toEqual({ v: 12, e: 16, f: 7 });
    return onlyFace(doc, (normal, c) => normal.z > 0.5 && near(c.z, 1));
  }

  it('B4/B5: pulling a square drawn on top leaves the frame and builds a prism', () => {
    const doc = newDocument();
    const inner = boxWithInnerSquare(doc);
    expect(pushPullMode(doc.rootStore, inner)).toBe('extrude');
    const result = pushPull(doc, root(doc), inner, 0.2);
    expect(counts(doc)).toEqual({ v: 16, e: 24, f: 11 });
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    expect(doc.rootStore.getFacePlane(result.face as FaceId).offset).toBeCloseTo(1.2);
  });

  it('B6: pushing the square in makes a pocket whose walls face into it', () => {
    const doc = newDocument();
    const inner = boxWithInnerSquare(doc);
    const result = pushPull(doc, root(doc), inner, -0.3);
    expect(counts(doc)).toEqual({ v: 16, e: 24, f: 11 });
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    const floor = doc.rootStore.getFacePlane(result.face as FaceId);
    expect(floor.normal.z).toBeCloseTo(1);
    expect(floor.offset).toBeCloseTo(0.7);
    expect(outwardFrom(doc, vec3(0.5, 0.5, 0.2))).toBe(false);
  });

  it('B7: pushing the square all the way through cuts a hole in the bottom', () => {
    const doc = newDocument();
    const inner = boxWithInnerSquare(doc);
    const before = hashDocument(doc);
    const result = pushPull(doc, root(doc), inner, -1);
    expect(result.face).toBeNull();
    expect(counts(doc)).toEqual({ v: 16, e: 24, f: 10 });
    const bottom = onlyFace(doc, (normal, c) => normal.z < -0.5 && near(c.z, 0));
    expect(doc.rootStore.getFace(bottom).inners).toHaveLength(1);
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    doc.undo();
    expect(hashDocument(doc)).toBe(before);
  });

  it('B8: Ctrl keeps the original face and extrudes a new one', () => {
    const doc = newDocument();
    const top = unitBox(doc);
    expect(pushPullMode(doc.rootStore, top, { createNewStartFace: true })).toBe('extrude');
    pushPull(doc, root(doc), top, 0.5, { createNewStartFace: true });
    expect(counts(doc)).toEqual({ v: 12, e: 20, f: 11 });
    expect(doc.rootStore.face(top)).toBeDefined();
  });

  it('B9: pulling a circle makes a cylinder with soft, smooth sides and a round cap', () => {
    const doc = newDocument();
    insertCurve(doc, root(doc), {
      kind: 'circle',
      center: vec3(0, 0, 0),
      normal: vec3(0, 0, 1),
      xAxis: vec3(1, 0, 0),
      radius: 0.5,
      segments: 24,
    });
    const disc = onlyFace(doc, () => true);
    pushPull(doc, root(doc), disc, -1);
    expect(counts(doc)).toEqual({ v: 48, e: 72, f: 26 });
    expect(
      [...doc.rootStore.edges()].filter((edge) => edge.attributes.soft && edge.attributes.smooth),
    ).toHaveLength(24);
    expect(doc.rootStore.curveCount).toBe(2);
    expect(orientationConsistent(doc.rootStore)).toBe(true);
  });

  it('B11: a zero distance does nothing and creates no history entry', () => {
    const doc = newDocument();
    const top = unitBox(doc);
    const depth = doc.undoDepth;
    pushPull(doc, root(doc), top, 0);
    expect(doc.undoDepth).toBe(depth);
  });

  it('B10/B12: pulling a side face with perpendicular neighbors stretches the box', () => {
    const doc = newDocument();
    unitBox(doc);
    const side = onlyFace(doc, (normal, c) => normal.x > 0.5 && near(c.x, 1));
    expect(pushPull(doc, root(doc), side, 0.5).mode).toBe('stretch');
    expect(counts(doc)).toEqual({ v: 8, e: 12, f: 6 });
    expectValid(doc);
  });

  it('B13: a face with sloped neighbors extrudes', () => {
    const doc = newDocument();
    draw(doc, polygon([vec3(0, 0, 0), vec3(0, 1, 0), vec3(0, 0.5, 1)]));
    const triangle = onlyFace(doc, () => true);
    pushPull(doc, root(doc), triangle, 1);
    expect(counts(doc)).toEqual({ v: 6, e: 9, f: 5 });
    const sloped = onlyFace(doc, (normal) => Math.abs(normal.x) < 0.1 && normal.y < -0.1);
    expect(pushPullMode(doc.rootStore, sloped)).toBe('extrude');
    pushPull(doc, root(doc), sloped, 0.2);
    expect(orientationConsistent(doc.rootStore)).toBe(true);
    expectValid(doc);
  });

  it('rejects non-finite distances', () => {
    const doc = newDocument();
    const top = unitBox(doc);
    expect(() => pushPull(doc, root(doc), top, Number.NaN)).toThrow(KernelError);
  });
});
