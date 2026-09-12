import { describe, expect, it } from 'vitest';
import {
  cameraBasis,
  cameraDistance,
  DEFAULT_CAMERA,
  MAX_FOV_DEGREES,
  MIN_FOV_DEGREES,
  orbit,
  pan,
  pointOnTargetPlane,
  projectToScreen,
  rayThroughScreen,
  setFieldOfView,
  setProjection,
  standardView,
  worldUnitsPerPixel,
  zoom,
  zoomToBounds,
  type CameraState,
} from '../../src/app/camera/camera';
import { aabbCorners } from '../../src/app/geometry/bounds';
import { add, distance, dot, length, scale, sub, vec3 } from '../../src/kernel/math/vec3';
import { TOP_CAMERA, VIEW_SIZE } from './fixtures';

const PERSPECTIVE: CameraState = { ...DEFAULT_CAMERA, eye: vec3(10, -10, 6), target: vec3(0, 0, 1) };

function expectScreen(camera: CameraState, point: ReturnType<typeof vec3>, x: number, y: number): void {
  const screen = projectToScreen(camera, point, VIEW_SIZE);
  expect(screen?.x).toBeCloseTo(x, 6);
  expect(screen?.y).toBeCloseTo(y, 6);
}

describe('camera math', () => {
  it('builds an orthonormal basis looking at the target', () => {
    const { forward, right, up } = cameraBasis(PERSPECTIVE);
    expect(length(forward)).toBeCloseTo(1);
    expect(dot(forward, right)).toBeCloseTo(0);
    expect(dot(forward, up)).toBeCloseTo(0);
    expect(up.z).toBeGreaterThan(0);
  });

  it('projects and unprojects screen points consistently in both projections', () => {
    for (const camera of [PERSPECTIVE, TOP_CAMERA]) {
      const point = vec3(1.5, -0.5, 0.75);
      const screen = projectToScreen(camera, point, VIEW_SIZE);
      if (!screen) throw new Error('point should be visible');
      const ray = rayThroughScreen(camera, screen, VIEW_SIZE);
      const t = dot(sub(point, ray.origin), ray.direction);
      expect(distance(add(ray.origin, scale(ray.direction, t)), point)).toBeLessThan(1e-9);
    }
    expectScreen(TOP_CAMERA, vec3(0, 0, 0), 100, 100);
    expectScreen(TOP_CAMERA, vec3(1, 1, 0), 120, 80);
  });

  it('returns null for points behind a perspective camera', () => {
    expect(
      projectToScreen(PERSPECTIVE, add(PERSPECTIVE.eye, sub(PERSPECTIVE.eye, PERSPECTIVE.target)), VIEW_SIZE),
    ).toBeNull();
  });

  it('orbits around the target at a constant distance and stops short of the poles', () => {
    const turned = orbit(PERSPECTIVE, 0.7, 0.2);
    expect(cameraDistance(turned)).toBeCloseTo(cameraDistance(PERSPECTIVE));
    expect(turned.target).toEqual(PERSPECTIVE.target);
    const overTheTop = orbit(PERSPECTIVE, 0, 10);
    const elevation = Math.asin(sub(overTheTop.eye, overTheTop.target).z / cameraDistance(overTheTop));
    expect(elevation).toBeLessThan(Math.PI / 2);
    expect(elevation).toBeGreaterThan(Math.PI / 2 - 0.01);
  });

  it('keeps the screen orientation when orbiting away from a top view', () => {
    const tilted = orbit(TOP_CAMERA, 0, -0.3);
    // Screen-up was +Y, so tilting reveals the model from the -Y side.
    expect(tilted.eye.y).toBeLessThan(0);
    expect(Math.abs(tilted.eye.x)).toBeLessThan(1e-9);
  });

  it('pans so content follows the pointer', () => {
    const moved = pan(TOP_CAMERA, 20, 0, VIEW_SIZE);
    expectScreen(moved, vec3(0, 0, 0), 120, 100);
    expect(sub(moved.eye, moved.target)).toEqual(sub(TOP_CAMERA.eye, TOP_CAMERA.target));
  });

  it('zooms toward a focus point that stays fixed on screen', () => {
    const focus = vec3(0.5, 0.2, 1);
    for (const camera of [PERSPECTIVE, TOP_CAMERA]) {
      const before = projectToScreen(camera, focus, VIEW_SIZE);
      const zoomed = zoom(camera, 2, focus);
      const after = projectToScreen(zoomed, focus, VIEW_SIZE);
      expect(after?.x).toBeCloseTo(before?.x ?? 0, 6);
      expect(after?.y).toBeCloseTo(before?.y ?? 0, 6);
    }
    expect(zoom(TOP_CAMERA, 2, null).orthoHalfHeight).toBeCloseTo(2.5);
    expect(zoom(PERSPECTIVE, -1, null)).toBe(PERSPECTIVE);
  });

  it('fits bounds inside the viewport', () => {
    const bounds = { minX: -3, minY: -1, minZ: 0, maxX: 5, maxY: 2, maxZ: 4 };
    for (const camera of [PERSPECTIVE, TOP_CAMERA]) {
      const fitted = zoomToBounds(camera, bounds, { width: 300, height: 150 });
      for (const corner of aabbCorners(bounds)) {
        const screen = projectToScreen(fitted, corner, { width: 300, height: 150 });
        expect(screen).not.toBeNull();
        expect(screen?.x).toBeGreaterThanOrEqual(0);
        expect(screen?.x).toBeLessThanOrEqual(300);
        expect(screen?.y).toBeGreaterThanOrEqual(0);
        expect(screen?.y).toBeLessThanOrEqual(150);
      }
    }
  });

  it('moves to standard views', () => {
    const top = standardView(PERSPECTIVE, 'top', null, VIEW_SIZE);
    expect(cameraBasis(top).forward.z).toBeCloseTo(-1);
    const front = standardView(
      PERSPECTIVE,
      'front',
      { minX: -1, minY: -1, minZ: 0, maxX: 1, maxY: 1, maxZ: 2 },
      VIEW_SIZE,
    );
    expect(cameraBasis(front).forward.y).toBeCloseTo(1);
    expect(front.target).toEqual(vec3(0, 0, 1));
  });

  it('keeps apparent size when switching projection', () => {
    const parallel = setProjection(PERSPECTIVE, 'parallel');
    const target = PERSPECTIVE.target;
    expect(worldUnitsPerPixel(parallel, target, VIEW_SIZE)).toBeCloseTo(
      worldUnitsPerPixel(PERSPECTIVE, target, VIEW_SIZE),
    );
    const back = setProjection(parallel, 'perspective');
    expect(cameraDistance(back)).toBeCloseTo(cameraDistance(PERSPECTIVE));
    expect(setProjection(PERSPECTIVE, 'perspective')).toBe(PERSPECTIVE);
  });

  it('clamps the field of view and finds points on the target plane', () => {
    expect(setFieldOfView(PERSPECTIVE, 500).fovDegrees).toBe(MAX_FOV_DEGREES);
    expect(setFieldOfView(PERSPECTIVE, 0).fovDegrees).toBe(MIN_FOV_DEGREES);
    const center = pointOnTargetPlane(PERSPECTIVE, { x: 100, y: 100 }, VIEW_SIZE);
    expect(distance(center, PERSPECTIVE.target)).toBeLessThan(1e-9);
  });
});
