import { describe, expect, it } from 'vitest';
import { Editor } from '../../src/app/Editor';
import type { AnimationClock } from '../../src/app/scenes/scenes';
import { describeSelection } from '../../src/app/selection/entityInfo';
import { splitShadowDateTime, sunForSettings } from '../../src/app/shadows/shadowSettings';
import { createEditorStore } from '../../src/app/stores/editorStore';
import { SECTION_PLANE_TOOL_ID } from '../../src/app/tools/SectionPlaneTool';
import { SELECT_TOOL_ID } from '../../src/app/tools/Tool';
import type { DefinitionId, InstanceId } from '../../src/kernel/ids';
import { vec3 } from '../../src/kernel/math/vec3';
import { hashDocument } from '../../src/kernel/model/snapshot';
import { DEFAULT_SHADOW_SETTINGS } from '../../src/kernel/model/types';
import { validateDocument } from '../../src/kernel/model/validate';
import { contextContentBounds, sectionRectangle } from '../../src/kernel/ops/sections';
import { boxEdges, counts, draw } from '../kernel/helpers';
import { click, createTestEditor, pointer, screenOf, TOP_CAMERA, VIEW_SIZE } from './fixtures';

/** A clock that only moves when told to, running frames every 16 ms and timers when they fall due. */
class FakeClock implements AnimationClock {
  time = 0;
  #nextHandle = 1;
  readonly #frames = new Map<number, () => void>();
  readonly #timers = new Map<number, { readonly at: number; readonly callback: () => void }>();

  now(): number {
    return this.time;
  }

  requestFrame(callback: () => void): number {
    const handle = this.#nextHandle++;
    this.#frames.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number): void {
    this.#frames.delete(handle);
  }

  setTimer(callback: () => void, milliseconds: number): number {
    const handle = this.#nextHandle++;
    this.#timers.set(handle, { at: this.time + milliseconds, callback });
    return handle;
  }

  clearTimer(handle: number): void {
    this.#timers.delete(handle);
  }

  advance(milliseconds: number): void {
    const end = this.time + milliseconds;
    while (this.time < end) {
      this.time = Math.min(end, this.time + 16);
      for (const [handle, timer] of [...this.#timers]) {
        if (timer.at > this.time) continue;
        this.#timers.delete(handle);
        timer.callback();
      }
      const frames = [...this.#frames];
      this.#frames.clear();
      for (const [, frame] of frames) frame();
    }
  }
}

function editorWithClock(reducedMotion = false): { editor: Editor; clock: FakeClock } {
  const clock = new FakeClock();
  const editor = new Editor({
    platform: 'other',
    appVersion: '0.0.0-test',
    clock,
    prefersReducedMotion: () => reducedMotion,
  });
  editor.setViewportSize(VIEW_SIZE);
  editor.session.setCamera(TOP_CAMERA);
  return { editor, clock };
}

const key = (value: string) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
});

function planes(editor: Editor) {
  return [...editor.session.doc.rootStore.sectionPlanes()];
}

function moveTo(editor: Editor, x: number, y: number): void {
  const screen = screenOf(x, y);
  editor.tools.pointerMove(pointer(screen.x, screen.y, { buttons: 0 }));
}

function clickAt(editor: Editor, x: number, y: number, detail = 1): void {
  const screen = screenOf(x, y);
  click(editor, screen.x, screen.y, { detail });
}

/** A 2 m cube from the origin. */
function editorWithBox(): Editor {
  const editor = createTestEditor();
  draw(editor.session.doc, boxEdges(0, 0, 0, 2, 2, 2));
  return editor;
}

