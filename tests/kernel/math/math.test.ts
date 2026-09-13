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
import {
  aabbContains,
  aabbExpand,
  aabbFromPoints,
  aabbIsEmpty,
  EMPTY_AABB,
} from '../../../src/kernel/math/aabb';
import {
  classifyPointInPolygon,
  classifyPointInRing,
  interiorPoint,
  orient,
  signedArea,
  triangulatePolygon,
} from '../../../src/kernel/math/geom2d';
import {
  IDENTITY,
  invertAffine,
  isMat4,
  linearDeterminant,
  multiply,
  rotationAxisAngle,
  scaling,
  transformDirection,
  transformNormal,
  transformPoint,
  translation,
} from '../../../src/kernel/math/mat4';
import {
  canonicalPlane,
  flipPlane,
  isPointOnPlane,
  newellNormal,
  planeBasis,
  planeFromPointNormal,
  planeFromPolygon,
  planesCoincide,
  planeThroughPoints,
  projectPointOntoPlane,
  projectTo2D,
  unprojectFrom2D,
} from '../../../src/kernel/math/plane';
import {
  closestPointOnSegment,
  closestPointsOnSegments,
  distancePointToLine,
  distancePointToSegment,
  parameterOnLine,
} from '../../../src/kernel/math/segment';
import {
  anyPerpendicular,
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  cross,
  dot,
  length,
  normalize,
  pointsCoincide,
  vec3,
  ZERO,
} from '../../../src/kernel/math/vec3';
import { EPS_LEN } from '../../../src/kernel/tolerance';

const square = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe('vec3', () => {
  it('normalizes non-zero vectors and rejects zero or infinite ones', () => {
    const unit = normalize(vec3(3, 0, 4));
    expect(unit?.x).toBeCloseTo(0.6, 15);
    expect(unit?.y).toBe(0);
    expect(unit?.z).toBeCloseTo(0.8, 15);
    expect(normalize(ZERO)).toBeNull();
    expect(normalize(vec3(Infinity, 0, 0))).toBeNull();
  });

  it('builds a unit perpendicular for any direction', () => {
    for (const n of [AXIS_X, AXIS_Y, AXIS_Z, normalize(vec3(1, 2, 3)) ?? AXIS_Z]) {
      const p = anyPerpendicular(n);
      expect(dot(p, n)).toBeCloseTo(0, 12);
      expect(length(p)).toBeCloseTo(1, 12);
    }
    expect(() => anyPerpendicular(ZERO)).toThrow();
  });

  it('treats points within the tolerance as coincident', () => {
    expect(pointsCoincide(vec3(1, 1, 1), vec3(1 + EPS_LEN / 2, 1, 1))).toBe(true);
    expect(pointsCoincide(vec3(1, 1, 1), vec3(1 + 2 * EPS_LEN, 1, 1))).toBe(false);
  });
});

describe('mat4', () => {
  it('composes, inverts and transforms points, directions and normals', () => {
    const m = multiply(
      translation(vec3(1, 2, 3)),
      multiply(rotationAxisAngle(AXIS_Z, Math.PI / 2), scaling(vec3(2, 2, 2))),
    );
    const p = transformPoint(m, vec3(1, 0, 0));
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(4);
    expect(p.z).toBeCloseTo(3);
    const inverse = invertAffine(m);
    expect(inverse).not.toBeNull();
    const back = transformPoint(inverse ?? IDENTITY, p);
    expect(back.x).toBeCloseTo(1);
    expect(back.y).toBeCloseTo(0);
    expect(transformDirection(m, AXIS_X).y).toBeCloseTo(2);
    multiply(inverse ?? IDENTITY, m).forEach((value, index) => {
      expect(value).toBeCloseTo(IDENTITY[index] ?? 0);
    });
  });

  it('keeps transformed normals perpendicular to transformed tangents under non-uniform scale', () => {
    const m = scaling(vec3(2, 1, 1));
    const normal = transformNormal(m, vec3(1, 1, 0));
    const tangent = transformDirection(m, vec3(1, -1, 0));
    expect(normal).not.toBeNull();
    expect(dot(normal ?? ZERO, tangent)).toBeCloseTo(0);
    expect(transformNormal(scaling(vec3(0, 1, 1)), AXIS_X)).toBeNull();
  });

  it('detects mirroring, singular matrices and malformed input', () => {
    expect(linearDeterminant(scaling(vec3(-1, 1, 1)))).toBe(-1);
    expect(invertAffine(scaling(vec3(1, 0, 1)))).toBeNull();
    expect(isMat4(IDENTITY)).toBe(true);
    expect(isMat4([1, 2, 3])).toBe(false);
    expect(isMat4([...IDENTITY.slice(0, 15), Number.NaN])).toBe(false);
  });
});

