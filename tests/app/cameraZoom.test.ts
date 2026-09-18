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
  cameraBasis,
  cameraDistance,
  DEFAULT_CAMERA,
  projectToScreen,
  zoom,
  zoomFocusInEmptySpace,
  zoomLimits,
  type CameraState,
} from '../../src/app/camera/camera';
import type { Aabb } from '../../src/kernel/math/aabb';
import { distance, dot, sub, vec3 } from '../../src/kernel/math/vec3';
import { VIEW_SIZE } from './fixtures';

/** A house-sized model at the origin. */
const MODEL: Aabb = { minX: -5, minY: -4, minZ: 0, maxX: 5, maxY: 4, maxZ: 3 };
const LIMITS = zoomLimits(MODEL);
const CENTER = vec3(0, 0, 1.5);
const PERSPECTIVE: CameraState = { ...DEFAULT_CAMERA, eye: vec3(14, -18, 11), target: CENTER };
const PARALLEL: CameraState = { ...PERSPECTIVE, projection: 'parallel', orthoHalfHeight: 8 };

/** One wheel notch, as the tool manager computes it. */
const NOTCH_IN = Math.exp(100 * 0.0015);
const NOTCH_OUT = 1 / NOTCH_IN;

/** A screen the size of a real viewport, so pixel counts mean something. */
const SCREEN = { width: 1200, height: 800 };

function zoomRepeatedly(camera: CameraState, factor: number, times: number, focus = CENTER): CameraState {
  let current = camera;
  for (let i = 0; i < times; i++) current = zoom(current, factor, focus, LIMITS);
  return current;
}

/** How tall the model is on screen, which is what "zoomed too far out" really means. */
function modelHeightPx(camera: CameraState): number {
  const top = projectToScreen(camera, vec3(0, 0, 3), SCREEN);
  const bottom = projectToScreen(camera, vec3(0, 0, 0), SCREEN);
  return top && bottom ? Math.abs(top.y - bottom.y) : 0;
}

describe('zoom limits', () => {
  it('stops before the camera reaches what it is zooming at', () => {
    const camera = zoomRepeatedly(PERSPECTIVE, NOTCH_IN, 400);
    expect(cameraDistance(camera)).toBeGreaterThanOrEqual(LIMITS.minDistance * 0.999);
    // The eye stays on its own side of the pivot instead of flying through it.
    const { forward } = cameraBasis(camera);
    expect(dot(sub(CENTER, camera.eye), forward)).toBeGreaterThan(0);
    expect(Number.isFinite(camera.eye.x)).toBe(true);
  });

  it('stops while the model is still on screen when zooming out', () => {
    const camera = zoomRepeatedly(PERSPECTIVE, NOTCH_OUT, 400);
    expect(cameraDistance(camera)).toBeLessThanOrEqual(LIMITS.maxDistance * 1.001);
    expect(modelHeightPx(camera)).toBeGreaterThan(3);
  });

  it('keeps the half-height inside the same limits in parallel projection', () => {
    expect(zoomRepeatedly(PARALLEL, NOTCH_IN, 400).orthoHalfHeight).toBeGreaterThanOrEqual(
      LIMITS.minDistance * 0.999,
    );
    expect(zoomRepeatedly(PARALLEL, NOTCH_OUT, 400).orthoHalfHeight).toBeLessThanOrEqual(
      LIMITS.maxDistance * 1.001,
    );
  });

  it('zooms in and back out to where it started', () => {
    const zoomedIn = zoomRepeatedly(PERSPECTIVE, NOTCH_IN, 10);
    const returned = zoomRepeatedly(zoomedIn, NOTCH_OUT, 10);
    expect(distance(returned.eye, PERSPECTIVE.eye)).toBeLessThan(1e-9);
  });
});

describe('zoom focus with nothing under the cursor', () => {
  const screenOfPoint = (camera: CameraState, point: ReturnType<typeof vec3>) => {
    const screen = projectToScreen(camera, point, VIEW_SIZE);
    if (!screen) throw new Error('point should be visible');
    return screen;
  };

  it('uses the model depth for a cursor just off the model', () => {
    // Just beside the roof: no geometry under the cursor, but the ray still passes close to the model.
    const screen = screenOfPoint(PERSPECTIVE, vec3(6, 0, 4));
    const focus = zoomFocusInEmptySpace(PERSPECTIVE, screen, VIEW_SIZE, MODEL);
    expect(focus).not.toEqual(PERSPECTIVE.target);
    const depthRatio = distance(focus, PERSPECTIVE.eye) / distance(CENTER, PERSPECTIVE.eye);
    expect(depthRatio).toBeGreaterThan(0.9);
    expect(depthRatio).toBeLessThan(1.1);
  });

  it('falls back to the view center when the cursor points well away from the model', () => {
    // A narrow view of a distant model: the corner ray misses it by many radii.
    const distant: CameraState = { ...PERSPECTIVE, eye: vec3(600, -800, 500), fovDegrees: 60 };
    expect(zoomFocusInEmptySpace(distant, { x: 4, y: 4 }, VIEW_SIZE, MODEL)).toEqual(distant.target);
  });

  it('magnifies no faster than zooming straight at the model, and never flies past it', () => {
    const before = modelHeightPx(PERSPECTIVE);
    const atModel = zoomRepeatedly(PERSPECTIVE, NOTCH_IN, 12, CENTER);
    const offModel = zoomRepeatedly(
      PERSPECTIVE,
      NOTCH_IN,
      12,
      zoomFocusInEmptySpace(PERSPECTIVE, { x: 4, y: 4 }, VIEW_SIZE, MODEL),
    );
    const atModelGrowth = modelHeightPx(atModel) / before;
    const offModelGrowth = modelHeightPx(offModel) / before;
    expect(offModelGrowth).toBeLessThanOrEqual(atModelGrowth * 1.2);
    // The camera keeps its distance instead of shooting past the model to the far side.
    expect(distance(offModel.eye, CENTER)).toBeGreaterThanOrEqual(distance(atModel.eye, CENTER) * 0.9);
  });

  it('returns the view center for an empty model', () => {
    const empty: Aabb = { minX: 1, minY: 1, minZ: 1, maxX: -1, maxY: -1, maxZ: -1 };
    expect(zoomFocusInEmptySpace(PERSPECTIVE, { x: 100, y: 100 }, VIEW_SIZE, empty)).toEqual(
      PERSPECTIVE.target,
    );
  });
});
