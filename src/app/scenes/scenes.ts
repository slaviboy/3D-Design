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

import type { SceneId } from '../../kernel/ids';
import { add, normalize, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import {
  setActiveSectionPlane,
  setModelAxes,
  setShadowSettings,
  setTagAttributes,
} from '../../kernel/model/mutations';
import { setFogSettings, setStyleSettings } from '../../kernel/model/mutations';
import type { SceneData, SceneSaves, SceneState } from '../../kernel/model/types';
import type { CameraState } from '../camera/camera';

/** Default camera transition when a scene is applied. */
export const DEFAULT_SCENE_TRANSITION_SECONDS = 1;
/** Default time each scene is shown while an animation plays, after its transition. */
export const DEFAULT_SCENE_DELAY_SECONDS = 1.5;
export const MAX_SCENE_SECONDS = 60;

/** Time and frame scheduling, injectable so tests can drive animations without real time. */
export interface AnimationClock {
  /** Milliseconds. */
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, milliseconds: number): number;
  clearTimer(handle: number): void;
}

/** requestAnimationFrame where it exists (browsers), timers elsewhere. */
export function createSystemClock(): AnimationClock {
  const frame = globalThis.requestAnimationFrame as ((callback: () => void) => number) | undefined;
  const cancel = globalThis.cancelAnimationFrame as ((handle: number) => void) | undefined;
  return {
    now: () => performance.now(),
    requestFrame: (callback) => (frame ? frame(callback) : (setTimeout(callback, 16) as unknown as number)),
    cancelFrame: (handle) => {
      if (cancel) cancel(handle);
      else clearTimeout(handle);
    },
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds) as unknown as number,
    clearTimer: (handle) => {
      clearTimeout(handle);
    },
  };
}

/** The scene's name, description and flags with values captured from the current view and model. */
export function captureSceneState(
  doc: ModelDocument,
  camera: CameraState,
  meta: Pick<SceneState, 'name' | 'description' | 'includeInAnimation' | 'saves'>,
): SceneState {
  const { saves } = meta;
  const vector = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
  return {
    name: meta.name,
    description: meta.description,
    includeInAnimation: meta.includeInAnimation,
    saves,
    camera: saves.camera
      ? {
          eye: vector(camera.eye),
          target: vector(camera.target),
          up: vector(camera.up),
          fovDegrees: camera.fovDegrees,
          projection: camera.projection,
          orthoHalfHeight: camera.orthoHalfHeight,
        }
      : null,
    hiddenTags: saves.visibleTags ? [...doc.tags()].filter((tag) => !tag.visible).map((tag) => tag.id) : null,
    sections: saves.activeSections
      ? [...doc.definitions()]
          .filter((definition) => definition.store.sectionPlaneCount > 0)
          .map((definition) => ({
            context: definition.id,
            plane: definition.store.activeSectionPlane()?.id ?? null,
          }))
      : null,
    shadows: saves.shadows ? doc.shadows : null,
    axes: saves.axes ? doc.axes : null,
    style: saves.style ? doc.style : null,
    fog: saves.fog ? doc.fog : null,
  };
}

/**
 * Applies the model properties a scene saved: tag visibility, active section planes, shadow settings and axes.
 * Must run inside a transaction. References to tags, contexts or planes deleted since are skipped.
 */
export function applySceneModelState(doc: ModelDocument, scene: SceneData): void {
  const { saves } = scene;
  if (saves.visibleTags && scene.hiddenTags) {
    const hidden = new Set<number>(scene.hiddenTags);
    for (const tag of [...doc.tags()]) setTagAttributes(doc, tag.id, { visible: !hidden.has(tag.id) });
  }
  if (saves.activeSections && scene.sections) {
    for (const { context, plane } of scene.sections) {
      const definition = doc.definition(context);
      if (!definition) continue;
      const exists = plane !== null && definition.store.sectionPlane(plane) !== undefined;
      setActiveSectionPlane(doc, context, exists ? plane : null);
    }
  }
  if (saves.shadows && scene.shadows) setShadowSettings(doc, scene.shadows);
  if (saves.axes && scene.axes) setModelAxes(doc, scene.axes);
  if (saves.style && scene.style) setStyleSettings(doc, scene.style);
  if (saves.fog && scene.fog) setFogSettings(doc, scene.fog);
}

/** The camera a scene restores, or null when it does not save one. */
export function sceneCamera(scene: SceneData): CameraState | null {
  return scene.saves.camera && scene.camera ? { ...scene.camera } : null;
}

/** A name like `Scene 3` that no scene uses yet. */
export function uniqueSceneName(doc: ModelDocument): string {
  const names = new Set(doc.scenes.map((scene) => scene.name));
  for (let n = doc.scenes.length + 1; ; n++) {
    const name = `Scene ${String(n)}`;
    if (!names.has(name)) return name;
  }
}

/** Smooth start and stop. */
export function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - (-2 * clamped + 2) ** 2 / 2;
}

/**
 * The camera part-way between two cameras. Positions and field of view blend linearly; the projection switches at
 * the end, and a parallel view keeps its height so the change of projection is not a jump in size.
 */
export function interpolateCamera(from: CameraState, to: CameraState, t: number): CameraState {
  if (t >= 1) return to;
  const mix = (a: Vec3, b: Vec3): Vec3 => add(a, scale(sub(b, a), t));
  return {
    eye: mix(from.eye, to.eye),
    target: mix(from.target, to.target),
    up: normalize(mix(from.up, to.up)) ?? to.up,
    fovDegrees: from.fovDegrees + (to.fovDegrees - from.fovDegrees) * t,
    projection: from.projection,
    orthoHalfHeight: from.orthoHalfHeight + (to.orthoHalfHeight - from.orthoHalfHeight) * t,
  };
}

/** Moves a camera from one state to another over time, one frame at a time. */
export class CameraTransition {
  readonly #clock: AnimationClock;
  #frame: number | null = null;

  constructor(clock: AnimationClock) {
    this.#clock = clock;
  }

  get active(): boolean {
    return this.#frame !== null;
  }

  /** Starts a transition, replacing any running one. With a zero duration the camera jumps at once. */
  start(
    from: CameraState,
    to: CameraState,
    durationMs: number,
    onFrame: (camera: CameraState) => void,
    onDone: () => void = () => undefined,
  ): void {
    this.cancel();
    if (durationMs <= 0) {
      onFrame(to);
      onDone();
      return;
    }
    const startedAt = this.#clock.now();
    const step = (): void => {
      const t = (this.#clock.now() - startedAt) / durationMs;
      if (t >= 1) {
        this.#frame = null;
        onFrame(to);
        onDone();
        return;
      }
      onFrame(interpolateCamera(from, to, easeInOut(t)));
      this.#frame = this.#clock.requestFrame(step);
    };
    this.#frame = this.#clock.requestFrame(step);
  }

  cancel(): void {
    if (this.#frame !== null) this.#clock.cancelFrame(this.#frame);
    this.#frame = null;
  }
}

/** Flags for a new scene. */
export function defaultSceneMeta(
  doc: ModelDocument,
  saves: SceneSaves,
): Pick<SceneState, 'name' | 'description' | 'includeInAnimation' | 'saves'> {
  return { name: uniqueSceneName(doc), description: '', includeInAnimation: true, saves };
}

export type { SceneId };
