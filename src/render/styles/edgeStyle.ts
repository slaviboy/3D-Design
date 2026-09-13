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
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Rgb, StyleSettings } from '../../kernel/model/types';
import { FADED_OPACITY } from '../palette';

/** Opacity of faces in x-ray mode. */
export const X_RAY_OPACITY = 0.45;
/** Back edges are drawn after the faces whose depth hides them. */
export const BACK_EDGE_RENDER_ORDER = 2;
/** Dash and gap of back edges, in CSS pixels (approximately; see RENDERING.md). */
const BACK_EDGE_DASH = 5;
const BACK_EDGE_GAP = 4;
/** Size of endpoint marks, in CSS pixels. */
const ENDPOINT_SIZE = 4;

/** A three.js color from an sRGB style color. */
export function srgbColor(color: Rgb): THREE.Color {
  return new THREE.Color().setRGB(color.r, color.g, color.b, THREE.SRGBColorSpace);
}

type CompileShader = Parameters<THREE.Material['onBeforeCompile']>[0];

/** View-dependent values shared by the style materials and the clipped clones section planes make of them. */
export interface StyleViewUniforms {
  /** Drawing area in CSS pixels. */
  readonly planarResolution: THREE.IUniform<THREE.Vector2>;
  readonly planarPixelRatio: THREE.IUniform<number>;
  /** CSS pixels per model unit, at unit distance in perspective views. */
  readonly planarPixelsPerUnit: THREE.IUniform<number>;
  /** View-space distance of the nearest and farthest model points. */
  readonly planarDepthRange: THREE.IUniform<THREE.Vector2>;
  /** Extension length in CSS pixels, 0 when off. */
  readonly planarExtension: THREE.IUniform<number>;
}

export function createStyleViewUniforms(): StyleViewUniforms {
  return {
    planarResolution: { value: new THREE.Vector2(1, 1) },
    planarPixelRatio: { value: 1 },
    planarPixelsPerUnit: { value: 1 },
    planarDepthRange: { value: new THREE.Vector2(0, 1) },
    planarExtension: { value: 0 },
  };
}

/** The camera and drawing area a frame is rendered with. */
export interface StyleView {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly projection: 'perspective' | 'parallel';
  readonly fovDegrees: number;
  readonly orthoHalfHeight: number;
  readonly depthNear: number;
  readonly depthFar: number;
}

/** Replaces one fragment of a three.js shader; a missing fragment is a programming error, reported loudly. */
function patch(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) throw new Error(`Planar style shader: "${search}" not found`);
  return source.replace(search, replacement);
}

// -------------------------------------------------------------------------------------------------- thin edges

/**
 * 1 px edges with per-vertex colors. With extensions on, each vertex is pushed away from the other end of its edge
 * by a fixed number of pixels in screen space (the `edgeOther` attribute holds that other end).
 */
export class ThinEdgeMaterial extends THREE.LineBasicMaterial {
  view: StyleViewUniforms = createStyleViewUniforms();

  override onBeforeCompile(shader: CompileShader): void {
    shader.uniforms.planarResolution = this.view.planarResolution;
    shader.uniforms.planarExtension = this.view.planarExtension;
    shader.vertexShader = patch(
      patch(
        shader.vertexShader,
        '#include <common>',
        '#include <common>\nattribute vec3 edgeOther;\nuniform vec2 planarResolution;\nuniform float planarExtension;',
      ),
      '#include <project_vertex>',
      `#include <project_vertex>
      if ( planarExtension > 0.0 ) {
        vec4 planarOther = projectionMatrix * modelViewMatrix * vec4( edgeOther, 1.0 );
        if ( gl_Position.w > 0.0 && planarOther.w > 0.0 ) {
          vec2 planarAway = ( gl_Position.xy / gl_Position.w - planarOther.xy / planarOther.w ) * planarResolution;
          float planarLength = length( planarAway );
          if ( planarLength > 1e-6 ) {
            gl_Position.xy += planarAway / planarLength * ( 2.0 * planarExtension / planarResolution ) * gl_Position.w;
          }
        }
      }`,
    );
  }

  override customProgramCacheKey(): string {
    return 'planar-thin-edge';
  }

  override copy(source: ThinEdgeMaterial): this {
    super.copy(source);
    this.view = source.view;
    return this;
  }
}

