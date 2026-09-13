import { describe, expect, it } from 'vitest';
import { KernelError } from '../../../src/kernel/errors';
import type { SceneId } from '../../../src/kernel/ids';
import { vec3 } from '../../../src/kernel/math/vec3';
import { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import {
  addScene,
  setEnvironmentSettings,
  setFogSettings,
  setInModelStyles,
  setStyleSettings,
} from '../../../src/kernel/model/mutations';
import { restoreSnapshotWithRepair } from '../../../src/kernel/model/repair';
import { createSnapshot, hashDocument, restoreSnapshot } from '../../../src/kernel/model/snapshot';
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  DEFAULT_FOG_SETTINGS,
  DEFAULT_SCENE_SAVES,
  DEFAULT_SHADOW_SETTINGS,
  DEFAULT_STYLE_SETTINGS,
  rgbFromHex,
  type SceneState,
  type StyleSettings,
} from '../../../src/kernel/model/types';
import { validateDocument } from '../../../src/kernel/model/validate';

const roundTrip = (doc: ModelDocument): unknown => JSON.parse(JSON.stringify(createSnapshot(doc)));

function expectRefused(doc: ModelDocument, change: () => void): void {
  const depth = doc.undoDepth;
  const hash = hashDocument(doc);
  expect(() => {
    doc.transact('Bad', change);
  }).toThrow(KernelError);
  expect(doc.undoDepth).toBe(depth);
  expect(hashDocument(doc)).toBe(hash);
}

const sketchStyle: Partial<StyleSettings> = {
  faceStyle: 'hiddenLine',
  xRay: true,
  profiles: true,
  profileWidth: 4,
  edgeColorMode: 'byAxis',
  backgroundColor: rgbFromHex(0xffffff),
  sky: true,
};

