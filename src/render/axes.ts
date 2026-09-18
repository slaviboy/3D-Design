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

/** Distance from the camera to the drawing axes, and how much of the world the view covers. */
export interface AxisReachInput {
  /** Distance from the eye to the axes origin. */
  readonly eyeToOrigin: number;
  /** Distance from the view center to the axes origin: how far the axes are off to the side. */
  readonly targetToOrigin: number;
  /** The camera's far plane. */
  readonly far: number;
  /** Radius of the world the view covers: the half-height (times aspect) in parallel, the far plane otherwise. */
  readonly viewRadius: number;
}

/**
 * How far each drawing axis must run to leave the view in every direction, so the red, green and blue lines read as
 * infinite. Scaling them by the far plane alone is not enough: a line perpendicular to the view direction stays
 * within the far plane while running out of the frustum sideways, which is what makes the axes stop in mid-air when
 * the view is zoomed out (in parallel projection the visible width doesn't shrink the far plane at all).
 */
export function axisReach(input: AxisReachInput): number {
  const { eyeToOrigin, targetToOrigin, far, viewRadius } = input;
  const finite = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);
  return 2 * (Math.max(finite(eyeToOrigin), finite(targetToOrigin)) + finite(far) + finite(viewRadius));
}
