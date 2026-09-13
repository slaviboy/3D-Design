import { IDENTITY, invertAffine, multiply, scaling, type Mat4 } from '../../kernel/math/mat4';
import { vec3 } from '../../kernel/math/vec3';

/*
 * Unit and axis conversion between a file's coordinates and Planar's (meters, Z up). A conversion S is a uniform
 * scale times an axis rotation, so geometry is converted with S·p and a node transform T with S·T·S⁻¹, which keeps
 * rotations rigid and scales translations along with the geometry.
 */

/** Maps Y-up coordinates to Z-up: (x, y, z) → (x, −z, y). A rotation of +90° about X. */
export const Y_UP_TO_Z_UP: Mat4 = Object.freeze([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);

/** Maps Z-up coordinates to Y-up: (x, y, z) → (x, z, −y). The inverse of {@link Y_UP_TO_Z_UP}. */
export const Z_UP_TO_Y_UP: Mat4 = Object.freeze([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);

export interface Conversion {
  readonly matrix: Mat4;
  readonly inverse: Mat4;
}

function conversion(matrix: Mat4): Conversion {
  const inverse = invertAffine(matrix);
  if (!inverse) throw new Error('The unit scale must be a positive number');
  return { matrix, inverse };
}

/** File coordinates → model coordinates: multiply by `unitMeters`, then optionally turn Y-up into Z-up. */
export function importConversion(unitMeters: number, swapYUpToZUp: boolean): Conversion {
  if (!(unitMeters > 0) || !Number.isFinite(unitMeters))
    throw new Error('The unit scale must be a positive number');
  const scale = scaling(vec3(unitMeters, unitMeters, unitMeters));
  return conversion(swapYUpToZUp ? multiply(Y_UP_TO_Z_UP, scale) : scale);
}

/** Model coordinates → file coordinates: divide by `unitMeters`, then optionally turn Z-up into Y-up. */
export function exportConversion(unitMeters: number, swapZUpToYUp: boolean): Conversion {
  if (!(unitMeters > 0) || !Number.isFinite(unitMeters))
    throw new Error('The unit scale must be a positive number');
  const factor = 1 / unitMeters;
  const scale = scaling(vec3(factor, factor, factor));
  return conversion(swapZUpToYUp ? multiply(Z_UP_TO_Y_UP, scale) : scale);
}

/** A transform expressed in the converted coordinates: S·T·S⁻¹. */
export function convertTransform(conversionValue: Conversion, transform: Mat4): Mat4 {
  return multiply(conversionValue.matrix, multiply(transform, conversionValue.inverse));
}

export function isIdentity(transform: readonly number[], tolerance = 1e-12): boolean {
  return (
    transform.length === 16 &&
    transform.every((value, i) => Math.abs(value - (IDENTITY[i] ?? 0)) <= tolerance)
  );
}
