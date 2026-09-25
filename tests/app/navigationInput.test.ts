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
import type { CameraState } from '../../src/app/camera/camera';
import type { Editor } from '../../src/app/Editor';
import { DEFAULT_NAVIGATION, type NavigationSettings } from '../../src/app/preferences/preferences';
import { MIDDLE_BUTTON } from '../../src/app/tools/Tool';
import { AXIS_Z, distance, sub, vec3, ZERO } from '../../src/kernel/math/vec3';
import { createTestEditor, pointer } from './fixtures';

const OBLIQUE: CameraState = {
  eye: vec3(10, -10, 10),
  target: ZERO,
  up: AXIS_Z,
  fovDegrees: 35,
  projection: 'perspective',
  orthoHalfHeight: 5,
};

function editorWith(navigation: Partial<NavigationSettings> = {}): Editor {
  const editor = createTestEditor();
  editor.session.setCamera(OBLIQUE);
  editor.updatePreferences({ navigation: { ...DEFAULT_NAVIGATION, ...navigation } });
  return editor;
}

const azimuth = (camera: CameraState) => {
  const offset = sub(camera.eye, camera.target);
  return Math.atan2(offset.y, offset.x);
};
const viewDistance = (camera: CameraState) => distance(camera.eye, camera.target);

describe('mouse wheel and trackpad', () => {
  it('zooms with the mouse wheel, faster at a higher zoom speed', () => {
    const usual = editorWith();
    usual.tools.wheel({ x: 100, y: 100, deltaY: -100 });
    const fast = editorWith({ zoomSpeed: 2 });
    fast.tools.wheel({ x: 100, y: 100, deltaY: -100 });
    const before = viewDistance(OBLIQUE);
    const usualRatio = before / viewDistance(usual.session.camera);
    const fastRatio = before / viewDistance(fast.session.camera);
    expect(usualRatio).toBeGreaterThan(1);
    expect(fastRatio).toBeCloseTo(usualRatio ** 2, 6);
  });

  it('zooms on a trackpad pinch and orbits or pans on a two-finger swipe', () => {
    const editor = editorWith({ device: 'trackpad' });
    editor.tools.wheel({ x: 100, y: 100, deltaY: -10, ctrlKey: true });
    expect(viewDistance(editor.session.camera)).toBeLessThan(viewDistance(OBLIQUE));

    const orbiting = editorWith({ device: 'trackpad' });
    orbiting.tools.wheel({ x: 100, y: 100, deltaX: 10, deltaY: 0 });
    expect(azimuth(orbiting.session.camera)).toBeGreaterThan(azimuth(OBLIQUE));
    expect(orbiting.session.camera.target).toEqual(OBLIQUE.target);

    const panning = editorWith({ device: 'trackpad' });
    panning.tools.wheel({ x: 100, y: 100, deltaX: 10, deltaY: 0, shiftKey: true });
    expect(azimuth(panning.session.camera)).toBeCloseTo(azimuth(OBLIQUE), 9);
    expect(distance(panning.session.camera.target, OBLIQUE.target)).toBeGreaterThan(0);

    const swapped = editorWith({ device: 'trackpad', swipe: 'pan' });
    swapped.tools.wheel({ x: 100, y: 100, deltaX: 10, deltaY: 0 });
    expect(distance(swapped.session.camera.target, OBLIQUE.target)).toBeGreaterThan(0);
    swapped.tools.wheel({ x: 100, y: 100, deltaX: 10, deltaY: 0, shiftKey: true });
    expect(azimuth(swapped.session.camera)).not.toBeCloseTo(azimuth(OBLIQUE), 6);
  });

  it('inverts and scales orbiting, for swipes and middle-button drags alike', () => {
    const turn = (editor: Editor) => azimuth(editor.session.camera) - azimuth(OBLIQUE);
    const swipe = (navigation: Partial<NavigationSettings>) => {
      const editor = editorWith({ device: 'trackpad', ...navigation });
      editor.tools.wheel({ x: 100, y: 100, deltaX: 10, deltaY: 0 });
      return turn(editor);
    };
    const usual = swipe({});
    expect(swipe({ invertOrbit: true })).toBeCloseTo(-usual, 9);
    expect(swipe({ orbitSpeed: 2 })).toBeCloseTo(2 * usual, 9);

    const drag = (navigation: Partial<NavigationSettings>) => {
      const editor = editorWith(navigation);
      editor.tools.pointerDown(pointer(100, 100, { button: MIDDLE_BUTTON, buttons: 4 }));
      editor.tools.pointerMove(pointer(90, 100, { buttons: 4 }));
      return turn(editor);
    };
    expect(drag({})).toBeCloseTo(usual, 9);
    expect(drag({ invertOrbit: true })).toBeCloseTo(-usual, 9);
  });

  it('zooms by the scale of a pinch gesture', () => {
    const editor = editorWith();
    editor.tools.pinch({ x: 100, y: 100 }, 2);
    expect(viewDistance(OBLIQUE) / viewDistance(editor.session.camera)).toBeGreaterThan(1.5);
    editor.tools.pinch({ x: 100, y: 100 }, Number.NaN);
    expect(Number.isFinite(viewDistance(editor.session.camera))).toBe(true);
  });
});
