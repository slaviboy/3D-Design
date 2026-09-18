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
import { axisReach } from '../../src/render/axes';

describe('axisReach', () => {
  it('runs past the far plane and the width of the view', () => {
    const reach = axisReach({ eyeToOrigin: 20, targetToOrigin: 5, far: 100, viewRadius: 40 });
    expect(reach).toBeGreaterThan(100 + 40);
  });

  it('follows a wide parallel view, where the far plane says nothing about the visible width', () => {
    // Zoomed out in parallel projection: the eye stays put while the view covers kilometres.
    const narrow = axisReach({ eyeToOrigin: 15, targetToOrigin: 0, far: 100, viewRadius: 10 });
    const wide = axisReach({ eyeToOrigin: 15, targetToOrigin: 0, far: 100, viewRadius: 8500 });
    expect(wide).toBeGreaterThan(8500);
    expect(wide).toBeGreaterThan(narrow * 10);
  });

  it('covers axes left far off to the side by panning', () => {
    const reach = axisReach({ eyeToOrigin: 2000, targetToOrigin: 1990, far: 4000, viewRadius: 40 });
    expect(reach).toBeGreaterThan(2000 + 4000);
  });

  it('ignores values that are not usable numbers', () => {
    expect(axisReach({ eyeToOrigin: NaN, targetToOrigin: -5, far: 100, viewRadius: Infinity })).toBe(200);
  });
});
