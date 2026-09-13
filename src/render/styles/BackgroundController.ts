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
import type { EnvironmentSettings, StyleSettings } from '../../kernel/model/types';
import type { ViewEnvironmentImage, ViewSource } from '../ViewSource';
import { createBuiltinEnvironment, parseHdrEnvironment } from './environments';
import { srgbColor } from './edgeStyle';

/** Drawn before everything else. */
const SKY_RENDER_ORDER = -1000;
const CUSTOM_ENVIRONMENT_ID = 'custom';

/*
 * The sky and ground are one full-screen quad. Each pixel's view ray is rebuilt from the inverse projection and the
 * camera's world matrix. A ray that reaches the ground plane (z = 0) shows the ground color; others above the
 * horizon blend from the background color at the horizon to the sky color overhead. Parallel views have one ray
 * direction, so the ray origin's height decides between sky and ground there.
 */
const SKY_VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4( position.xy, 1.0, 1.0 );
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 backgroundColor;
uniform vec3 skyColor;
uniform vec3 groundColor;
uniform float skyOn;
uniform float groundOn;
uniform float groundFromBelow;
uniform float parallel;
uniform mat4 inverseProjection;
uniform mat4 cameraWorld;
varying vec2 vNdc;

void main() {
  vec4 nearView = inverseProjection * vec4( vNdc, -1.0, 1.0 );
  vec4 farView = inverseProjection * vec4( vNdc, 1.0, 1.0 );
  vec3 origin = ( cameraWorld * vec4( nearView.xyz / nearView.w, 1.0 ) ).xyz;
  vec3 target = ( cameraWorld * vec4( farView.xyz / farView.w, 1.0 ) ).xyz;
  vec3 dir = normalize( target - origin );
  bool below = origin.z < 0.0;
  bool level = abs( dir.z ) < 1e-5;
  bool hitsGround = level ? ( parallel > 0.5 && below ) : ( - origin.z / dir.z > 0.0 );
  vec3 color = backgroundColor;
  if ( hitsGround ) {
    if ( groundOn > 0.5 && ( ! below || groundFromBelow > 0.5 ) ) {
      float amount = parallel > 0.5 ? 1.0 : smoothstep( 0.0, 0.06, abs( dir.z ) );
      color = mix( backgroundColor, groundColor, 0.25 + 0.75 * amount );
    }
  } else if ( skyOn > 0.5 && ! below ) {
    float elevation = parallel > 0.5 ? 0.3 : dir.z;
    color = mix( backgroundColor, skyColor, smoothstep( 0.0, 0.45, elevation ) );
  }
  gl_FragColor = vec4( color, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface EnvironmentMaps {
  readonly key: string;
  readonly image: ViewEnvironmentImage | null;
  readonly equirect: THREE.DataTexture;
  readonly prefiltered: THREE.WebGLRenderTarget;
}

/** Background color, sky and ground, fog, and the image-based environment of the view. */
export class BackgroundController {
  readonly sky: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene: THREE.Scene;
  #pmrem: THREE.PMREMGenerator | null = null;
  #maps: EnvironmentMaps | null = null;
  #skyWanted = false;
  #environmentBackground = false;
  #hiddenForCapture = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.#renderer = renderer;
    this.#scene = scene;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        backgroundColor: { value: new THREE.Color() },
        skyColor: { value: new THREE.Color() },
        groundColor: { value: new THREE.Color() },
        skyOn: { value: 0 },
        groundOn: { value: 0 },
        groundFromBelow: { value: 0 },
        parallel: { value: 0 },
        inverseProjection: { value: new THREE.Matrix4() },
        cameraWorld: { value: new THREE.Matrix4() },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = SKY_RENDER_ORDER;
    this.sky.visible = false;
    this.sky.matrixAutoUpdate = false;
    scene.add(this.sky);
  }

  /** Applies the document's style, fog and environment. Cheap when nothing changed. */
  update(source: ViewSource): void {
    const doc = source.doc;
    const style = doc.style;
    this.#applyStyle(style);
    const fog = doc.fog;
    if (fog.enabled) {
      const color = srgbColor(fog.useBackgroundColor ? style.backgroundColor : fog.color);
      if (this.#scene.fog instanceof THREE.Fog) {
        this.#scene.fog.color.copy(color);
        this.#scene.fog.near = fog.start;
        this.#scene.fog.far = fog.end;
      } else {
        this.#scene.fog = new THREE.Fog(color, fog.start, fog.end);
      }
    } else {
      this.#scene.fog = null;
    }
    this.#applyEnvironment(doc.environment, source.environmentImage ?? null);
  }

  /** Updates the sky for the camera about to render, and picks the backdrop. */
  beforeRender(camera: THREE.Camera, parallel: boolean): void {
    const showEnvironment = this.#environmentBackground && !parallel && !this.#hiddenForCapture;
    this.#scene.background = showEnvironment && this.#maps ? this.#maps.equirect : null;
    this.sky.visible = this.#skyWanted && !showEnvironment && !this.#hiddenForCapture;
    camera.updateMatrixWorld();
    const uniforms = this.sky.material.uniforms;
    (uniforms.inverseProjection?.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (uniforms.cameraWorld?.value as THREE.Matrix4).copy(camera.matrixWorld);
    if (uniforms.parallel) uniforms.parallel.value = parallel ? 1 : 0;
  }

  /** Leaves out the sky and the environment backdrop, for images with a transparent background. */
  setHiddenForCapture(hidden: boolean): void {
    this.#hiddenForCapture = hidden;
  }

  dispose(): void {
    this.#disposeMaps();
    this.#pmrem?.dispose();
    this.#pmrem = null;
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.sky.removeFromParent();
  }

  #applyStyle(style: StyleSettings): void {
    this.#renderer.setClearColor(srgbColor(style.backgroundColor));
    const uniforms = this.sky.material.uniforms;
    (uniforms.backgroundColor?.value as THREE.Color).copy(srgbColor(style.backgroundColor));
    (uniforms.skyColor?.value as THREE.Color).copy(srgbColor(style.skyColor));
    (uniforms.groundColor?.value as THREE.Color).copy(srgbColor(style.groundColor));
    if (uniforms.skyOn) uniforms.skyOn.value = style.sky ? 1 : 0;
    if (uniforms.groundOn) uniforms.groundOn.value = style.ground ? 1 : 0;
    if (uniforms.groundFromBelow) uniforms.groundFromBelow.value = style.groundFromBelow ? 1 : 0;
    this.#skyWanted = style.sky || style.ground;
  }

  #applyEnvironment(settings: EnvironmentSettings, image: ViewEnvironmentImage | null): void {
    const scene = this.#scene;
    if (!settings.enabled) {
      scene.environment = null;
      this.#environmentBackground = false;
      this.#disposeMaps();
      return;
    }
    const custom = settings.environmentId === CUSTOM_ENVIRONMENT_ID && image !== null;
    const key = custom ? CUSTOM_ENVIRONMENT_ID : settings.environmentId;
    const wantedImage = custom ? image : null;
    if (this.#maps?.key !== key || this.#maps.image !== wantedImage) {
      this.#disposeMaps();
      const equirect =
        (wantedImage ? parseHdrEnvironment(wantedImage.bytes) : null) ?? createBuiltinEnvironment(key);
      this.#pmrem ??= new THREE.PMREMGenerator(this.#renderer);
      const prefiltered = this.#pmrem.fromEquirectangular(equirect);
      this.#maps = { key, image: wantedImage, equirect, prefiltered };
    }
    const maps = this.#maps;
    scene.environment = settings.useForReflections ? maps.prefiltered.texture : null;
    scene.environmentIntensity = settings.exposure;
    scene.backgroundIntensity = settings.exposure;
    // Environment maps are Y-up; turning a quarter turn about X makes their up the model's blue (Z) axis, and the
    // user's rotation then turns them about Z.
    const turn = THREE.MathUtils.degToRad(settings.rotationDegrees);
    scene.environmentRotation.set(Math.PI / 2, 0, turn, 'ZXY');
    scene.backgroundRotation.set(Math.PI / 2, 0, turn, 'ZXY');
    this.#environmentBackground = settings.showAsBackground;
  }

  #disposeMaps(): void {
    if (!this.#maps) return;
    if (this.#scene.background === this.#maps.equirect) this.#scene.background = null;
    if (this.#scene.environment === this.#maps.prefiltered.texture) this.#scene.environment = null;
    this.#maps.equirect.dispose();
    this.#maps.prefiltered.dispose();
    this.#maps = null;
  }
}
