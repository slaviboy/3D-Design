import { EPS_LEN } from '../tolerance';

/** Immutable 3D vector or point in model space (float64 meters). */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export const ZERO: Vec3 = vec3(0, 0, 0);
export const AXIS_X: Vec3 = vec3(1, 0, 0);
export const AXIS_Y: Vec3 = vec3(0, 1, 0);
export const AXIS_Z: Vec3 = vec3(0, 0, 1);

export function add(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(v: Vec3, s: number): Vec3 {
  return vec3(v.x * s, v.y * s, v.z * s);
}

export function negate(v: Vec3): Vec3 {
  return vec3(-v.x, -v.y, -v.z);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

export function lengthSquared(v: Vec3): number {
  return dot(v, v);
}

export function length(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

export function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(distanceSquared(a, b));
}

/** Linear interpolation: `a + (b - a) * t`. */
export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

/** Unit vector in the direction of `v`, or `null` when `v` has zero or non-finite length. */
export function normalize(v: Vec3): Vec3 | null {
  const len = length(v);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  return scale(v, 1 / len);
}

export function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** True when two points are within {@link EPS_LEN} of each other. */
export function pointsCoincide(a: Vec3, b: Vec3): boolean {
  return distanceSquared(a, b) <= EPS_LEN * EPS_LEN;
}

/** Any unit vector perpendicular to the unit vector `n`, chosen deterministically. */
export function anyPerpendicular(n: Vec3): Vec3 {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  // Cross with the world axis least aligned with n, which keeps the result well conditioned.
  const reference = ax <= ay && ax <= az ? AXIS_X : ay <= az ? AXIS_Y : AXIS_Z;
  const perpendicular = normalize(cross(reference, n));
  if (!perpendicular) throw new Error('anyPerpendicular: input must be a non-zero vector');
  return perpendicular;
}
