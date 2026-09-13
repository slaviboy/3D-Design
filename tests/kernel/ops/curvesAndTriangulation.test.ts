/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from 'vitest';
import { KernelError } from '../../../src/kernel/errors';
import { signedArea } from '../../../src/kernel/math/geom2d';
import { planeBasis, projectTo2D } from '../../../src/kernel/math/plane';
import { scaling, translation } from '../../../src/kernel/math/mat4';
import { vec3, AXIS_X, AXIS_Z } from '../../../src/kernel/math/vec3';
import {
  curvePoints,
  insertCurve,
  splitCurveChains,
  transformCurveParams,
} from '../../../src/kernel/ops/curves';
import { triangulateFace } from '../../../src/kernel/ops/triangulate';
import type { CurveParams } from '../../../src/kernel/model/types';
import { counts, draw, expectValid, newDocument, rectangle } from '../helpers';

const circle: CurveParams & { kind: 'circle' } = {
  kind: 'circle',
  center: vec3(0, 0, 0),
  normal: AXIS_Z,
  xAxis: AXIS_X,
  radius: 1,
  segments: 16,
};

describe('curves', () => {
  it('generates circle, polygon and arc points on the frame', () => {
    const { points, closed } = curvePoints(circle);
    expect(closed).toBe(true);
    expect(points).toHaveLength(16);
    for (const p of points) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1);
    expect(curvePoints({ ...circle, kind: 'polygon', sides: 6 }).points).toHaveLength(6);
    const arc = curvePoints({ ...circle, kind: 'arc', startAngle: 0, endAngle: Math.PI / 2, segments: 4 });
    expect(arc.closed).toBe(false);
    expect(arc.points).toHaveLength(5);
    expect(arc.points[4]?.y).toBeCloseTo(1);
  });

  it('rejects invalid curve parameters', () => {
    expect(() => curvePoints({ kind: 'polyline' })).toThrow(KernelError);
    expect(() => curvePoints({ ...circle, segments: 2 })).toThrow(KernelError);
    expect(() => curvePoints({ ...circle, radius: 0 })).toThrow(KernelError);
    expect(() => curvePoints({ ...circle, xAxis: AXIS_Z })).toThrow(KernelError);
    expect(() =>
      curvePoints({ ...circle, kind: 'arc', startAngle: 0, endAngle: 2 * Math.PI, segments: 4 }),
    ).toThrow(KernelError);
  });

  it('draws a circle as one curve entity with a face', () => {
    const doc = newDocument();
    const result = insertCurve(doc, doc.rootDefinitionId, circle);
    expect(counts(doc)).toEqual({ v: 16, e: 16, f: 1 });
    expect(result.curve).not.toBeNull();
    expect(splitCurveChains(doc.rootStore, result.edges)).toHaveLength(1);
    expectValid(doc);
  });

  it('draws an open arc without a face', () => {
    const doc = newDocument();
    const result = insertCurve(doc, doc.rootDefinitionId, {
      ...circle,
      kind: 'arc',
      startAngle: 0,
      endAngle: Math.PI,
      segments: 12,
    });
    expect(counts(doc)).toEqual({ v: 13, e: 12, f: 0 });
    expect(result.curve).not.toBeNull();
  });

  it('keeps circles circular under similarity transforms and flattens them otherwise', () => {
    const moved = transformCurveParams(circle, translation(vec3(5, 0, 0)));
    expect(moved).toMatchObject({ kind: 'circle', radius: 1, center: vec3(5, 0, 0) });
    expect(transformCurveParams(circle, scaling(vec3(2, 2, 2)))).toMatchObject({ kind: 'circle', radius: 2 });
    expect(transformCurveParams(circle, scaling(vec3(2, 1, 1)))).toEqual({ kind: 'polyline' });
    const mirrored = transformCurveParams(circle, scaling(vec3(-1, 1, 1)));
    expect(mirrored).toMatchObject({ kind: 'circle', radius: 1 });
    expect(transformCurveParams({ kind: 'polyline' }, scaling(vec3(2, 1, 1)))).toEqual({ kind: 'polyline' });
  });
});

describe('triangulateFace', () => {
  it('triangulates a face with a hole, counter-clockwise and with no area error', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 2));
    draw(doc, rectangle(-1, -1, 3, 3));
    const ring = [...doc.rootStore.faces()].find((face) => face.inners.length === 1);
    if (!ring) throw new Error('expected a ring face');
    const result = triangulateFace(doc.rootStore, ring.id);
    expect(result.vertices).toHaveLength(8);
    expect(result.indices).toHaveLength(8 * 3);
    expect(result.relativeAreaError).toBeLessThan(1e-12);
    const basis = planeBasis(doc.rootStore.getFacePlane(ring.id).normal);
    const points = result.vertices.map((v) => projectTo2D(basis, doc.rootStore.position(v)));
    for (let i = 0; i < result.indices.length; i += 3) {
      const triangle = [0, 1, 2].map((k) => points[result.indices[i + k] ?? 0] ?? { x: 0, y: 0 });
      expect(signedArea(triangle)).toBeGreaterThan(0);
    }
  });
});
