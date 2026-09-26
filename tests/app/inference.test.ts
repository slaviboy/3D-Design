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
import { projectToScreen, rayThroughScreen, type CameraState } from '../../src/app/camera/camera';
import {
  axisOf,
  closestPointOnLineToRay,
  infer,
  type InferenceReferences,
} from '../../src/app/inference/inference';
import { IDENTITY } from '../../src/kernel/math/mat4';
import { planeFromPointNormal } from '../../src/kernel/math/plane';
import { AXIS_X, AXIS_Z, vec3, type Vec3 } from '../../src/kernel/math/vec3';
import type { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { addGuideLine } from '../../src/kernel/model/mutations';
import { insertCurve } from '../../src/kernel/ops/curves';
import { makeGroup } from '../../src/kernel/ops/hierarchy';
import { draw, newDocument, rectangle, segment } from '../kernel/helpers';
import { screenOf, TOP_CAMERA, VIEW_SIZE } from './fixtures';

function inferAt(
  doc: ModelDocument,
  x: number,
  y: number,
  extra: { anchor?: Vec3; lockDirection?: Vec3; drawingAxes?: boolean } = {},
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
    const onFace = inferAt(doc, 1.2, 0.8);
    expect(onFace).toMatchObject({ kind: 'on-face', label: 'On Face' });
    expect(Math.abs(onFace.facePlane?.normal.z ?? 0)).toBeCloseTo(1);
    expectPoint(onFace.point, vec3(1.2, 0.8, 0));

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
    const onAxis = inferAt(doc, 3, 1.2, { anchor: vec3(0, 1, 0) });
    expect(onAxis).toMatchObject({ kind: 'on-axis', label: 'On Red Axis', axis: 'x' });
    expectPoint(onAxis.point, vec3(3, 1, 0));
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
    expect(inferAt(doc, 1.2, 0.8)).toMatchObject({
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

  describe('the drawing axes', () => {
    it('snap the pointer to a point on their lines, named by the axis', () => {
      const doc = newDocument();
      const red = inferAt(doc, 3, 0.2);
      expect(red).toMatchObject({ kind: 'on-drawing-axis', label: 'On Red Axis', drawingAxis: 'x' });
      expectPoint(red.point, vec3(3, 0, 0));
      // The negative half too.
      const green = inferAt(doc, 0.2, -3);
      expect(green).toMatchObject({ kind: 'on-drawing-axis', label: 'On Green Axis', drawingAxis: 'y' });
      expectPoint(green.point, vec3(0, -3, 0));

      // Seen from the side, the blue axis.
      const side: CameraState = { ...TOP_CAMERA, eye: vec3(6, -10, 1), target: vec3(0, 0, 1), up: AXIS_Z };
      const screen = projectToScreen(side, vec3(0, 0, 2), VIEW_SIZE);
      if (!screen) throw new Error('behind the camera');
      const blue = infer(doc, doc.rootDefinitionId, IDENTITY, {
        camera: side,
        size: VIEW_SIZE,
        screen: { x: screen.x + 3, y: screen.y },
      });
      expect(blue).toMatchObject({ kind: 'on-drawing-axis', label: 'On Blue Axis', drawingAxis: 'z' });
      expectPoint(blue.point, vec3(0, 0, 2));
    });

    it('only where nothing hides them', () => {
      const doc = newDocument();
      draw(doc, rectangle(2, -1, 4, 1, 1));
      // The red axis runs under this face, seen from above.
      expect(inferAt(doc, 3, 0.2).kind).toBe('on-face');
    });

    it('give way to an edge lying on them', () => {
      const doc = newDocument();
      draw(doc, [segment([1, 0, 0], [4, 0, 0])]);
      // Clear of its ends and middle, 16 px or more away.
      expect(inferAt(doc, 1.7, 0.2)).toMatchObject({ kind: 'on-edge', label: 'On Edge' });
    });

    it('are left out for tools that take only points of the model', () => {
      expect(inferAt(newDocument(), 3, 0.2, { drawingAxes: false }).kind).toBe('free');
    });
  });

  describe('for a tool that draws in a plane through its anchor', () => {
    // From the front right, above, so the vertical through a point on the ground shows as its own line.
    const camera: CameraState = {
      eye: vec3(6, -9, 6),
      target: vec3(1.5, 0, 0.5),
      up: AXIS_Z,
      fovDegrees: 35,
      projection: 'perspective',
      orthoHalfHeight: 5,
    };
    const size = { width: 800, height: 600 };

    function inferNear(
      doc: ModelDocument,
      point: Vec3,
      extra: { anchor: Vec3; normal: Vec3; planar: boolean; references?: InferenceReferences },
    ) {
      const screen = projectToScreen(camera, point, size);
      if (!screen) throw new Error('behind the camera');
      return infer(doc, doc.rootDefinitionId, IDENTITY, {
        camera,
        size,
        screen: { x: screen.x + 2, y: screen.y },
        anchor: extra.anchor,
        fallbackPlane: planeFromPointNormal(extra.anchor, extra.normal),
        planar: extra.planar,
        ...(extra.references ? { references: extra.references } : {}),
      });
    }

    it('leaves out the axis along the plane normal, which would put the point on the anchor', () => {
      const doc = newDocument();
      const anchor = vec3(2, 0, 0);
      const above = inferNear(doc, vec3(2, 0, 1), { anchor, normal: AXIS_Z, planar: true });
      expect(above.label).not.toBe('On Blue Axis');
      // A tool drawing lines in space still gets it.
      expect(inferNear(doc, vec3(2, 0, 1), { anchor, normal: AXIS_Z, planar: false }).label).toBe(
        'On Blue Axis',
      );
    });

    it('leaves out a corner straight above the anchor, but keeps the anchor itself', () => {
      const doc = newDocument();
      draw(doc, [segment([2, 0, 0], [2, 0, 1]), segment([2, 0, 1], [3, 0, 1])]);
      const anchor = vec3(2, 0, 0);
      const corner = inferNear(doc, vec3(2, 0, 1), { anchor, normal: AXIS_Z, planar: true });
      expect(corner.kind).not.toBe('endpoint');
      expect(corner.point).not.toEqual(vec3(2, 0, 1));
      expect(inferNear(doc, anchor, { anchor, normal: AXIS_Z, planar: true }).kind).toBe('endpoint');
    });

    it('does the same on a wall, where the red axis runs along the normal', () => {
      const doc = newDocument();
      const anchor = vec3(0, 1, 1);
      const along = inferNear(doc, vec3(1.5, 1, 1), { anchor, normal: AXIS_X, planar: true });
      expect(along.label).not.toBe('On Red Axis');
      expect(inferNear(doc, vec3(1.5, 1, 1), { anchor, normal: AXIS_X, planar: false }).label).toBe(
        'On Red Axis',
      );
    });

    // Lines along the normal elsewhere drop to a single spot: the size would stick there while the marker floats above.
    it('leaves out the blue drawing axis', () => {
      const doc = newDocument();
      const anchor = vec3(2, 0, 0);
      expect(inferNear(doc, vec3(0, 0, 1), { anchor, normal: AXIS_Z, planar: false }).kind).toBe(
        'on-drawing-axis',
      );
      expect(inferNear(doc, vec3(0, 0, 1), { anchor, normal: AXIS_Z, planar: true }).kind).not.toBe(
        'on-drawing-axis',
      );
    });

    it('leaves out the blue From Point line of a remembered point', () => {
      const doc = newDocument();
      const anchor = vec3(2, 0, 0);
      const references = { points: [vec3(3, 1, 0)], edges: [] };
      const above = vec3(3, 1, 1);
      expect(inferNear(doc, above, { anchor, normal: AXIS_Z, planar: false, references }).kind).toBe(
        'from-point',
      );
      expect(inferNear(doc, above, { anchor, normal: AXIS_Z, planar: true, references }).kind).not.toBe(
        'from-point',
      );
    });

    it('leaves out a guide line standing up from the plane', () => {
      const doc = newDocument();
      doc.transact('Guide', () => addGuideLine(doc, doc.rootDefinitionId, vec3(3, 1, 0), AXIS_Z));
      const anchor = vec3(2, 0, 0);
      expect(inferNear(doc, vec3(3, 1, 1), { anchor, normal: AXIS_Z, planar: false }).label).toBe('On Guide');
      expect(inferNear(doc, vec3(3, 1, 1), { anchor, normal: AXIS_Z, planar: true }).label).not.toBe(
        'On Guide',
      );
    });
  });
});
