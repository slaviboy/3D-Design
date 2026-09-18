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

/** Sink as a fraction of the model's radius: enough to clear the depth buffer's resolution at that scale. */
const GROUND_SINK_FRACTION = 1e-4;
/** Never less than this, so a tiny model still separates the two planes. */
const MIN_GROUND_SINK = 1e-3;

/** How far the receiver sits below whatever it is put under, for a model of this radius. */
function sinkFor(radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) return MIN_GROUND_SINK;
  return Math.max(MIN_GROUND_SINK, radius * GROUND_SINK_FRACTION);
}

/**
 * Where the ground shadow receiver sits: just under the model's lowest geometry, and never above z = 0.
 *
 * The receiver only exists to catch shadows on empty ground — a slab or terrace catches its own, since faces
 * receive shadows too. Left level with the ground it fights whatever shares that height: terraces sunk a couple of
 * centimeters, paving at z = 0, the tops of foundations. Any of those makes a shadow flip on and off as the camera
 * moves. Putting the receiver below all of them ends that, and the drop is far too small to see.
 */
export function groundReceiverHeight(radius: number, modelMinZ: number): number {
  const base = Number.isFinite(modelMinZ) ? Math.min(0, modelMinZ) : 0;
  return base - sinkFor(radius);
}
