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

/**
 * Geometric tolerances for the Planar kernel.
 *
 * Model coordinates are float64 meters. This module is the only place tolerance values are defined,
 * and every geometric predicate in the kernel must use it. GEOMETRY.md ("Tolerances") explains how
 * the values were chosen.
 */

/** Two points closer than this distance (1 micron) are the same point. */
export const EPS_LEN = 1e-6;

/** Two unit directions whose cross product has a magnitude below this value are parallel. */
export const EPS_PARALLEL = 1e-7;

/** A stored unit direction is valid when its length differs from 1 by no more than this value. */
export const EPS_UNIT_LENGTH = 1e-9;

/** Regions with an absolute area below this value are degenerate. */
export const EPS_AREA = EPS_LEN * EPS_LEN;

/** Edges shorter than this are still valid, but the user gets a warning about very small geometry. */
export const SMALL_EDGE_WARNING_LEN = 10 * EPS_LEN;

/**
 * How far a vertex coming back from a triangle mesh (for example a boolean result, which is computed in single
 * precision) may lie from the plane of the face it came from and still be snapped back onto that plane.
 */
export const EPS_MESH_SNAP = 100 * EPS_LEN;

/** Cell size of the vertex welding hash grid. Must be at least 2 × EPS_LEN so a weld query spans at most 2 cells per axis. */
export const WELD_GRID_CELL_SIZE = 4 * EPS_LEN;

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
