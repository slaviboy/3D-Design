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
import { groundReceiverDepth } from '../../src/render/shadows/groundReceiver';

describe('groundReceiverDepth', () => {
  it('never leaves the receiver in the plane of the ground itself', () => {
    for (const radius of [0.5, 1, 10, 40, 500, 10_000]) {
      expect(groundReceiverDepth(radius)).toBeGreaterThan(0);
    }
  });

  it('grows with the model, so it clears the depth buffer on a large site', () => {
    expect(groundReceiverDepth(500)).toBeGreaterThan(groundReceiverDepth(40));
    expect(groundReceiverDepth(40)).toBeCloseTo(0.004, 6);
  });

  it('stays too small to see', () => {
    // A house-sized model sinks the receiver by a few millimeters, a large site by a centimeter.
    expect(groundReceiverDepth(20)).toBeLessThan(0.01);
    expect(groundReceiverDepth(1000)).toBeLessThan(0.2);
  });

  it('falls back to the minimum for a tiny or unusable radius', () => {
    expect(groundReceiverDepth(0)).toBe(0.001);
    expect(groundReceiverDepth(-5)).toBe(0.001);
    expect(groundReceiverDepth(Number.NaN)).toBe(0.001);
  });
});