describe('Section Plane tool', () => {
  it('aligns to the face under the cursor and places an active, selected plane', () => {
    const editor = editorWithBox();
    const depth = editor.session.doc.undoDepth;
    editor.activateTool(SECTION_PLANE_TOOL_ID);
    moveTo(editor, 0.6, 1.3);
    expect(editor.session.preview?.lines).toHaveLength(5);
    clickAt(editor, 0.6, 1.3);

    const [plane] = planes(editor);
    expect(plane).toBeDefined();
    if (!plane) return;
    expect(plane.point.z).toBeCloseTo(2, 9);
    expect(plane.normal).toEqual(vec3(0, 0, 1));
    expect(plane.active).toBe(true);
    expect(plane.name).toBe('Section 1');
    expect(editor.session.selection.refs()).toEqual([{ kind: 'section', id: plane.id }]);
    expect(editor.session.doc.undoDepth).toBe(depth + 1);
    expect(validateDocument(editor.session.doc).ok).toBe(true);
  });

  it('faces the camera off geometry, and arrow keys lock the orientation to an axis', () => {
    const editor = editorWithBox();
    editor.activateTool(SECTION_PLANE_TOOL_ID);
    clickAt(editor, 4, 4);
    const [ground] = planes(editor);
    expect(ground?.normal).toEqual(vec3(0, 0, 1));
    expect(ground?.point.z).toBeCloseTo(0, 9);

    expect(editor.handleKey(key('ArrowRight'))).toBe(true);
    expect(editor.tools.statusHint).toMatch(/red/);
    clickAt(editor, -2, 3);
    const locked = planes(editor).at(-1);
    expect(locked?.normal).toEqual(vec3(1, 0, 0));
    // Only the newest plane is active.
    expect(
      planes(editor)
        .filter((plane) => plane.active)
        .map((plane) => plane.id),
    ).toEqual([locked?.id]);

    expect(editor.handleKey(key('ArrowRight'))).toBe(true);
    expect(editor.tools.statusHint).not.toMatch(/Locked/);
  });
});

describe('section plane commands', () => {
  it('select by outline, rename, reverse, toggle, hide and delete planes', async () => {
    const editor = editorWithBox();
    const doc = editor.session.doc;
    const id = editor.placeSectionPlane(vec3(1, 1, 1), vec3(0, 0, 1));
    const info = () =>
      describeSelection(doc, editor.session.activeContext, editor.session.selection, editor.units);
    expect(info().title).toBe('Section Plane');
    expect(info().fields.section).toEqual({ id, name: 'Section 1', active: true });

    expect(editor.renameSectionPlane(id, '  Plan cut ')).toBe(true);
    expect(editor.renameSectionPlane(id, ' ')).toBe(false);
    expect(doc.rootStore.getSectionPlane(id).name).toBe('Plan cut');

    await editor.runCommand('section.reverse');
    expect(doc.rootStore.getSectionPlane(id).normal).toEqual(vec3(-0, -0, -1));
    await editor.runCommand('section.toggleActive');
    expect(doc.rootStore.getSectionPlane(id).active).toBe(false);
    expect(editor.commands.isChecked('section.toggleActive', editor)).toBe(false);

    // Clicking the rectangle's outline selects the plane; double-clicking it toggles the cut.
    editor.activateTool(SELECT_TOOL_ID);
    editor.clearSelection();
    const plane = doc.rootStore.getSectionPlane(id);
    const [a, b] = sectionRectangle(plane, contextContentBounds(doc, doc.rootDefinitionId));
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    clickAt(editor, middle.x, middle.y);
    expect(editor.session.selection.refs()).toEqual([{ kind: 'section', id }]);
    clickAt(editor, middle.x, middle.y, 2);
    expect(doc.rootStore.getSectionPlane(id).active).toBe(true);

    // Hidden planes leave the selection and can't be picked.
    await editor.runCommand('view.sectionPlanes');
    expect(editor.session.showSectionPlanes).toBe(false);
    expect(editor.session.selection.isEmpty).toBe(true);
    expect(editor.pickAt(screenOf(middle.x, middle.y), { includeSectionPlanes: false })).toBeNull();
    await editor.runCommand('view.sectionPlanes');
    await editor.runCommand('view.sectionCuts');
    expect(editor.session.showSectionCuts).toBe(false);

    clickAt(editor, middle.x, middle.y);
    const before = hashDocument(doc);
    editor.deleteSelection();
    expect(planes(editor)).toHaveLength(0);
    editor.undo();
    expect(hashDocument(doc)).toBe(before);
    expect(planes(editor)).toHaveLength(1);
  });

  it('creates a group from the slice of the open context', async () => {
    const editor = editorWithBox();
    const doc = editor.session.doc;
    editor.placeSectionPlane(vec3(0.5, 0.5, 1.25), vec3(0, 0, 1));
    const depth = doc.undoDepth;
    await editor.runCommand('section.createGroupFromSlice');
    const [instanceId] = editor.session.selection.ids('instance');
    const instance = doc.rootStore.instance(instanceId as InstanceId);
    expect(instance).toBeDefined();
    expect(counts(doc, instance?.definitionId as DefinitionId)).toEqual({ v: 4, e: 4, f: 1 });
    expect(doc.undoDepth).toBe(depth + 1);
    editor.undo();
    expect(doc.rootStore.instanceCount).toBe(0);
  });
});