describe('style, fog and environment settings', () => {
  it('start at the defaults, which snapshots leave out', () => {
    const doc = new ModelDocument();
    expect(doc.style).toEqual(DEFAULT_STYLE_SETTINGS);
    expect(doc.fog).toEqual(DEFAULT_FOG_SETTINGS);
    expect(doc.environment).toEqual(DEFAULT_ENVIRONMENT_SETTINGS);
    expect(doc.inModelStyles).toEqual([]);
    const snapshot = createSnapshot(doc);
    expect(snapshot.style).toBeUndefined();
    expect(snapshot.styles).toBeUndefined();
    expect(snapshot.fog).toBeUndefined();
    expect(snapshot.environment).toBeUndefined();
  });

  it('reproduce the fixed viewport colors of earlier versions', () => {
    const hex = ({ r, g, b }: { r: number; g: number; b: number }): number =>
      (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    expect(hex(DEFAULT_STYLE_SETTINGS.backgroundColor)).toBe(0xdfe5eb);
    expect(hex(DEFAULT_STYLE_SETTINGS.frontColor)).toBe(0xf2f0ea);
    expect(hex(DEFAULT_STYLE_SETTINGS.backColor)).toBe(0x9eafc3);
    expect(hex(DEFAULT_STYLE_SETTINGS.edgeColor)).toBe(0x1d232b);
    expect(DEFAULT_STYLE_SETTINGS.faceStyle).toBe('shadedWithTextures');
  });

  it('change as undoable document changes with stable hashes', () => {
    const doc = new ModelDocument({ validateOnCommit: true });
    const hashes = [hashDocument(doc)];
    doc.transact('Change Style', () => {
      setStyleSettings(doc, sketchStyle);
    });
    hashes.push(hashDocument(doc));
    doc.transact('Fog Settings', () => {
      setFogSettings(doc, { enabled: true, start: 2.5, end: 40, useBackgroundColor: false });
    });
    hashes.push(hashDocument(doc));
    doc.transact('Environment Settings', () => {
      setEnvironmentSettings(doc, {
        enabled: true,
        environmentId: 'dusk',
        rotationDegrees: -30,
        exposure: 1.5,
      });
    });
    hashes.push(hashDocument(doc));
    doc.transact('Save Style', () => {
      setInModelStyles(doc, [{ name: 'Sketch', settings: doc.style }]);
    });
    hashes.push(hashDocument(doc));

    expect(doc.style).toMatchObject(sketchStyle);
    expect(doc.environment.rotationDegrees).toBeCloseTo(330);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(doc.undoDepth).toBe(4);
    for (let i = hashes.length - 2; i >= 0; i--) {
      doc.undo();
      expect(hashDocument(doc)).toBe(hashes[i]);
    }
    expect(doc.style).toEqual(DEFAULT_STYLE_SETTINGS);
    expect(doc.fog).toEqual(DEFAULT_FOG_SETTINGS);
    expect(doc.environment).toEqual(DEFAULT_ENVIRONMENT_SETTINGS);
    for (let i = 1; i < hashes.length; i++) {
      doc.redo();
      expect(hashDocument(doc)).toBe(hashes[i]);
    }

    // Setting the same values records nothing.
    doc.transact('Same', () => {
      setStyleSettings(doc, { ...doc.style });
      setFogSettings(doc, { start: 2.5 });
      setEnvironmentSettings(doc, { rotationDegrees: 330 });
      setInModelStyles(doc, doc.inModelStyles);
    });
    expect(doc.undoDepth).toBe(4);
  });

  it('refuse invalid values without changing anything', () => {
    const doc = new ModelDocument();
    const badStyles: Partial<StyleSettings>[] = [
      { faceStyle: 'cartoon' as StyleSettings['faceStyle'] },
      { edgeColorMode: 'rainbow' as StyleSettings['edgeColorMode'] },
      { profileWidth: 0 },
      { depthCueWidth: 21 },
      { extensionLength: -1 },
      { edgeColor: { r: 1.2, g: 0, b: 0 } },
      { skyColor: { r: Number.NaN, g: 0, b: 0 } },
    ];
    for (const patch of badStyles) {
      expectRefused(doc, () => {
        setStyleSettings(doc, patch);
      });
    }
    for (const patch of [{ start: -1 }, { end: 10 }, { end: 5 }, { start: Number.POSITIVE_INFINITY }]) {
      expectRefused(doc, () => {
        setFogSettings(doc, patch);
      });
    }
    for (const patch of [
      { exposure: 5 },
      { exposure: -0.1 },
      { environmentId: 'Not An Id' },
      { rotationDegrees: Number.NaN },
    ]) {
      expectRefused(doc, () => {
        setEnvironmentSettings(doc, patch);
      });
    }
    for (const styles of [
      [{ name: '', settings: DEFAULT_STYLE_SETTINGS }],
      [{ name: ' padded ', settings: DEFAULT_STYLE_SETTINGS }],
      [
        { name: 'Twice', settings: DEFAULT_STYLE_SETTINGS },
        { name: 'Twice', settings: DEFAULT_STYLE_SETTINGS },
      ],
      [{ name: 'Broken', settings: { ...DEFAULT_STYLE_SETTINGS, profileWidth: 99 } }],
    ]) {
      expectRefused(doc, () => {
        setInModelStyles(doc, styles);
      });
    }
    expect(doc.style).toEqual(DEFAULT_STYLE_SETTINGS);
  });

  it('survive a snapshot round trip', () => {
    const doc = new ModelDocument();
    doc.transact('Settings', () => {
      setStyleSettings(doc, sketchStyle);
      setInModelStyles(doc, [
        { name: 'Sketch', settings: doc.style },
        { name: 'Plain', settings: DEFAULT_STYLE_SETTINGS },
      ]);
      setFogSettings(doc, { enabled: true, end: 75, color: rgbFromHex(0x808080) });
      setEnvironmentSettings(doc, { enabled: true, exposure: 0.25, showAsBackground: false });
    });
    const snapshot = createSnapshot(doc);
    expect(snapshot.style?.faceStyle).toBe('hiddenLine');
    expect(snapshot.styles?.map((style) => style.name)).toEqual(['Sketch', 'Plain']);
    const restored = restoreSnapshot(roundTrip(doc));
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.style).toEqual(doc.style);
    expect(restored.value.inModelStyles).toEqual(doc.inModelStyles);
    expect(restored.value.fog).toEqual(doc.fog);
    expect(restored.value.environment).toEqual(doc.environment);
    expect(hashDocument(restored.value)).toBe(hashDocument(doc));
  });

  it('are rejected when invalid in a file, and reset to the defaults by repair', () => {
    const doc = new ModelDocument();
    doc.transact('Settings', () => {
      setStyleSettings(doc, sketchStyle);
      setInModelStyles(doc, [{ name: 'Sketch', settings: doc.style }]);
      setFogSettings(doc, { enabled: true });
      setEnvironmentSettings(doc, { enabled: true });
    });
    const snapshot = roundTrip(doc) as Record<string, Record<string, unknown>>;
    const broken = {
      ...snapshot,
      style: { ...snapshot.style, faceStyle: 'cartoon' },
      styles: [{ name: 'Sketch', settings: { ...snapshot.style, profileWidth: -3 } }],
      fog: { ...snapshot.fog, start: 500, end: 100 },
      environment: { ...snapshot.environment, exposure: 99 },
    };
    expect(restoreSnapshot(broken).ok).toBe(false);
    const repaired = restoreSnapshotWithRepair(broken);
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    const { doc: fixed, repairs } = repaired.value;
    expect(fixed.style).toEqual(DEFAULT_STYLE_SETTINGS);
    expect(fixed.inModelStyles).toEqual([]);
    expect(fixed.fog).toEqual(DEFAULT_FOG_SETTINGS);
    expect(fixed.environment).toEqual(DEFAULT_ENVIRONMENT_SETTINGS);
    expect(validateDocument(fixed).ok).toBe(true);
    expect(repairs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Reset the style settings/),
        expect.stringMatching(/^Reset the in-model styles/),
        expect.stringMatching(/^Reset the fog settings/),
        expect.stringMatching(/^Reset the environment settings/),
      ]),
    );

    const missingField = { ...snapshot, fog: { enabled: true } };
    expect(restoreSnapshot(missingField).ok).toBe(false);
  });
});

