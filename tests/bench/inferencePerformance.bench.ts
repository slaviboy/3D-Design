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

import { describe, test } from 'vitest';
import type { CameraState, ViewportSize } from '../../src/app/camera/camera';
import { infer } from '../../src/app/inference/inference';
import type { DefinitionId } from '../../src/kernel/ids';
import type { Aabb } from '../../src/kernel/math/aabb';
import { IDENTITY } from '../../src/kernel/math/mat4';
import { AXIS_Z, vec3 } from '../../src/kernel/math/vec3';
import type { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { setStyleSettings } from '../../src/kernel/model/mutations';
import { boxGrid } from './models';

const RESULTS_DIRECTORY = 'bench/results';
const SIZE: ViewportSize = { width: 1280, height: 800 };
/** Pointer positions swept across the view, like a pointer crossing the model. */
const HOVERS = 64;

/** Looking at the grid from the front right, above, with the grid filling the view. */
function cameraFor(doc: ModelDocument): CameraState {
  const extent = Math.max(...[...doc.rootStore.vertices()].map((vertex) => vertex.position.x));
  return {
    eye: vec3(extent * 1.1, -extent * 0.4, extent * 0.6),
    target: vec3(extent / 2, extent / 2, 0),
    up: AXIS_Z,
    fovDegrees: 35,
    projection: 'perspective',
    orthoHalfHeight: 5,
  };
}

/** Infers at a sweep of pointer positions, sharing bounds as the editor does between pointer moves. */
function hoverSweep(doc: ModelDocument, camera: CameraState): void {
  const boundsCache = new Map<DefinitionId, Aabb>();
  for (let i = 0; i < HOVERS; i++) {
    const t = i / HOVERS;
    infer(doc, doc.rootDefinitionId, IDENTITY, {
      camera,
      size: SIZE,
      screen: { x: SIZE.width * (0.15 + 0.7 * t), y: SIZE.height * (0.3 + 0.4 * Math.sin(t * 7)) },
      boundsCache,
    });
  }
}

describe('inference performance', () => {
  for (const entities of [10_000, 100_000]) {
    const { doc } = boxGrid(entities);
    const camera = cameraFor(doc);

    test(`hover ${String(HOVERS)} times over ${String(entities)} entities, faces hiding what is behind`, async ({
      bench,
    }) => {
      await bench(
        `infer-hover-${String(entities)}`,
        { writeResult: `${RESULTS_DIRECTORY}/infer-hover-${String(entities)}.json` },
        () => {
          hoverSweep(doc, camera);
        },
      ).run();
    });

    test(`hover ${String(HOVERS)} times over ${String(entities)} entities in X-ray (no visibility tests)`, async ({
      bench,
    }) => {
      const xRay = boxGrid(entities).doc;
      xRay.transact('X-Ray', () => {
        setStyleSettings(xRay, { xRay: true });
      });
      await bench(
        `infer-hover-xray-${String(entities)}`,
        { writeResult: `${RESULTS_DIRECTORY}/infer-hover-xray-${String(entities)}.json` },
        () => {
          hoverSweep(xRay, camera);
        },
      ).run();
    });
  }
});
