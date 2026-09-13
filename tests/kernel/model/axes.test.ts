import { describe, expect, it } from 'vitest';
import { KernelError } from '../../../src/kernel/errors';
import { vec3 } from '../../../src/kernel/math/vec3';
import { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import { setModelAxes } from '../../../src/kernel/model/mutations';
import { createSnapshot, hashDocument, restoreSnapshot } from '../../../src/kernel/model/snapshot';
import { DEFAULT_MODEL_AXES } from '../../../src/kernel/model/types';
import { validateDocument } from '../../../src/kernel/model/validate';

const rotated = { origin: vec3(1, 2, 0), xAxis: vec3(1, 1, 0), yAxis: vec3(-1, 1, 0.2) };

describe('model axes', () => {
  it('start at the world axes and are left out of default snapshots', () => {
    const doc = new ModelDocument();
    expect(doc.axes).toEqual(DEFAULT_MODEL_AXES);
    expect(createSnapshot(doc).axes).toBeUndefined();
  });

  it('are set as an undoable change with orthonormal directions', () => {
    const doc = new ModelDocument();
    const before = hashDocument(doc);
    doc.transact('Place Axes', () => {
      setModelAxes(doc, rotated);
    });
    const { xAxis, yAxis, origin } = doc.axes;
    expect(origin).toEqual(vec3(1, 2, 0));
    expect(Math.hypot(xAxis.x, xAxis.y, xAxis.z)).toBeCloseTo(1, 12);
    expect(Math.hypot(yAxis.x, yAxis.y, yAxis.z)).toBeCloseTo(1, 12);
    expect(xAxis.x * yAxis.x + xAxis.y * yAxis.y + xAxis.z * yAxis.z).toBeCloseTo(0, 12);
    expect(validateDocument(doc).ok).toBe(true);
    const after = hashDocument(doc);
    expect(after).not.toBe(before);

    doc.undo();
    expect(doc.axes).toEqual(DEFAULT_MODEL_AXES);
    expect(hashDocument(doc)).toBe(before);
    doc.redo();
    expect(hashDocument(doc)).toBe(after);
  });

  it('refuse parallel, zero or non-finite directions', () => {
    const doc = new ModelDocument();
    const attempt = (axes: typeof rotated) => () => {
      doc.transact('Place Axes', () => {
        setModelAxes(doc, axes);
      });
    };
    expect(attempt({ ...rotated, yAxis: vec3(2, 2, 0) })).toThrow(KernelError);
    expect(attempt({ ...rotated, xAxis: vec3(0, 0, 0) })).toThrow(KernelError);
    expect(attempt({ ...rotated, origin: vec3(Number.NaN, 0, 0) })).toThrow(KernelError);
    expect(doc.axes).toEqual(DEFAULT_MODEL_AXES);
    expect(doc.undoDepth).toBe(0);
  });

  it('survive a snapshot round trip, and invalid axes in a file are rejected', () => {
    const doc = new ModelDocument();
    doc.transact('Place Axes', () => {
      setModelAxes(doc, rotated);
    });
    const snapshot = createSnapshot(doc);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(hashDocument(restored.value)).toBe(hashDocument(doc));

    const broken = { ...snapshot, axes: { ...snapshot.axes, yAxis: snapshot.axes?.xAxis } };
    const result = restoreSnapshot(JSON.parse(JSON.stringify(broken)));
    expect(result.ok).toBe(false);
  });
});
