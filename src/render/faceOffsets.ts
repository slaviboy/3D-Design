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

/*
 * Polygon offsets for surfaces drawn in the same place, nearest first: edges (none), the front sides of faces, their
 * back sides, and the ground that catches shadows.
 *
 * Front sides sit just behind their own edges. Back sides sit a few depth steps further back. Where one face's front
 * side and another face's back side lie closer together than the depth buffer can tell apart (a box pushed almost
 * flat, two shapes touching face to face), the front side then shows on every pixel. Otherwise rounding picks one or
 * the other pixel by pixel, and the faces flicker as the view moves. Only the constant part differs: an offset that
 * grows with a face's slope would, at grazing angles, let a front side well behind a back side show through it.
 */

export const FRONT_FACE_OFFSET = {
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
} as const;

export const BACK_FACE_OFFSET = {
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 5,
} as const;

/** Behind everything drawn at its height, the back sides of faces lying on the ground included. */
export const GROUND_RECEIVER_OFFSET = {
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 9,
} as const;