describe('scenes with style and fog', () => {
  const state = (overrides: Partial<SceneState> = {}): SceneState => ({
    name: 'View',
    description: '',
    includeInAnimation: true,
    saves: DEFAULT_SCENE_SAVES,
    camera: {
      eye: vec3(5, -5, 5),
      target: vec3(0, 0, 0),
      up: vec3(0, 0, 1),
      fovDegrees: 35,
      projection: 'perspective',
      orthoHalfHeight: 5,
    },
    hiddenTags: [],
    sections: [],
    shadows: DEFAULT_SHADOW_SETTINGS,
    axes: null,
    style: null,
    fog: null,
    ...overrides,
  });

  it('leave the style and fog flags out of snapshots while they are off', () => {
    const doc = new ModelDocument();
    doc.transact('Add Scene', () => addScene(doc, state()));
    const [scene] = createSnapshot(doc).scenes ?? [];
    expect(scene?.saves).not.toHaveProperty('style');
    expect(scene?.saves).not.toHaveProperty('fog');
    expect(scene).not.toHaveProperty('style');
    expect(scene).not.toHaveProperty('fog');
  });

  it('round trip saved styles and fog, and read older scenes without them', () => {
    const doc = new ModelDocument();
    let id: SceneId | undefined;
    doc.transact('Add Scene', () => {
      id = addScene(
        doc,
        state({
          saves: { ...DEFAULT_SCENE_SAVES, style: true, fog: true },
          style: { ...DEFAULT_STYLE_SETTINGS, faceStyle: 'wireframe' },
          fog: { ...DEFAULT_FOG_SETTINGS, enabled: true },
        }),
      );
    });
    const snapshot = createSnapshot(doc);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(restored.ok).toBe(true);
    if (!restored.ok || id === undefined) return;
    expect(restored.value.scenes).toEqual(doc.scenes);
    expect(hashDocument(restored.value)).toBe(hashDocument(doc));

    // A file from before styles existed: no style or fog flags and no saved style or fog.
    const olderFile = JSON.parse(JSON.stringify(snapshot)) as { scenes: Record<string, unknown>[] };
    for (const entry of olderFile.scenes) {
      delete entry.style;
      delete entry.fog;
      const saves = entry.saves as Record<string, unknown>;
      delete saves.style;
      delete saves.fog;
    }
    const older = restoreSnapshot(olderFile);
    expect(older.ok).toBe(true);
    if (older.ok) {
      expect(older.value.scene(id)).toMatchObject({
        saves: { style: false, fog: false },
        style: null,
        fog: null,
      });
    }

    expect(() =>
      doc.transact('Bad', () =>
        addScene(doc, state({ style: { ...DEFAULT_STYLE_SETTINGS, profileWidth: 0 } })),
      ),
    ).toThrow(KernelError);
  });
});
