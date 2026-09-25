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

import { aabbIsEmpty, type Aabb } from '../../kernel/math/aabb';
import {
  add,
  AXIS_Y,
  AXIS_Z,
  cross,
  dot,
  length,
  negate,
  normalize,
  scale,
  sub,
  vec3,
  ZERO,
  type Vec3,
} from '../../kernel/math/vec3';

/*
 * Camera model and navigation math. Pure functions over an immutable CameraState; the renderer builds its
 * three.js camera from the state, and picking builds rays from the same state, so both always agree.
 * The world is Z-up, matching the kernel.
 */

export type Projection = 'perspective' | 'parallel';
export type StandardView = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';

export interface CameraState {
  readonly eye: Vec3;
  /** Point the camera looks at; also the orbit pivot. */
  readonly target: Vec3;
  /** Screen-up direction hint. World Z except for top and bottom views. */
  readonly up: Vec3;
  /** Vertical field of view for perspective projection. */
  readonly fovDegrees: number;
  readonly projection: Projection;
  /** Half the visible height at the target for parallel projection, in meters. */
  readonly orthoHalfHeight: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScreenProjection extends ScreenPoint {
  /** Distance in front of the camera along the view direction. */
  readonly depth: number;
}

export interface Ray {
  readonly origin: Vec3;
  /** Unit direction, so the ray parameter is a distance in meters. */
  readonly direction: Vec3;
}

export const DEFAULT_FOV_DEGREES = 35;
export const MIN_FOV_DEGREES = 1;
export const MAX_FOV_DEGREES = 120;

/** Orbiting stops just short of the poles so vertical edges stay vertical on screen. */
const MAX_ELEVATION_RADIANS = (89.9 * Math.PI) / 180;
const MIN_CAMERA_DISTANCE = 1e-3;
const MIN_ORTHO_HALF_HEIGHT = 1e-4;
/** Zoom Extents leaves this much room around the model's bounding sphere. */
const EXTENTS_MARGIN = 1.1;
/** Minimum radius used when fitting an empty or point-like model. */
const MIN_FIT_RADIUS = 1;
/** Parallel-projection rays start this far behind the eye so everything visible lies in front of them. */
const PARALLEL_RAY_BACKOFF = 1e5;
/** Points closer than this to the eye plane are not projected in perspective. */
const MIN_PROJECTION_DEPTH = 1e-6;

export const DEFAULT_CAMERA: CameraState = Object.freeze({
  eye: vec3(12, -16, 10),
  target: ZERO,
  up: AXIS_Z,
  fovDegrees: DEFAULT_FOV_DEGREES,
  projection: 'perspective',
  orthoHalfHeight: 8,
});

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export interface CameraBasis {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

export function cameraBasis(camera: CameraState): CameraBasis {
  const forward = normalize(sub(camera.target, camera.eye)) ?? vec3(0, 1, 0);
  const right = normalize(cross(forward, camera.up)) ?? normalize(cross(forward, AXIS_Y)) ?? vec3(1, 0, 0);
  return { forward, right, up: cross(right, forward) };
}

export function cameraDistance(camera: CameraState): number {
  return length(sub(camera.eye, camera.target));
}

export function aspectRatio(size: ViewportSize): number {
  return size.height > 0 ? size.width / size.height : 1;
}

/** Meters covered by one screen pixel at `point`'s depth. */
export function worldUnitsPerPixel(camera: CameraState, point: Vec3, size: ViewportSize): number {
  const height = Math.max(size.height, 1);
  if (camera.projection === 'parallel') return (2 * camera.orthoHalfHeight) / height;
  const depth = Math.max(dot(sub(point, camera.eye), cameraBasis(camera).forward), MIN_CAMERA_DISTANCE);
  return (2 * depth * Math.tan(toRadians(camera.fovDegrees) / 2)) / height;
}

/** Rotates the camera around its target: `yaw` about world Z, `pitch` up or down, clamped at the poles. */
export function orbit(camera: CameraState, yaw: number, pitch: number): CameraState {
  const offset = sub(camera.eye, camera.target);
  const distance = Math.max(length(offset), MIN_CAMERA_DISTANCE);
  const horizontal = Math.hypot(offset.x, offset.y);
  // Looking straight down or up, the azimuth is undefined; derive it from the screen-up direction instead.
  const azimuth =
    (horizontal > distance * 1e-9 ? Math.atan2(offset.y, offset.x) : Math.atan2(-camera.up.y, -camera.up.x)) +
    yaw;
  const elevation = clamp(
    Math.asin(clamp(offset.z / distance, -1, 1)) + pitch,
    -MAX_ELEVATION_RADIANS,
    MAX_ELEVATION_RADIANS,
  );
  const eye = add(
    camera.target,
    vec3(
      distance * Math.cos(elevation) * Math.cos(azimuth),
      distance * Math.cos(elevation) * Math.sin(azimuth),
      distance * Math.sin(elevation),
    ),
  );
  return { ...camera, eye, up: AXIS_Z };
}

/** Moves the camera parallel to the screen so the content follows a drag of (dx, dy) pixels. */
export function pan(camera: CameraState, dx: number, dy: number, size: ViewportSize): CameraState {
  const { right, up } = cameraBasis(camera);
  const perPixel = worldUnitsPerPixel(camera, camera.target, size);
  const offset = add(scale(right, -dx * perPixel), scale(up, dy * perPixel));
  return { ...camera, eye: add(camera.eye, offset), target: add(camera.target, offset) };
}

/**
 * How far the camera may go while zooming. Zooming in stops before the camera reaches what it is zooming at, and
 * zooming out stops while the model is still on screen, so the wheel can't strand the view in empty space.
 * In parallel projection the same two numbers bound the half-height of the view.
 */
export interface ZoomLimits {
  readonly minDistance: number;
  readonly maxDistance: number;
}

/** Closest approach as a fraction of the model's radius; also keeps the model clear of the near plane. */
const MIN_ZOOM_RADIUS_FRACTION = 1 / 2000;
/** Farthest distance as a multiple of the model's radius; beyond this the model is a speck in an empty view. */
const MAX_ZOOM_RADIUS_MULTIPLE = 100;
/** With nothing under the cursor, zoom toward the model while the cursor ray passes within this many radii. */
const EMPTY_SPACE_FOCUS_RADII = 2;

/** The bounding sphere radius of `bounds`, never smaller than {@link MIN_FIT_RADIUS}. */
function boundsRadius(bounds: Aabb): number {
  if (aabbIsEmpty(bounds)) return MIN_FIT_RADIUS;
  const diagonal = vec3(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ);
  return Math.max(length(diagonal) / 2, MIN_FIT_RADIUS);
}

/** Zoom limits for a model of this size. */
export function zoomLimits(bounds: Aabb): ZoomLimits {
  const radius = boundsRadius(bounds);
  return {
    minDistance: Math.max(MIN_CAMERA_DISTANCE, radius * MIN_ZOOM_RADIUS_FRACTION),
    maxDistance: radius * MAX_ZOOM_RADIUS_MULTIPLE,
  };
}

/**
 * Where to zoom when nothing is under the cursor. While the cursor ray passes near the model, the pivot is the point
 * of the ray closest to it, which magnifies around the cursor without throwing the camera past the model; pointing
 * further away zooms toward the view center instead.
 */
export function zoomFocusInEmptySpace(
  camera: CameraState,
  screen: ScreenPoint,
  size: ViewportSize,
  bounds: Aabb,
): Vec3 {
  if (aabbIsEmpty(bounds)) return camera.target;
  const center = vec3(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  );
  const ray = rayThroughScreen(camera, screen, size);
  const along = dot(sub(center, ray.origin), ray.direction);
  if (along <= 0) return camera.target;
  const closest = add(ray.origin, scale(ray.direction, along));
  const missBy = length(sub(closest, center));
  return missBy <= boundsRadius(bounds) * EMPTY_SPACE_FOCUS_RADII ? closest : camera.target;
}

/**
 * Zooms by `factor` (> 1 zooms in) toward `focus`, keeping the focus point at the same place on screen.
 * Without a focus the view center is used. `limits` bounds how close and how far the zoom may reach.
 */
export function zoom(
  camera: CameraState,
  factor: number,
  focus: Vec3 | null,
  limits: ZoomLimits | null = null,
): CameraState {
  if (!(factor > 0) || !Number.isFinite(factor)) return camera;
  const pivot = focus ?? camera.target;
  if (camera.projection === 'parallel') {
    const smallest = Math.max(limits?.minDistance ?? MIN_ORTHO_HALF_HEIGHT, MIN_ORTHO_HALF_HEIGHT);
    const largest = Math.max(limits?.maxDistance ?? Infinity, smallest);
    const orthoHalfHeight = clamp(camera.orthoHalfHeight / factor, smallest, largest);
    if (orthoHalfHeight === camera.orthoHalfHeight) return camera;
    const { forward } = cameraBasis(camera);
    const toPivot = sub(pivot, camera.target);
    const lateral = sub(toPivot, scale(forward, dot(toPivot, forward)));
    const shift = scale(lateral, 1 - orthoHalfHeight / camera.orthoHalfHeight);
    return { ...camera, orthoHalfHeight, eye: add(camera.eye, shift), target: add(camera.target, shift) };
  }
  // A homothety scales both the eye-to-target and the eye-to-pivot distance by 1 / factor, so the factor itself is
  // clamped: the closer of the two may not pass `minDistance`, and the target may not go beyond `maxDistance`.
  const applied = limits ? clampZoomFactor(camera, factor, pivot, limits) : factor;
  if (applied === 1) return camera;
  const eye = add(pivot, scale(sub(camera.eye, pivot), 1 / applied));
  const target = add(pivot, scale(sub(camera.target, pivot), 1 / applied));
  return length(sub(eye, target)) < MIN_CAMERA_DISTANCE ? camera : { ...camera, eye, target };
}

function clampZoomFactor(camera: CameraState, factor: number, pivot: Vec3, limits: ZoomLimits): number {
  const toTarget = length(sub(camera.eye, camera.target));
  const toPivot = length(sub(camera.eye, pivot));
  const nearest = Math.min(toTarget, toPivot > 0 ? toPivot : Infinity);
  // Zooming in is capped where the nearest of the two reaches minDistance, zooming out where the target reaches
  // maxDistance. A view already past a limit simply stays where it is instead of being pulled back.
  const zoomingIn = Math.max(nearest / limits.minDistance, 1);
  const zoomingOut = Math.min(toTarget / limits.maxDistance, 1);
  return clamp(factor, zoomingOut, zoomingIn);
}

/** Keeps the view direction and frames `bounds` in the viewport. */
export function zoomToBounds(camera: CameraState, bounds: Aabb, size: ViewportSize): CameraState {
  if (aabbIsEmpty(bounds)) return camera;
  const center = vec3(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  );
  const radius = Math.max(
    length(vec3(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ)) / 2,
    MIN_FIT_RADIUS,
  );
  const { forward } = cameraBasis(camera);
  const aspect = aspectRatio(size);
  if (camera.projection === 'parallel') {
    const orthoHalfHeight = (radius * EXTENTS_MARGIN) / Math.min(1, aspect);
    const distance = Math.max(cameraDistance(camera), radius * 3);
    return { ...camera, target: center, eye: sub(center, scale(forward, distance)), orthoHalfHeight };
  }
  const halfVertical = toRadians(camera.fovDegrees) / 2;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  const distance = (radius * EXTENTS_MARGIN) / Math.sin(Math.min(halfVertical, halfHorizontal));
  return { ...camera, target: center, eye: sub(center, scale(forward, distance)) };
}

const STANDARD_VIEWS: Readonly<Record<StandardView, { readonly toEye: Vec3; readonly up: Vec3 }>> = {
  top: { toEye: AXIS_Z, up: AXIS_Y },
  bottom: { toEye: negate(AXIS_Z), up: AXIS_Y },
  front: { toEye: vec3(0, -1, 0), up: AXIS_Z },
  back: { toEye: AXIS_Y, up: AXIS_Z },
  left: { toEye: vec3(-1, 0, 0), up: AXIS_Z },
  right: { toEye: vec3(1, 0, 0), up: AXIS_Z },
  iso: { toEye: normalize(vec3(1, -1, 1)) ?? AXIS_Z, up: AXIS_Z },
};

/** Looks at the model from a standard direction, framing `bounds` when given. */
export function standardView(
  camera: CameraState,
  view: StandardView,
  bounds: Aabb | null,
  size: ViewportSize,
): CameraState {
  const { toEye, up } = STANDARD_VIEWS[view];
  const distance = Math.max(cameraDistance(camera), MIN_CAMERA_DISTANCE);
  const oriented: CameraState = { ...camera, eye: add(camera.target, scale(toEye, distance)), up };
  return bounds && !aabbIsEmpty(bounds) ? zoomToBounds(oriented, bounds, size) : oriented;
}

/** Switches projection while keeping the model at the same apparent size at the target. */
export function setProjection(camera: CameraState, projection: Projection): CameraState {
  if (camera.projection === projection) return camera;
  const halfFov = Math.tan(toRadians(camera.fovDegrees) / 2);
  if (projection === 'parallel') {
    return {
      ...camera,
      projection,
      orthoHalfHeight: Math.max(cameraDistance(camera) * halfFov, MIN_ORTHO_HALF_HEIGHT),
    };
  }
  const { forward } = cameraBasis(camera);
  const distance = Math.max(camera.orthoHalfHeight / halfFov, MIN_CAMERA_DISTANCE);
  return { ...camera, projection, eye: sub(camera.target, scale(forward, distance)) };
}

export function setFieldOfView(camera: CameraState, fovDegrees: number): CameraState {
  return { ...camera, fovDegrees: clamp(fovDegrees, MIN_FOV_DEGREES, MAX_FOV_DEGREES) };
}

function toNdc(screen: ScreenPoint, size: ViewportSize): { x: number; y: number } {
  return {
    x: (2 * screen.x) / Math.max(size.width, 1) - 1,
    y: 1 - (2 * screen.y) / Math.max(size.height, 1),
  };
}

/** The world-space ray through a screen point (CSS pixels from the viewport's top-left corner). */
export function rayThroughScreen(camera: CameraState, screen: ScreenPoint, size: ViewportSize): Ray {
  const ndc = toNdc(screen, size);
  const { forward, right, up } = cameraBasis(camera);
  const aspect = aspectRatio(size);
  if (camera.projection === 'parallel') {
    const lateral = add(
      scale(right, ndc.x * camera.orthoHalfHeight * aspect),
      scale(up, ndc.y * camera.orthoHalfHeight),
    );
    return {
      origin: sub(add(camera.eye, lateral), scale(forward, PARALLEL_RAY_BACKOFF)),
      direction: forward,
    };
  }
  const tanHalf = Math.tan(toRadians(camera.fovDegrees) / 2);
  const direction =
    normalize(add(forward, add(scale(right, ndc.x * tanHalf * aspect), scale(up, ndc.y * tanHalf)))) ??
    forward;
  return { origin: camera.eye, direction };
}

/**
 * The ray from the camera through a world point, and the point's distance along it. Perspective rays start at the eye;
 * parallel rays start behind the eye along the view direction, as in {@link rayThroughScreen}, so distances along
 * either kind of ray compare with pick distances. Null when the point is behind a perspective camera.
 */
export function rayToPoint(
  camera: CameraState,
  point: Vec3,
): { readonly ray: Ray; readonly t: number } | null {
  const { forward } = cameraBasis(camera);
  const offset = sub(point, camera.eye);
  if (camera.projection === 'parallel') {
    const t = dot(offset, forward) + PARALLEL_RAY_BACKOFF;
    return t > 0 ? { ray: { origin: sub(point, scale(forward, t)), direction: forward }, t } : null;
  }
  const t = length(offset);
  if (dot(offset, forward) <= MIN_PROJECTION_DEPTH || t <= MIN_PROJECTION_DEPTH) return null;
  return { ray: { origin: camera.eye, direction: scale(offset, 1 / t) }, t };
}

/** Screen position of a world point, or null when it is behind a perspective camera. */
export function projectToScreen(
  camera: CameraState,
  point: Vec3,
  size: ViewportSize,
): ScreenProjection | null {
  const { forward, right, up } = cameraBasis(camera);
  const relative = sub(point, camera.eye);
  const depth = dot(relative, forward);
  const aspect = aspectRatio(size);
  let ndcX: number;
  let ndcY: number;
  if (camera.projection === 'parallel') {
    ndcX = dot(relative, right) / (camera.orthoHalfHeight * aspect);
    ndcY = dot(relative, up) / camera.orthoHalfHeight;
  } else {
    if (depth <= MIN_PROJECTION_DEPTH) return null;
    const tanHalf = Math.tan(toRadians(camera.fovDegrees) / 2);
    ndcX = dot(relative, right) / (depth * tanHalf * aspect);
    ndcY = dot(relative, up) / (depth * tanHalf);
  }
  return { x: ((ndcX + 1) / 2) * size.width, y: ((1 - ndcY) / 2) * size.height, depth };
}

/** Where the ray through a screen point meets the plane through the target facing the camera. */
export function pointOnTargetPlane(camera: CameraState, screen: ScreenPoint, size: ViewportSize): Vec3 {
  const ray = rayThroughScreen(camera, screen, size);
  const { forward } = cameraBasis(camera);
  const denominator = dot(ray.direction, forward);
  if (Math.abs(denominator) < 1e-12) return camera.target;
  const t = dot(sub(camera.target, ray.origin), forward) / denominator;
  return add(ray.origin, scale(ray.direction, t));
}