describe('plane', () => {
  it('computes Newell normals and planes of polygons', () => {
    const points = [vec3(0, 0, 2), vec3(1, 0, 2), vec3(1, 1, 2), vec3(0, 1, 2)];
    expect(newellNormal(points)).toEqual(vec3(0, 0, 2));
    const plane = planeFromPolygon(points);
    expect(plane?.normal).toEqual(AXIS_Z);
    expect(plane?.offset).toBeCloseTo(2);
    expect(planeFromPolygon([vec3(0, 0, 0), vec3(1, 0, 0), vec3(2, 0, 0)])).toBeNull();
  });

  it('builds planes through points and rejects collinear points', () => {
    expect(planeThroughPoints(ZERO, AXIS_X, AXIS_Y)?.normal).toEqual(AXIS_Z);
    expect(planeThroughPoints(ZERO, AXIS_X, vec3(5, 0, 0))).toBeNull();
    expect(planeThroughPoints(ZERO, ZERO, AXIS_Y)).toBeNull();
  });

  it('compares planes regardless of facing and canonicalizes them', () => {
    const plane = planeFromPointNormal(vec3(0, 0, 3), AXIS_Z);
    expect(planesCoincide(plane, flipPlane(plane))).toBe(true);
    expect(planesCoincide(plane, planeFromPointNormal(vec3(0, 0, 3 + 2 * EPS_LEN), AXIS_Z))).toBe(false);
    expect(planesCoincide(plane, planeFromPointNormal(vec3(0, 0, 3), AXIS_X))).toBe(false);
    expect(canonicalPlane(flipPlane(plane))).toEqual(plane);
    expect(isPointOnPlane(plane, vec3(10, -4, 3))).toBe(true);
    expect(projectPointOntoPlane(plane, vec3(1, 1, 7))).toEqual(vec3(1, 1, 3));
  });

  it('projects to a right-handed 2D basis and back', () => {
    const normal = normalize(vec3(1, 2, 2)) ?? AXIS_Z;
    const basis = planeBasis(normal);
    expect(dot(basis.u, basis.v)).toBeCloseTo(0, 12);
    const c = cross(basis.u, basis.v);
    expect(dot(c, normal)).toBeCloseTo(1, 12);
    const plane = planeFromPointNormal(vec3(4, 5, 6), normal);
    const point = projectPointOntoPlane(plane, vec3(1, -3, 2));
    const back = unprojectFrom2D(basis, plane, projectTo2D(basis, point));
    expect(back.x).toBeCloseTo(point.x, 10);
    expect(back.y).toBeCloseTo(point.y, 10);
    expect(back.z).toBeCloseTo(point.z, 10);
  });
});