describe('scenes', () => {
  it('apply model state as one undo step and move the camera over the transition, outside history', () => {
    const { editor, clock } = editorWithClock();
    const doc = editor.session.doc;
    draw(doc, boxEdges(0, 0, 0, 2, 2, 2));
    const tag = editor.addTag('Roof');
    const scene = editor.addScene('Plan');
    expect(editor.activeSceneId).toBe(scene);

    editor.setStandardView('iso');
    const iso = editor.session.camera;
    editor.setTagVisible(tag, false);
    editor.updateShadowSettings({ enabled: true });
    const depth = doc.undoDepth;

    editor.applyScene(scene);
    expect(doc.tag(tag)?.visible).toBe(true);
    expect(doc.shadows.enabled).toBe(false);
    expect(doc.undoDepth).toBe(depth + 1);
    expect(editor.session.camera).toEqual(iso);

    clock.advance(500);
    const midway = editor.session.camera;
    expect(midway.eye.z).toBeLessThan(iso.eye.z + 1e-9 + Math.abs(TOP_CAMERA.eye.z - iso.eye.z));
    expect(midway.eye).not.toEqual(iso.eye);
    expect(midway.eye).not.toEqual(TOP_CAMERA.eye);
    clock.advance(600);
    expect(editor.session.camera).toEqual(TOP_CAMERA);

    editor.undo();
    expect(doc.tag(tag)?.visible).toBe(false);
    expect(doc.shadows.enabled).toBe(true);
    expect(editor.session.camera).toEqual(TOP_CAMERA);
  });

  it('jump straight to the camera with reduced motion or a zero transition', () => {
    const reduced = editorWithClock(true).editor;
    const scene = reduced.addScene();
    reduced.setStandardView('front');
    reduced.applyScene(scene);
    expect(reduced.session.camera).toEqual(TOP_CAMERA);

    const { editor } = editorWithClock(false);
    const other = editor.addScene();
    editor.setStandardView('front');
    editor.setSceneTiming({ transitionSeconds: 0 });
    editor.applyScene(other);
    expect(editor.session.camera).toEqual(TOP_CAMERA);
  });

  it('update, reorder, rename and remove, with flags choosing what is saved', () => {
    const { editor } = editorWithClock(true);
    const doc = editor.session.doc;
    const store = createEditorStore(editor);
    const first = editor.addScene();
    const second = editor.addScene();
    expect(doc.scenes.map((scene) => scene.name)).toEqual(['Scene 1', 'Scene 2']);
    expect(store.getState().scenes).toHaveLength(2);
    expect(store.getState().activeSceneId).toBe(second);

    editor.moveScene(second, -1);
    expect(doc.scenes.map((scene) => scene.id)).toEqual([second, first]);
    expect(editor.updateSceneDetails(first, { name: 'Street', description: 'Front door' })).toBe(true);
    expect(editor.updateSceneDetails(first, { name: '' })).toBe(false);

    editor.setSceneSaves(first, { camera: false });
    expect(doc.scene(first)?.camera).toBeNull();
    editor.setStandardView('front');
    const front = editor.session.camera;
    editor.applyScene(first);
    expect(editor.session.camera).toEqual(front);
    editor.setSceneSaves(first, { camera: true });
    expect(doc.scene(first)?.camera).toEqual(front);

    editor.setStandardView('top');
    editor.updateSceneFromView(first);
    editor.setStandardView('front');
    editor.applyScene(first);
    expect(editor.session.camera.up).toEqual(vec3(0, 1, 0));

    editor.removeScene(first);
    expect(editor.activeSceneId).toBeNull();
    expect(store.getState().scenes.map((scene) => scene.id)).toEqual([second]);
    store.dispose();
  });

  it('play the included scenes in turn until Escape stops the animation', async () => {
    const { editor, clock } = editorWithClock();
    const a = editor.addScene('A');
    editor.setStandardView('front');
    const b = editor.addScene('B');
    editor.setStandardView('left');
    const skipped = editor.addScene('Skipped');
    editor.updateSceneDetails(skipped, { includeInAnimation: false });
    editor.setSceneTiming({ transitionSeconds: 0.2, delaySeconds: 0.3 });

    await editor.runCommand('view.animation.play');
    expect(editor.isAnimationPlaying).toBe(true);
    expect(editor.activeSceneId).toBe(a);
    clock.advance(250);
    expect(editor.session.camera).toEqual(TOP_CAMERA);
    clock.advance(350);
    expect(editor.activeSceneId).toBe(b);
    clock.advance(550);
    expect(editor.activeSceneId).toBe(a);

    expect(editor.handleKey(key('Escape'))).toBe(true);
    expect(editor.isAnimationPlaying).toBe(false);
    const camera = editor.session.camera;
    clock.advance(2000);
    expect(editor.activeSceneId).toBe(a);
    expect(editor.session.camera).toBe(camera);
  });
});

