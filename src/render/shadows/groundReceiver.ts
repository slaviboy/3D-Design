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

/**
 * How far below z = 0 the ground shadow receiver sits, for a model of this radius.
 *
 * Slabs, terraces and floors usually have a face exactly at z = 0. A receiver in that same plane fights with them,
 * and the ground flickers wherever the two meet as the camera moves, so the receiver is sunk just below it. The
 * offset stays far too small to see: a millimeter for a room, a centimeter for a whole site.
 */
export function groundReceiverDepth(radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) return MIN_GROUND_SINK;
  return Math.max(MIN_GROUND_SINK, radius * GROUND_SINK_FRACTION);
}
