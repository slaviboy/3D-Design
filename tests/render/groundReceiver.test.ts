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
import { groundReceiverHeight } from '../../src/render/shadows/groundReceiver';

describe('groundReceiverHeight', () => {
  it('stays below the ground for a model that sits on it', () => {
    expect(groundReceiverHeight(20, 0)).toBeLessThan(0);
    expect(groundReceiverHeight(20, 1.5)).toBeLessThan(0);
  });

  it('drops below a model that reaches under the ground', () => {
    // A foundation slab to −0.3 m and a terrace sunk to −0.16: the receiver clears both.
    expect(groundReceiverHeight(22, -0.3)).toBeLessThan(-0.3);
    expect(groundReceiverHeight(22, -0.3)).toBeGreaterThan(-0.32);
  });

  it('keeps a margin that scales with the model but stays invisible', () => {
    const smallSink = -groundReceiverHeight(5, 0);
    const siteSink = -groundReceiverHeight(500, 0);
    expect(siteSink).toBeGreaterThan(smallSink);
    expect(smallSink).toBeGreaterThan(0);
    expect(siteSink).toBeLessThan(0.2);
  });

  it('falls back to just below the ground when the extent is unusable', () => {
    expect(groundReceiverHeight(0, Number.NaN)).toBe(-0.001);
    expect(groundReceiverHeight(Number.NaN, Number.NaN)).toBe(-0.001);
  });
});
