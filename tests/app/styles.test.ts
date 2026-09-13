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
import { PANELS } from '../../src/app/panels/panels';
import { applySceneModelState, captureSceneState } from '../../src/app/scenes/scenes';
import { createEditorStore } from '../../src/app/stores/editorStore';
import { isRadianceHeader } from '../../src/app/styles/environmentImage';
import {
  hexToRgb,
  matchingPreset,
  rgbToHex,
  STYLE_PRESETS,
  stylePreset,
} from '../../src/app/styles/stylePresets';
import type { FileAccess } from '../../src/io/fs/types';
import { sameStyle, styleProblem } from '../../src/kernel/model/presentation';
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  DEFAULT_FOG_SETTINGS,
  DEFAULT_SCENE_SAVES,
  DEFAULT_STYLE_SETTINGS,
} from '../../src/kernel/model/types';
import { createTestEditor, MemoryFileAccess } from './fixtures';

const HDR_BYTES = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n');

describe('style presets', () => {
  it('are valid, distinct and original, with the default first', () => {
    expect(STYLE_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(STYLE_PRESETS.length).toBeLessThanOrEqual(6);
    expect(STYLE_PRESETS[0]?.settings).toEqual(DEFAULT_STYLE_SETTINGS);
    for (const preset of STYLE_PRESETS) expect(styleProblem(preset.settings)).toBeNull();
    for (const [i, a] of STYLE_PRESETS.entries()) {
      for (const b of STYLE_PRESETS.slice(i + 1)) expect(sameStyle(a.settings, b.settings)).toBe(false);
    }
    expect(new Set(STYLE_PRESETS.map((preset) => preset.id)).size).toBe(STYLE_PRESETS.length);
    expect(matchingPreset(DEFAULT_STYLE_SETTINGS)?.id).toBe('planar-default');
  });

  it('convert colors to and from hex', () => {
    expect(rgbToHex(DEFAULT_STYLE_SETTINGS.backgroundColor)).toBe('#dfe5eb');
    expect(hexToRgb('#dfe5eb')).toEqual(DEFAULT_STYLE_SETTINGS.backgroundColor);
    expect(hexToRgb('blue')).toBeNull();
  });
});

describe('editor style, fog and environment', () => {
  it('applies presets and face style commands as single undoable steps', async () => {
    const editor = createTestEditor();
    const store = createEditorStore(editor);
    const doc = editor.session.doc;

    expect(editor.applyStylePreset('x-ray-study')).toBe(true);
    expect(doc.style).toEqual(stylePreset('x-ray-study')?.settings);
    expect(doc.undoLabel).toBe('Apply Style');
    expect(store.getState().style).toBe(doc.style);
    expect(editor.commands.isChecked('view.faceStyle.xRay', editor)).toBe(true);
    expect(editor.commands.isChecked('view.faceStyle.shaded', editor)).toBe(true);

    await editor.commands.execute('view.faceStyle.wireframe', editor);
    expect(doc.style.faceStyle).toBe('wireframe');
    expect(doc.undoLabel).toBe('Face Style');
    await editor.commands.execute('view.faceStyle.xRay', editor);
    expect(doc.style.xRay).toBe(false);
    expect(doc.undoLabel).toBe('X-Ray');
    await editor.commands.execute('style.preset.hidden-line', editor);
    expect(doc.style.faceStyle).toBe('hiddenLine');

    const depth = doc.undoDepth;
    expect(editor.updateStyleSettings({ profileWidth: 0 })).toBe(false);
    expect(doc.undoDepth).toBe(depth);
    expect(editor.notifications.at(-1)?.kind).toBe('error');

    for (let i = 0; i < 4; i++) editor.undo();
    expect(doc.style).toEqual(DEFAULT_STYLE_SETTINGS);
    store.dispose();
  });

  it('saves, updates, applies and deletes in-model styles', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.applyStylePreset('sketch-lines');
    expect(editor.saveInModelStyle('  Site  ')).toBe(true);
    expect(doc.inModelStyles.map((style) => style.name)).toEqual(['Site']);
    expect(editor.saveInModelStyle('Site')).toBe(false);

    editor.updateStyleSettings({ sky: true });
    expect(editor.updateInModelStyle('Site')).toBe(true);
    expect(doc.inModelStyles[0]?.settings.sky).toBe(true);
    expect(doc.undoLabel).toBe('Update Style');

    editor.applyStylePreset('planar-default');
    expect(editor.applyInModelStyle('Site')).toBe(true);
    expect(doc.style.sky).toBe(true);

    expect(editor.deleteInModelStyle('Site')).toBe(true);
    expect(doc.inModelStyles).toEqual([]);
    editor.undo();
    expect(doc.inModelStyles.map((style) => style.name)).toEqual(['Site']);

    editor.promptSaveInModelStyle();
    const request = editor.inputRequest;
    expect(request?.initial).toBe('Style 1');
    request?.submit('Evening');
    expect(doc.inModelStyles.map((style) => style.name)).toEqual(['Site', 'Evening']);
  });

  it('changes fog and toggles it from the View menu command', async () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    expect(editor.updateFogSettings({ start: 5, end: 50 })).toBe(true);
    expect(doc.undoLabel).toBe('Fog Settings');
    await editor.commands.execute('view.fog', editor);
    expect(doc.fog.enabled).toBe(true);
    expect(editor.commands.isChecked('view.fog', editor)).toBe(true);
    expect(editor.updateFogSettings({ end: 4 })).toBe(false);
    editor.undo();
    editor.undo();
    expect(doc.fog).toEqual(DEFAULT_FOG_SETTINGS);
  });

  it('loads an HDR file for the session only', async () => {
    const files = new MemoryFileAccess();
    let offered: string[] = [];
    const access: FileAccess = Object.assign(files, {
      openFiles: (filter: { extensions: readonly string[] }) => {
        offered = [...filter.extensions];
        return Promise.resolve([{ name: 'courtyard.hdr', bytes: HDR_BYTES, handle: null }]);
      },
    });
    const editor = createTestEditor({ fileAccess: access });
    const store = createEditorStore(editor);
    const doc = editor.session.doc;

    expect(await editor.loadEnvironmentImage()).toBe(true);
    expect(offered).toEqual(['.hdr']);
    expect(doc.environment).toMatchObject({ enabled: true, environmentId: 'custom' });
    expect(editor.environmentImageName).toBe('courtyard.hdr');
    expect(store.getState().environmentImageName).toBe('courtyard.hdr');
    expect(editor.useEnvironmentImage('photo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);

    editor.undo();
    expect(doc.environment).toEqual(DEFAULT_ENVIRONMENT_SETTINGS);
    // The image stays loaded for the session, but it is never part of the model.
    expect(editor.environmentImageName).toBe('courtyard.hdr');
    expect(isRadianceHeader(HDR_BYTES)).toBe(true);
    store.dispose();
  });

  it('scenes save and restore style and fog when asked to', () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    editor.applyStylePreset('monochrome-study');
    editor.updateFogSettings({ enabled: true });
    const id = editor.addScene('Study');
    expect(doc.scene(id)?.style).toBeNull();
    editor.setSceneSaves(id, { style: true, fog: true });
    const scene = doc.scene(id);
    expect(scene?.style).toEqual(doc.style);
    expect(scene?.fog?.enabled).toBe(true);

    editor.applyStylePreset('planar-default');
    editor.updateFogSettings({ enabled: false });
    if (!scene) throw new Error('expected a scene');
    doc.transact('Apply Scene', () => {
      applySceneModelState(doc, scene);
    });
    expect(doc.style).toEqual(stylePreset('monochrome-study')?.settings);
    expect(doc.fog.enabled).toBe(true);

    const captured = captureSceneState(doc, editor.session.camera, {
      name: 'Plain',
      description: '',
      includeInAnimation: true,
      saves: DEFAULT_SCENE_SAVES,
    });
    expect(captured.style).toBeNull();
    expect(captured.fog).toBeNull();
  });

  it('registers the Styles, Fog and Environment panels', () => {
    const editor = createTestEditor();
    for (const id of ['styles', 'fog', 'environment'] as const) {
      expect(PANELS.some((panel) => panel.id === id)).toBe(true);
      expect(editor.commands.get(`window.${id}`)).toBeDefined();
    }
  });
});