// -------------------------------------------------------------------------------------------------- back edges

/**
 * Edges drawn only where something nearer hides them (depth test "greater"), dashed. Dash lengths are world
 * distances scaled by the view, so they stay roughly the same size on screen.
 */
export class BackEdgeMaterial extends THREE.LineDashedMaterial {
  view: StyleViewUniforms = createStyleViewUniforms();

  override onBeforeCompile(shader: CompileShader): void {
    shader.uniforms.planarPixelsPerUnit = this.view.planarPixelsPerUnit;
    let vertex = patch(
      shader.vertexShader,
      'uniform float scale;',
      'uniform float scale;\nuniform float planarPixelsPerUnit;',
    );
    vertex = patch(vertex, 'vLineDistance = scale * lineDistance;', '');
    vertex = patch(
      vertex,
      '#include <fog_vertex>',
      `vLineDistance = scale * lineDistance * ( isOrthographic ? planarPixelsPerUnit : planarPixelsPerUnit / max( - mvPosition.z, 1e-4 ) );
      #include <fog_vertex>`,
    );
    shader.vertexShader = vertex;
  }

  override customProgramCacheKey(): string {
    return 'planar-back-edge';
  }

  override copy(source: BackEdgeMaterial): this {
    super.copy(source);
    this.view = source.view;
    return this;
  }
}

// -------------------------------------------------------------------------------------------------- wide edges

const FAT_LINE_DECLARATIONS = `uniform float linewidth;
uniform float planarPixelRatio;
uniform float planarExtension;
uniform vec2 planarDepthRange;
#ifdef PLANAR_PROFILE
  attribute vec3 profileInA;
  attribute vec3 profileInB;
#endif`;

const FAT_LINE_WIDTH = `#ifdef PLANAR_DEPTH_CUE
  float planarDepth = - ( ( position.y < 0.5 ) ? start.z : end.z );
  float planarT = clamp( ( planarDepth - planarDepthRange.x ) / max( planarDepthRange.y - planarDepthRange.x, 1e-6 ), 0.0, 1.0 );
  offset *= mix( linewidth, 1.0, planarT ) * planarPixelRatio;
#else
  offset *= linewidth * planarPixelRatio;
#endif`;

const FAT_LINE_EXTENSION = `clip.xy += offset;
clip.xy += ( ( position.y < 0.5 ) ? - dir : dir ) * ( 2.0 * planarExtension * planarPixelRatio / resolution.y ) * clip.w;`;

/*
 * A profile edge is an outline: the two faces that meet at it lie on the same side of the plane through the edge
 * and the eye, or the edge bounds only one face. `profileInA` and `profileInB` point from the edge into each face
 * (zero for a missing second face), so the test does not depend on face orientation.
 */
const FAT_LINE_PROFILE = `gl_Position = clip;
#ifdef PLANAR_PROFILE
{
  mat3 planarRotation = mat3( modelViewMatrix );
  vec3 planarEdge = planarRotation * ( instanceEnd - instanceStart );
  vec3 planarMid = ( modelViewMatrix * vec4( 0.5 * ( instanceStart + instanceEnd ), 1.0 ) ).xyz;
  vec3 planarView = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : planarMid;
  vec3 planarSide = cross( planarEdge, planarView );
  float planarA = dot( planarSide, planarRotation * profileInA );
  float planarB = dot( planarSide, planarRotation * profileInB );
  if ( dot( profileInB, profileInB ) > 0.25 && planarA * planarB <= 0.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
}
#endif`;

export type FatLineKind = 'profile' | 'depthCue';

const linkedUniforms = (view: StyleViewUniforms): Record<string, THREE.IUniform> => ({
  planarPixelRatio: view.planarPixelRatio,
  planarExtension: view.planarExtension,
  planarDepthRange: view.planarDepthRange,
});

/** Wide screen-space lines (three's `LineMaterial`) for profiles and depth-cued edges. */
export class FatLineMaterial extends LineMaterial {
  view: StyleViewUniforms = createStyleViewUniforms();

