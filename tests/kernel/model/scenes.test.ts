import { describe, expect, it } from 'vitest';
import { KernelError } from '../../../src/kernel/errors';
import type { SceneId } from '../../../src/kernel/ids';
import { vec3 } from '../../../src/kernel/math/vec3';
import { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import {
  addScene,
  addTag,
  removeScene,
  reorderScenes,
  updateScene,
} from '../../../src/kernel/model/mutations';
import { createSnapshot, hashDocument, restoreSnapshot } from '../../../src/kernel/model/snapshot';
import {
  DEFAULT_SCENE_SAVES,
  DEFAULT_SHADOW_SETTINGS,
  type SceneState,
} from '../../../src/kernel/model/types';

function sceneState(name: string, overrides: Partial<SceneState> = {}): SceneState {
  return {
    name,
    description: '',
    includeInAnimation: true,
    saves: DEFAULT_SCENE_SAVES,
    camera: {
      eye: vec3(10, -10, 8),
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
  };
}

const names = (doc: ModelDocument): string[] => doc.scenes.map((scene) => scene.name);

describe('scenes', () => {
  it('are left out of snapshots while there are none', () => {
    expect(createSnapshot(new ModelDocument()).scenes).toBeUndefined();
  });

  it('add, update, reorder and remove as undoable changes with stable hashes', () => {
    const doc = new ModelDocument({ validateOnCommit: true });
    const hashes = [hashDocument(doc)];
    const ids: SceneId[] = [];
    ids.push(doc.transact('Add Scene', () => addScene(doc, sceneState('Front'))));
    hashes.push(hashDocument(doc));
    ids.push(doc.transact('Add Scene', () => addScene(doc, sceneState('Top'))));
    hashes.push(hashDocument(doc));
    const [front, top] = ids as [SceneId, SceneId];

    doc.transact('Rename Scene', () => {
      updateScene(doc, front, { name: 'Street', description: 'From the street', includeInAnimation: false });
    });
    hashes.push(hashDocument(doc));
    expect(doc.scene(front)).toMatchObject({ name: 'Street', includeInAnimation: false });

    doc.transact('Move Scene', () => {
      reorderScenes(doc, [top, front]);
    });
    hashes.push(hashDocument(doc));
    expect(names(doc)).toEqual(['Top', 'Street']);

    doc.transact('Delete Scene', () => {
      removeScene(doc, top);
    });
    hashes.push(hashDocument(doc));
    expect(names(doc)).toEqual(['Street']);

    for (let i = hashes.length - 2; i >= 0; i--) {
      doc.undo();
      expect(hashDocument(doc)).toBe(hashes[i]);
    }
    expect(doc.scenes).toEqual([]);
    for (let i = 1; i < hashes.length; i++) {
      doc.redo();
      expect(hashDocument(doc)).toBe(hashes[i]);
    }
    // Undoing the removal puts the scene back at its old position.
    doc.undo();
    expect(names(doc)).toEqual(['Top', 'Street']);
  });

  it('refuse empty names, bad orders and unchanged updates', () => {
    const doc = new ModelDocument();
    const id = doc.transact('Add', () => addScene(doc, sceneState('A')));
    expect(() => doc.transact('Bad', () => addScene(doc, sceneState('  ')))).toThrow(KernelError);
    expect(() => {
      doc.transact('Bad', () => {
        reorderScenes(doc, [id, id]);
      });
    }).toThrow(KernelError);
    const depth = doc.undoDepth;
    doc.transact('Same', () => {
      updateScene(doc, id, { name: 'A' });
    });
    expect(doc.undoDepth).toBe(depth);
    const camera = sceneState('B').camera;
    if (!camera) throw new Error('expected a camera');
    expect(() =>
      doc.transact('Bad camera', () =>
        addScene(doc, sceneState('B', { camera: { ...camera, fovDegrees: Number.NaN } })),
      ),
    ).toThrow(KernelError);
  });

  it('survive a snapshot round trip with every saved property', () => {
    const doc = new ModelDocument();
    const tag = doc.transact('Tag', () =>
      addTag(doc, { name: 'Roof', visible: true, color: { r: 1, g: 0, b: 0 } }),
    );
    doc.transact('Add', () => {
      addScene(
        doc,
        sceneState('Plan', {
          saves: { ...DEFAULT_SCENE_SAVES, axes: true },
          hiddenTags: [tag],
          sections: [{ context: doc.rootDefinitionId, plane: null }],
          shadows: { ...DEFAULT_SHADOW_SETTINGS, enabled: true },
          axes: { origin: vec3(1, 0, 0), xAxis: vec3(1, 0, 0), yAxis: vec3(0, 1, 0) },
        }),
      );
      addScene(doc, sceneState('Empty', { camera: null, hiddenTags: null, sections: null, shadows: null }));
    });
    const snapshot = createSnapshot(doc);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.scenes).toEqual(doc.scenes);
    expect(hashDocument(restored.value)).toBe(hashDocument(doc));

    const [first] = snapshot.scenes ?? [];
    if (!first) throw new Error('expected a scene');
    const badName = { ...snapshot, scenes: [{ ...first, name: '' }] };
    expect(restoreSnapshot(JSON.parse(JSON.stringify(badName))).ok).toBe(false);
    const duplicateId = { ...snapshot, scenes: [first, first] };
    expect(restoreSnapshot(JSON.parse(JSON.stringify(duplicateId))).ok).toBe(false);
  });
});
