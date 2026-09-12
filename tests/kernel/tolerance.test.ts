import { describe, expect, it } from 'vitest';
import {
  EPS_LEN,
  EPS_PARALLEL,
  SMALL_EDGE_WARNING_LEN,
  isNegligibleLength,
  isParallelBySine,
  lengthsEqual,
} from '../../src/kernel/tolerance';

describe('tolerance', () => {
  it('uses a micron length tolerance and a larger small-edge warning threshold', () => {
    expect(EPS_LEN).toBe(1e-6);
    expect(SMALL_EDGE_WARNING_LEN).toBeGreaterThan(EPS_LEN);
  });

  it('treats lengths within EPS_LEN as equal, inclusive of the boundary', () => {
    expect(lengthsEqual(1, 1 + EPS_LEN / 2)).toBe(true);
    expect(lengthsEqual(1, 1 + 2 * EPS_LEN)).toBe(false);
    expect(lengthsEqual(-3, -3)).toBe(true);
  });

  it('stays meaningful far from the origin (10 km)', () => {
    const far = 10_000;
    expect(lengthsEqual(far, far + EPS_LEN / 2)).toBe(true);
    expect(lengthsEqual(far, far + 3 * EPS_LEN)).toBe(false);
  });

  it('detects negligible lengths of either sign', () => {
    expect(isNegligibleLength(0)).toBe(true);
    expect(isNegligibleLength(-EPS_LEN)).toBe(true);
    expect(isNegligibleLength(2 * EPS_LEN)).toBe(false);
  });

  it('classifies parallel directions by the sine of their angle', () => {
    expect(isParallelBySine(0)).toBe(true);
    expect(isParallelBySine(-EPS_PARALLEL)).toBe(true);
    expect(isParallelBySine(Math.sin(1e-3))).toBe(false);
  });
});