describe('geom2d', () => {
  it('orients counter-clockwise triples positively, exactly', () => {
    expect(orient({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toBeGreaterThan(0);
    expect(orient({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 })).toBeLessThan(0);
    expect(orient({ x: 0.5, y: 0.5 }, { x: 12, y: 12 }, { x: 24, y: 24 })).toBe(0);
  });

  it('computes signed areas', () => {
    expect(signedArea(square)).toBe(1);
    expect(signedArea([...square].reverse())).toBe(-1);
  });

  it('classifies points against rings and polygons with holes', () => {
    expect(classifyPointInRing({ x: 0.5, y: 0.5 }, square)).toBe('inside');
    expect(classifyPointInRing({ x: 1.5, y: 0.5 }, square)).toBe('outside');
    expect(classifyPointInRing({ x: 1, y: 0.5 }, square)).toBe('boundary');
    expect(classifyPointInRing({ x: 0, y: 0 }, square)).toBe('boundary');
    const outer = square.map((p) => ({ x: p.x * 4, y: p.y * 4 }));
    const hole = square.map((p) => ({ x: p.x + 1.5, y: p.y + 1.5 }));
    expect(classifyPointInPolygon({ x: 2, y: 2 }, outer, [hole])).toBe('outside');
    expect(classifyPointInPolygon({ x: 0.5, y: 0.5 }, outer, [hole])).toBe('inside');
    expect(classifyPointInPolygon({ x: 1.5, y: 2 }, outer, [hole])).toBe('boundary');
  });

  it('finds a strictly interior point and triangulates polygons with holes', () => {
    const outer = square.map((p) => ({ x: p.x * 4, y: p.y * 4 }));
    const hole = square.map((p) => ({ x: p.x + 1, y: p.y + 1 }));
    const sample = interiorPoint(outer, [hole]);
    expect(sample).not.toBeNull();
    expect(classifyPointInPolygon(sample ?? { x: -1, y: -1 }, outer, [hole])).toBe('inside');
    expect(triangulatePolygon(square, [])).toHaveLength(6);
    expect(triangulatePolygon(outer, [hole]).length % 3).toBe(0);
    expect(
      interiorPoint(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        [],
      ),
    ).toBeNull();
  });
});

describe('segment', () => {
  it('finds the crossing of two segments', () => {
    const result = closestPointsOnSegments(vec3(-1, 0, 0), vec3(1, 0, 0), vec3(0, -1, 0), vec3(0, 1, 0));
    expect(result.distance).toBe(0);
    expect(result.s).toBeCloseTo(0.5);
    expect(result.t).toBeCloseTo(0.5);
  });

  it('measures parallel, skew and degenerate segments', () => {
    expect(closestPointsOnSegments(ZERO, AXIS_X, vec3(0, 1, 0), vec3(1, 1, 0)).distance).toBeCloseTo(1);
    expect(closestPointsOnSegments(ZERO, AXIS_X, vec3(0.5, -1, 2), vec3(0.5, 1, 2)).distance).toBeCloseTo(2);
    expect(closestPointsOnSegments(ZERO, ZERO, vec3(0, 3, 0), vec3(0, 3, 0)).distance).toBeCloseTo(3);
    expect(closestPointsOnSegments(ZERO, ZERO, vec3(-1, 1, 0), vec3(1, 1, 0)).distance).toBeCloseTo(1);
    expect(closestPointsOnSegments(vec3(-1, 1, 0), vec3(1, 1, 0), ZERO, ZERO).distance).toBeCloseTo(1);
    expect(closestPointsOnSegments(ZERO, AXIS_X, vec3(2, 1, 0), vec3(3, 1, 0)).distance).toBeCloseTo(
      Math.SQRT2,
    );
    expect(closestPointsOnSegments(vec3(2, 1, 0), vec3(3, 1, 0), ZERO, AXIS_X).distance).toBeCloseTo(
      Math.SQRT2,
    );
  });

  it('projects points onto lines and segments', () => {
    expect(parameterOnLine(ZERO, vec3(2, 0, 0), vec3(3, 5, 0))).toBe(1.5);
    expect(parameterOnLine(ZERO, ZERO, vec3(3, 5, 0))).toBe(0);
    expect(closestPointOnSegment(ZERO, vec3(2, 0, 0), vec3(3, 5, 0))).toEqual(vec3(2, 0, 0));
    expect(distancePointToSegment(vec3(3, 4, 0), ZERO, vec3(2, 0, 0))).toBeCloseTo(Math.hypot(1, 4));
    expect(distancePointToLine(vec3(3, 4, 0), ZERO, vec3(2, 0, 0))).toBeCloseTo(4);
  });
});

describe('aabb', () => {
  it('builds, expands and compares boxes', () => {
    const box = aabbFromPoints([vec3(1, 2, 3), vec3(-1, 0, 5)]);
    expect(box).toEqual({ minX: -1, minY: 0, minZ: 3, maxX: 1, maxY: 2, maxZ: 5 });
    expect(aabbContains(aabbExpand(box, 1), box)).toBe(true);
    expect(aabbIsEmpty(EMPTY_AABB)).toBe(true);
    expect(aabbIsEmpty(box)).toBe(false);
  });
});