describe('shadow settings through the editor', () => {
  it('toggle, edit the date and time parts, refuse bad values and undo', async () => {
    const editor = createTestEditor();
    const doc = editor.session.doc;
    const store = createEditorStore(editor);

    await editor.runCommand('view.shadows');
    expect(store.getState().shadows.enabled).toBe(true);
    expect(editor.commands.isChecked('view.shadows', editor)).toBe(true);

    expect(editor.setShadowDateTime({ time: '08:30' })).toBe(true);
    expect(splitShadowDateTime(doc.shadows.dateTime)).toEqual({
      date: '2026-09-21',
      time: '08:30',
      utcOffsetMinutes: 0,
    });
    expect(editor.setShadowDateTime({ utcOffsetMinutes: 120, date: '2026-06-21' })).toBe(true);
    expect(doc.shadows.dateTime).toBe('2026-06-21T08:30:00+02:00');

    const depth = doc.undoDepth;
    expect(editor.setShadowDateTime({ date: '2026-02-30' })).toBe(false);
    expect(editor.updateShadowSettings({ latitude: 95 })).toBe(false);
    expect(editor.notifications.filter((n) => n.kind === 'error')).toHaveLength(2);
    expect(doc.undoDepth).toBe(depth);

    expect(
      editor.updateShadowSettings({ latitude: 48.2, longitude: 16.4, light: 0.5, onGround: false }),
    ).toBe(true);
    const sun = sunForSettings(doc.shadows);
    expect(sun?.altitude).toBeGreaterThan(0);
    expect(sun?.azimuth).toBeGreaterThan(60);
    expect(sun?.azimuth).toBeLessThan(120);

    editor.undo();
    editor.undo();
    editor.undo();
    editor.undo();
    expect(doc.shadows).toEqual(DEFAULT_SHADOW_SETTINGS);
    expect(store.getState().shadows).toEqual(DEFAULT_SHADOW_SETTINGS);
    store.dispose();
  });
});
