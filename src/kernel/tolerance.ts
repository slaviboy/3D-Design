/**
 * Geometric tolerances for the Planar kernel.
 *
 * Model coordinates are float64 meters. This module is the only place where tolerance values
 * are defined, and every geometric predicate in the kernel must use it. GEOMETRY.md ("Tolerances")
 * explains how the values were chosen.
 */

/** Two points closer than this distance (1 micron) are the same point. */
export const EPS_LEN = 1e-6;

/** Two unit directions whose cross product has a magnitude below this value are parallel. */
export const EPS_PARALLEL = 1e-7;

/** Edges shorter than this are still valid, but the user gets a warning about very small geometry. */
export const SMALL_EDGE_WARNING_LEN = 10 * EPS_LEN;

/** True when two lengths differ by no more than {@link EPS_LEN}. */
export function lengthsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS_LEN;
}

/** True when a length is too small to count as geometry. */
export function isNegligibleLength(length: number): boolean {
  return Math.abs(length) <= EPS_LEN;
}

/**
 * True when two unit directions are parallel or anti-parallel.
 * @param crossMagnitude magnitude of the cross product of the two unit vectors (the sine of the angle between them)
 */
export function isParallelBySine(crossMagnitude: number): boolean {
  return Math.abs(crossMagnitude) <= EPS_PARALLEL;
}
