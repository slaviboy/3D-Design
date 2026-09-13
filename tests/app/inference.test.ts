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
import { rayThroughScreen } from '../../src/app/camera/camera';
import { axisOf, closestPointOnLineToRay, infer } from '../../src/app/inference/inference';
import { IDENTITY } from '../../src/kernel/math/mat4';
import { vec3, type Vec3 } from '../../src/kernel/math/vec3';
import type { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { insertCurve } from '../../src/kernel/ops/curves';
import { makeGroup } from '../../src/kernel/ops/hierarchy';
import { draw, newDocument, rectangle } from '../kernel/helpers';
import { screenOf, TOP_CAMERA, VIEW_SIZE } from './fixtures';

function inferAt(
  doc: ModelDocument,
  x: number,
  y: number,
  extra: { anchor?: Vec3; lockDirection?: Vec3 } = {},
) {
  return infer(doc, doc.rootDefinitionId, IDENTITY, {
    camera: TOP_CAMERA,
    size: VIEW_SIZE,
    screen: screenOf(x, y),
    ...extra,
  });
}

function withSquare(): ModelDocument {
  const doc = newDocument();
  draw(doc, rectangle(-2, -2, 2, 2));
  return doc;
}

const expectPoint = (actual: Vec3, expected: Vec3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.z).toBeCloseTo(expected.z, 6);
};

describe('inference', () => {
  it('snaps to endpoints, midpoints and points on edges, in that order of preference', () => {
    const doc = withSquare();
    const endpoint = inferAt(doc, 1.9, 1.9);
    expect(endpoint).toMatchObject({ kind: 'endpoint', label: 'Endpoint', inGroup: false });
    expectPoint(endpoint.point, vec3(2, 2, 0));
    expect(endpoint.entity?.kind).toBe('edge');

    const midpoint = inferAt(doc, 0.05, 2.1);
    expect(midpoint.kind).toBe('midpoint');
    expectPoint(midpoint.point, vec3(0, 2, 0));

    const onEdge = inferAt(doc, 1, 2.05);
    expect(onEdge.kind).toBe('on-edge');
    expectPoint(onEdge.point, vec3(1, 2, 0));
  });

  it('reports faces under the cursor with their plane, and free points on the ground', () => {
    const doc = withSquare();
    const onFace = inferAt(doc, 0.5, 0.7);
    expect(onFace).toMatchObject({ kind: 'on-face', label: 'On Face' });
    expect(Math.abs(onFace.facePlane?.normal.z ?? 0)).toBeCloseTo(1);
    expectPoint(onFace.point, vec3(0.5, 0.7, 0));

    const free = inferAt(doc, 4, 4);
    expect(free).toMatchObject({ kind: 'free', label: '' });
    expectPoint(free.point, vec3(4, 4, 0));
  });

  it('snaps to the origin and to curve centers', () => {
    const empty = newDocument();
    expect(inferAt(empty, 0.1, -0.1)).toMatchObject({ kind: 'origin', label: 'Origin' });

    const doc = newDocument();
    insertCurve(doc, doc.rootDefinitionId, {
      kind: 'circle',
      center: vec3(2, 2, 0),
      normal: vec3(0, 0, 1),
      xAxis: vec3(1, 0, 0),
      radius: 1,
      segments: 12,
    });
    const center = inferAt(doc, 2.1, 1.9);
    expect(center.kind).toBe('center');
    expectPoint(center.point, vec3(2, 2, 0));
  });

  it('infers axis alignment from the anchor', () => {
    const doc = newDocument();
    const onAxis = inferAt(doc, 3, 0.2, { anchor: vec3(0, 0, 0) });
    expect(onAxis).toMatchObject({ kind: 'on-axis', label: 'On Red Axis', axis: 'x' });
    expectPoint(onAxis.point, vec3(3, 0, 0));
  });

  it('honors direction locks, projecting strong inferences onto the locked line', () => {
    const doc = withSquare();
    const locked = inferAt(doc, 2.5, 3, { anchor: vec3(1, 1, 0), lockDirection: vec3(0, 1, 0) });
    expect(locked).toMatchObject({ kind: 'locked', label: 'On Green Axis', axis: 'y' });
    expectPoint(locked.point, vec3(1, 3, 0));

    const projected = inferAt(doc, 1.95, 1.95, { anchor: vec3(0, 0, 0), lockDirection: vec3(1, 0, 0) });
    expect(projected.label).toBe('Endpoint (locked)');
    expectPoint(projected.point, vec3(2, 0, 0));

    const custom = inferAt(doc, 4, 4, { anchor: vec3(0, 0, 0), lockDirection: vec3(1, 1, 0) });
    expect(custom.label).toBe('Locked direction');
  });

  it('marks inferences from inside groups', () => {
    const doc = withSquare();
    makeGroup(doc, doc.rootDefinitionId, { faces: [...doc.rootStore.faces()].map((f) => f.id) });
    const corner = inferAt(doc, 1.95, -1.95);
    expect(corner).toMatchObject({ kind: 'endpoint', inGroup: true });
    expect(corner.entity?.kind).toBe('instance');
    expect(inferAt(doc, 0.5, 0.5)).toMatchObject({
      kind: 'on-face',
      inGroup: true,
      label: 'On Face in Group',
    });
  });

  it('computes axes and closest points on lines', () => {
    expect(axisOf(vec3(0, 0, -3))).toBe('z');
    expect(axisOf(vec3(1, 1, 0))).toBeUndefined();
    expect(axisOf(vec3(0, 0, 0))).toBeUndefined();
    const ray = rayThroughScreen(TOP_CAMERA, screenOf(2, 5), VIEW_SIZE);
    expectPoint(closestPointOnLineToRay(vec3(0, 0, 0), vec3(1, 0, 0), ray), vec3(2, 0, 0));
    expectPoint(closestPointOnLineToRay(vec3(1, 1, 1), vec3(0, 0, 1), ray), vec3(1, 1, 1));
  });
});