  constructor(kind?: FatLineKind, view?: StyleViewUniforms) {
    super();
    if (view) this.view = view;
    this.vertexShader = patch(
      patch(
        patch(
          patch(this.vertexShader, 'uniform float linewidth;', FAT_LINE_DECLARATIONS),
          'offset *= linewidth;',
          FAT_LINE_WIDTH,
        ),
        'clip.xy += offset;',
        FAT_LINE_EXTENSION,
      ),
      'gl_Position = clip;',
      FAT_LINE_PROFILE,
    );
    if (kind === 'profile') this.defines.PLANAR_PROFILE = '';
    if (kind === 'depthCue') this.defines.PLANAR_DEPTH_CUE = '';
    Object.assign(this.uniforms, linkedUniforms(this.view));
  }

  override copy(source: FatLineMaterial): this {
    super.copy(source);
    this.view = source.view;
    Object.assign(this.uniforms, linkedUniforms(source.view));
    return this;
  }
}

// -------------------------------------------------------------------------------------------------- the set

/** The edge materials of one style. They are rebuilt when the style changes; view values update every frame. */
export class EdgeStyleMaterials {
  readonly view = createStyleViewUniforms();
  edge!: ThinEdgeMaterial;
  fadedEdge!: ThinEdgeMaterial;
  backEdge!: BackEdgeMaterial;
  profile!: FatLineMaterial;
  fadedProfile!: FatLineMaterial;
  depthCue!: FatLineMaterial;
  fadedDepthCue!: FatLineMaterial;
  endpoint!: THREE.PointsMaterial;
  #pixelRatio = 1;

  constructor(style: StyleSettings) {
    this.#create(style);
  }

  setStyle(style: StyleSettings): void {
    for (const material of this.materials()) material.dispose();
    this.#create(style);
  }

  materials(): THREE.Material[] {
    return [
      this.edge,
      this.fadedEdge,
      this.backEdge,
      this.profile,
      this.fadedProfile,
      this.depthCue,
      this.fadedDepthCue,
      this.endpoint,
    ];
  }

  setView(view: StyleView): void {
    const height = Math.max(1, view.height);
    this.view.planarResolution.value.set(Math.max(1, view.width), height);
    this.view.planarPixelRatio.value = view.pixelRatio;
    this.view.planarPixelsPerUnit.value =
      view.projection === 'parallel'
        ? height / (2 * Math.max(view.orthoHalfHeight, 1e-9))
        : height / (2 * Math.tan(THREE.MathUtils.degToRad(view.fovDegrees) / 2));
    this.view.planarDepthRange.value.set(view.depthNear, Math.max(view.depthFar, view.depthNear + 1e-6));
    this.#pixelRatio = view.pixelRatio;
    this.endpoint.size = ENDPOINT_SIZE * this.#pixelRatio;
  }

  #create(style: StyleSettings): void {
    const view = this.view;
    view.planarExtension.value = style.extensions ? style.extensionLength : 0;
    const thin = (faded: boolean): ThinEdgeMaterial => {
      const material = new ThinEdgeMaterial({
        vertexColors: true,
        ...(faded ? { transparent: true, opacity: FADED_OPACITY } : {}),
      });
      material.view = view;
      return material;
    };
    this.edge = thin(false);
    this.fadedEdge = thin(true);
    this.backEdge = new BackEdgeMaterial({
      vertexColors: true,
      dashSize: BACK_EDGE_DASH,
      gapSize: BACK_EDGE_GAP,
      depthFunc: THREE.GreaterDepth,
      depthWrite: false,
    });
    this.backEdge.view = view;
    const fat = (kind: FatLineKind, faded: boolean): FatLineMaterial => {
      const material = new FatLineMaterial(kind, view);
      if (kind === 'profile') {
        material.color = srgbColor(style.edgeColor);
        material.linewidth = style.profileWidth;
      } else {
        material.vertexColors = true;
        material.linewidth = style.depthCueWidth;
      }
      if (faded) {
        material.transparent = true;
        material.opacity = FADED_OPACITY;
      }
      return material;
    };
    this.profile = fat('profile', false);
    this.fadedProfile = fat('profile', true);
    this.depthCue = fat('depthCue', false);
    this.fadedDepthCue = fat('depthCue', true);
    this.endpoint = new THREE.PointsMaterial({
      color: srgbColor(style.edgeColor),
      size: ENDPOINT_SIZE * this.#pixelRatio,
      sizeAttenuation: false,
    });
  }
}
