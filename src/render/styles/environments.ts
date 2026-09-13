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

import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/*
 * Environments generated in code: no image files are bundled or fetched. Each is a small equirectangular half-float
 * texture in three.js's Y-up convention; the background controller turns it so +Y becomes the model's blue axis.
 */

const WIDTH = 256;
const HEIGHT = 128;

type Rgb3 = readonly [number, number, number];

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const mix = (a: Rgb3, b: Rgb3, t: number): Rgb3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Unit direction (Y up) toward an azimuth and elevation in degrees. */
function toward(azimuthDegrees: number, elevationDegrees: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDegrees);
  const el = THREE.MathUtils.degToRad(elevationDegrees);
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
}

interface SoftLight {
  readonly direction: THREE.Vector3;
  /** Angular radius in radians. */
  readonly radius: number;
  readonly color: Rgb3;
}

function lightAt(direction: THREE.Vector3, light: SoftLight): number {
  const angle = Math.acos(Math.min(1, Math.max(-1, direction.dot(light.direction))));
  return 1 - smoothstep(light.radius * 0.55, light.radius, angle);
}

/** A bright, neutral studio: white ceiling, gray horizon, darker floor and three soft light panels. */
function studio(direction: THREE.Vector3): Rgb3 {
  const y = direction.y;
  const top: Rgb3 = [1.0, 0.98, 0.95];
  const horizon: Rgb3 = [0.72, 0.73, 0.75];
  const floor: Rgb3 = [0.26, 0.25, 0.24];
  let color =
    y >= 0 ? mix(horizon, top, smoothstep(0, 0.8, y)) : mix(horizon, floor, smoothstep(0, 0.25, -y));
  const lights: readonly SoftLight[] = [
    { direction: toward(35, 40), radius: 0.32, color: [5.0, 4.9, 4.6] },
    { direction: toward(205, 25), radius: 0.45, color: [1.6, 1.65, 1.8] },
    { direction: toward(120, 62), radius: 0.18, color: [3.0, 3.0, 3.0] },
  ];
  for (const light of lights) {
    const w = lightAt(direction, light);
    color = [color[0] + light.color[0] * w, color[1] + light.color[1] * w, color[2] + light.color[2] * w];
  }
  return color;
}

/** Late evening: deep blue overhead, an orange band at the horizon, a low sun and a dark ground. */
function dusk(direction: THREE.Vector3): Rgb3 {
  const y = direction.y;
  const top: Rgb3 = [0.1, 0.14, 0.32];
  const horizon: Rgb3 = [1.1, 0.55, 0.28];
  const ground: Rgb3 = [0.07, 0.06, 0.06];
  let color =
    y >= 0
      ? mix(horizon, top, smoothstep(0, 0.55, y))
      : mix([0.35, 0.2, 0.12], ground, smoothstep(0, 0.12, -y));
  const sun = Math.max(0, direction.dot(toward(250, 4)));
  const glow = sun ** 8;
  const disc = sun ** 400;
  color = [
    color[0] + 0.8 * glow + 6 * disc,
    color[1] + 0.4 * glow + 3.2 * disc,
    color[2] + 0.2 * glow + 1.4 * disc,
  ];
  return color;
}

const SHADERS: Readonly<Record<string, (direction: THREE.Vector3) => Rgb3>> = { studio, dusk };

/** Ids of the environments built into the renderer. */
export const BUILTIN_ENVIRONMENT_IDS: readonly string[] = Object.keys(SHADERS);

/** The built-in environment with the id, or the studio for unknown ids. */
export function createBuiltinEnvironment(id: string): THREE.DataTexture {
  const shade = SHADERS[id] ?? studio;
  const data = new Uint16Array(WIDTH * HEIGHT * 4);
  const direction = new THREE.Vector3();
  const max = 65000;
  for (let j = 0; j < HEIGHT; j++) {
    const latitude = ((j + 0.5) / HEIGHT - 0.5) * Math.PI;
    for (let i = 0; i < WIDTH; i++) {
      const longitude = ((i + 0.5) / WIDTH - 0.5) * 2 * Math.PI;
      // three.js looks equirectangular maps up with u = atan(z, x) and v = asin(y).
      direction.set(
        Math.cos(latitude) * Math.cos(longitude),
        Math.sin(latitude),
        Math.cos(latitude) * Math.sin(longitude),
      );
      const [r, g, b] = shade(direction);
      const k = (j * WIDTH + i) * 4;
      data[k] = THREE.DataUtils.toHalfFloat(Math.min(max, Math.max(0, r)));
      data[k + 1] = THREE.DataUtils.toHalfFloat(Math.min(max, Math.max(0, g)));
      data[k + 2] = THREE.DataUtils.toHalfFloat(Math.min(max, Math.max(0, b)));
      data[k + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const texture = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.HalfFloatType);
  return prepareEquirect(texture);
}

/**
 * Parses Radiance HDR bytes (from a local file the user chose) with three's bundled loader. Returns null when the
 * bytes are not a readable HDR image. Nothing is fetched.
 */
export function parseHdrEnvironment(bytes: Uint8Array): THREE.DataTexture | null {
  try {
    const parsed = new HDRLoader().parse(bytes.slice().buffer);
    if (!(parsed.data instanceof Uint16Array) || !parsed.width || !parsed.height) return null;
    const texture = new THREE.DataTexture(
      parsed.data,
      parsed.width,
      parsed.height,
      THREE.RGBAFormat,
      THREE.HalfFloatType,
    );
    texture.flipY = true;
    return prepareEquirect(texture);
  } catch {
    return null;
  }
}

function prepareEquirect(texture: THREE.DataTexture): THREE.DataTexture {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
