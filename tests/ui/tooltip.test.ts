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
import { TOOLTIP_DELAY_MS, tooltipPlacement } from '../../src/ui/common/Tooltip';

const VIEWPORT = { width: 1200, height: 800 };
const TIP = { width: 90, height: 24 };

describe('tooltipPlacement', () => {
  it('puts the tooltip beside a tool palette button, centered on it', () => {
    const button = { left: 6, top: 300, right: 38, bottom: 332 };
    const placement = tooltipPlacement(button, VIEWPORT, TIP);
    expect(placement.side).toBe('right');
    expect(placement.x).toBe(button.right + 8);
    expect(placement.y).toBe(316 - TIP.height / 2);
  });

  it('puts it below a toolbar button, centered on it', () => {
    const button = { left: 585, top: 36, right: 617, bottom: 68 };
    const placement = tooltipPlacement(button, VIEWPORT, TIP);
    expect(placement.side).toBe('below');
    expect(placement.x).toBe(601 - TIP.width / 2);
    expect(placement.y).toBe(button.bottom + 8);
  });

  it('keeps the tooltip inside the window', () => {
    const atRightEdge = tooltipPlacement({ left: 1170, top: 36, right: 1196, bottom: 68 }, VIEWPORT, TIP);
    expect(atRightEdge.x).toBeLessThanOrEqual(VIEWPORT.width - TIP.width - 8);
    const atBottom = tooltipPlacement({ left: 8, top: 760, right: 40, bottom: 792 }, VIEWPORT, TIP);
    expect(atBottom.y).toBeLessThanOrEqual(VIEWPORT.height - TIP.height - 8);
    expect(atBottom.x).toBeGreaterThanOrEqual(8);
  });

  it('waits only briefly before showing', () => {
    expect(TOOLTIP_DELAY_MS).toBeGreaterThan(0);
    expect(TOOLTIP_DELAY_MS).toBeLessThanOrEqual(400);
  });
});
