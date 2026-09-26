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
import type { Editor } from '../../src/app/Editor';
import { projectToScreen, type CameraState } from '../../src/app/camera/camera';
import {
  exclusionForBoundary,
  exclusionForChanges,
  exclusionForMove,
} from '../../src/app/inference/exclusion';
import { infer, type InferenceRequest } from '../../src/app/inference/inference';
import { pick } from '../../src/app/picking/picker';
import { sectionClipping } from '../../src/app/picking/sectionClip';
import { OFFSET_TOOL_ID } from '../../src/app/tools/OffsetTool';
import { ROTATE_TOOL_ID } from '../../src/app/tools/RotateTool';
import { SCALE_TOOL_ID } from '../../src/app/tools/ScaleTool';
import { MOVE_TOOL_ID, PUSH_PULL_TOOL_ID } from '../../src/app/tools/Tool';
import type { FaceId } from '../../src/kernel/ids';
import { IDENTITY, type Mat4 } from '../../src/kernel/math/mat4';
import { AXIS_Z, distance, vec3, type Vec3 } from '../../src/kernel/math/vec3';
import type { EntityStore } from '../../src/kernel/model/EntityStore';
import type { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { addSectionPlane, setStyleSettings } from '../../src/kernel/model/mutations';
import type { StyleSettings } from '../../src/kernel/model/types';
import { makeGroup } from '../../src/kernel/ops/hierarchy';
import { boxEdges, draw, newDocument, rectangle, segment } from '../kernel/helpers';
import { click, createTestEditor, pointer, screenOf, TOP_CAMERA, VIEW_SIZE } from './fixtures';

type Request = Partial<Omit<InferenceRequest, 'screen'>>;

function inferAt(doc: ModelDocument, screen: { x: number; y: number }, request: Request = {}) {
  return infer(doc, doc.rootDefinitionId, IDENTITY, {
    camera: TOP_CAMERA,
    size: VIEW_SIZE,
    screen,
    ...request,
  });
}

const expectPoint = (actual: Vec3, expected: Vec3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.z).toBeCloseTo(expected.z, 6);
};

function setStyle(doc: ModelDocument, patch: Partial<StyleSettings>): void {
  doc.transact('Change Style', () => {
    setStyleSettings(doc, patch);
  });
}

/** A square face floating at z = 2 over a short edge on the ground, which the face hides from the top. */
function edgeUnderFace(): ModelDocument {
  const doc = newDocument();
  draw(doc, rectangle(-2, -2, 2, 2, 2));
  draw(doc, [segment([0.5, 0.5, 0], [1.5, 0.5, 0])]);
  return doc;
}

/** The horizontal face at height `z`. */
function horizontalFace(store: EntityStore, z: number): FaceId {
  const face = [...store.faces()].find(
    (candidate) =>
      candidate.plane !== null &&
      Math.abs(Math.abs(candidate.plane.normal.z) - 1) < 1e-9 &&
      Math.abs(candidate.plane.offset * candidate.plane.normal.z - z) < 1e-9,
  );
  if (!face) throw new Error(`no horizontal face at z = ${String(z)}`);
  return face.id;
}

describe('inference sees only what the camera sees', () => {
  it('ignores points hidden behind a face and snaps to the face instead', () => {
    const doc = edgeUnderFace();
    const hidden = inferAt(doc, screenOf(0.55, 0.5));
    expect(hidden.kind).toBe('on-face');
    expectPoint(hidden.point, vec3(0.55, 0.5, 2));
  });

  it('prefers the nearer of two points that coincide on screen', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const corner = inferAt(doc, screenOf(1, 1));
    expect(corner.kind).toBe('endpoint');
    expectPoint(corner.point, vec3(1, 1, 1));
  });

  it('keeps points that lie on the visible faces, and drops the corner behind the box', () => {
    const camera: CameraState = {
      eye: vec3(6, -8, 6),
      target: vec3(0.5, 0.5, 0.5),
      up: AXIS_Z,
      fovDegrees: 35,
      projection: 'perspective',
      orthoHalfHeight: 5,
    };
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const on = (point: Vec3) => {
      const screen = projectToScreen(camera, point, VIEW_SIZE);
      if (!screen) throw new Error('behind the camera');
      return { x: screen.x, y: screen.y };
    };
    const front = inferAt(doc, on(vec3(1, 0, 1)), { camera });
    expect(front.kind).toBe('endpoint');
    expectPoint(front.point, vec3(1, 0, 1));
    const back = inferAt(doc, on(vec3(0, 1, 0)), { camera });
    expect(distance(back.point, vec3(0, 1, 0))).toBeGreaterThan(1e-3);
  });

  it('ignores an axis line where it runs behind a face', () => {
    const doc = newDocument();
    draw(doc, boxEdges(2, -1, -1, 4, 1, 1));
    const result = inferAt(doc, screenOf(3, 0.1), { anchor: vec3(0, 0, 0) });
    expect(result.kind).toBe('on-face');
    expectPoint(result.point, vec3(3, 0.1, 1));

    const fromPoint = inferAt(doc, screenOf(3, 0.1), { references: { points: [vec3(0, 0, 0)], edges: [] } });
    expect(fromPoint.kind).toBe('on-face');
  });

  it('snaps through faces in X-ray and wireframe', () => {
    for (const patch of [{ xRay: true }, { faceStyle: 'wireframe' as const }]) {
      const doc = edgeUnderFace();
      setStyle(doc, patch);
      const result = inferAt(doc, screenOf(0.55, 0.5));
      expect(result.kind).toBe('endpoint');
      expectPoint(result.point, vec3(0.5, 0.5, 0));
    }
  });

  it('keeps points on edges visible with Back Edges, but not the origin', () => {
    const doc = edgeUnderFace();
    setStyle(doc, { backEdges: true });
    expect(inferAt(doc, screenOf(0.55, 0.5)).kind).toBe('endpoint');
    const origin = inferAt(doc, screenOf(0.1, 0.1));
    expect(origin.kind).toBe('on-face');
    expect(origin.point.z).toBeCloseTo(2, 6);
  });

  it('looks through what a section cuts away, also inside an open group', () => {
    const doc = edgeUnderFace();
    doc.transact('Section Plane', () => {
      addSectionPlane(doc, doc.rootDefinitionId, {
        name: 'Cut',
        point: vec3(0, 0, 1),
        normal: vec3(0, 0, 1),
        active: true,
      });
    });
    const cut = sectionClipping(doc, [], true);
    expect(inferAt(doc, screenOf(0.55, 0.5), { clip: cut }).kind).toBe('endpoint');
    expect(inferAt(doc, screenOf(0.55, 0.5), { clip: sectionClipping(doc, [], false) }).kind).toBe('on-face');

    const request = { camera: TOP_CAMERA, size: VIEW_SIZE, screen: screenOf(0, 0) };
    expect(pick(doc, doc.rootDefinitionId, IDENTITY, { ...request, clip: cut })).toBeNull();
    expect(pick(doc, doc.rootDefinitionId, IDENTITY, request)?.point.z).toBeCloseTo(2, 6);

    const store = doc.rootStore;
    const group = makeGroup(doc, doc.rootDefinitionId, {
      faces: [...store.faces()].map((face) => face.id),
      edges: [...store.edges()].map((edge) => edge.id),
    });
    const transform: Mat4 = store.getInstance(group.instance).transform;
    const inGroup = infer(doc, group.definition, transform, {
      camera: TOP_CAMERA,
      size: VIEW_SIZE,
      screen: screenOf(0.55, 0.5),
      clip: sectionClipping(doc, [group.instance], true),
    });
    expect(inGroup.kind).toBe('endpoint');
    expectPoint(inGroup.point, vec3(0.5, 0.5, 0));
  });

  it('skips excluded geometry but lets it hide what lies behind it', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const store = doc.rootStore;

    // Pushing the top face: its own corners aren't targets, the bottom corner below still is.
    const boundary = exclusionForBoundary(store, { faces: [horizontalFace(store, 1)] });
    const bottom = inferAt(doc, screenOf(1, 1), { exclude: boundary });
    expect(bottom.kind).toBe('endpoint');
    expectPoint(bottom.point, vec3(1, 1, 0));

    // Moving the whole box: nothing of it is a target, nor the face under the pointer.
    const moving = exclusionForMove(store, { faces: [...store.faces()].map((face) => face.id) });
    expect(inferAt(doc, screenOf(1, 1), { exclude: moving }).kind).toBe('free');
    expect(inferAt(doc, screenOf(0.6, 0.7), { exclude: moving }).kind).toBe('free');
  });

  it('names what a transaction added or moved', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const exclusion = exclusionForChanges(doc.rootStore, doc.rootDefinitionId, doc.lastTransaction);
    expect(exclusion.vertices.size).toBe(4);
    expect(exclusion.edges.size).toBe(4);
    expect(exclusion.faceTargets?.faces?.size).toBe(1);
  });
});

describe('tools do not snap to their own preview', () => {
  function extent(editor: Editor, axis: 'x' | 'y' | 'z') {
    const values = [...editor.session.doc.rootStore.vertices()].map((vertex) => vertex.position[axis]);
    return { min: Math.min(...values), max: Math.max(...values) };
  }

  function hover(editor: Editor, screen: { x: number; y: number }): void {
    editor.tools.pointerMove(pointer(screen.x, screen.y, { buttons: 0 }));
  }

  it('Move follows the pointer step by step', () => {
    const editor = createTestEditor();
    draw(editor.session.doc, boxEdges(0, 0, 0, 1, 1, 1));
    editor.selectAll();
    editor.tools.activate(MOVE_TOOL_ID);
    // Grab the top corner and drag right, 2 px (10 cm) at a time.
    const start = screenOf(1, 1);
    editor.tools.pointerDown(pointer(start.x, start.y));
    for (let step = 1; step <= 20; step++) {
      editor.tools.pointerMove(pointer(start.x + 2 * step, start.y));
      expect(extent(editor, 'x').max - 1).toBeCloseTo(0.1 * step, 6);
    }
    expect(editor.notifications.filter((notice) => notice.kind === 'error')).toEqual([]);
  });

  it('Rotate follows the pointer step by step', () => {
    const editor = createTestEditor();
    draw(editor.session.doc, boxEdges(1, -0.5, 0, 2, 0.5, 1));
    editor.selectAll();
    // Something far away to hover, so lines through the grabbed corner stop being remembered as references.
    draw(editor.session.doc, [segment([-3, -3, 0], [-3, -2.5, 0])]);
    editor.tools.activate(ROTATE_TOOL_ID);
    const pivot = screenOf(0, 0);
    click(editor, pivot.x, pivot.y);
    const grab = screenOf(2, 0.5);
    click(editor, grab.x, grab.y);
    hover(editor, screenOf(-3, -3));
    hover(editor, screenOf(-3, -2.5));
    const radius = Math.hypot(2, 0.5);
    const start = Math.atan2(0.5, 2);
    // Angles away from the 15° marks, where the angle snaps.
    for (const degrees of [4, 6, 8, 10, 12, 18, 20, 22, 24, 26]) {
      const angle = start + (degrees * Math.PI) / 180;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      hover(editor, screenOf(x, y));
      const corner = [...editor.session.doc.rootStore.vertices()].some(
        (vertex) => distance(vertex.position, vec3(x, y, 1)) < 1e-6,
      );
      expect(corner, `rotated by ${String(degrees)}°`).toBe(true);
    }
  });

  it('Push/Pull ignores the origin once the extrusion hides it', () => {
    const camera: CameraState = {
      eye: vec3(0, -8, 6),
      target: vec3(0, 0, 0.5),
      up: AXIS_Z,
      fovDegrees: 35,
      projection: 'perspective',
      orthoHalfHeight: 5,
    };
    const editor = createTestEditor();
    editor.session.setCamera(camera);
    draw(editor.session.doc, rectangle(-1, -1, 1, 1));
    editor.tools.activate(PUSH_PULL_TOOL_ID);
    const on = (point: Vec3) => {
      const screen = projectToScreen(camera, point, VIEW_SIZE);
      if (!screen) throw new Error('behind the camera');
      return { x: screen.x, y: screen.y };
    };
    const press = on(vec3(0, -0.5, 0));
    click(editor, press.x, press.y);
    hover(editor, on(vec3(0, -0.5, 2)));
    expect(extent(editor, 'z').max).toBeCloseTo(2, 6);
    // The origin sits at the middle of the base, behind the box's front face now. The pointer over it still means a
    // height where its ray passes the pulled face's normal line, not a snap to the hidden origin (height 0).
    hover(editor, on(vec3(0, 0, 0)));
    expect(editor.session.preview?.marker?.kind).not.toBe('origin');
    expect(extent(editor, 'z').max).toBeCloseTo(0.375, 6);
  });

  it('Offset follows the pointer step by step', () => {
    const editor = createTestEditor();
    draw(editor.session.doc, rectangle(-2, -2, 2, 2));
    editor.tools.activate(OFFSET_TOOL_ID);
    const press = screenOf(1.95, 0);
    click(editor, press.x, press.y);
    const offset = () => {
      const inner = [...editor.session.doc.rootStore.vertices()]
        .map((vertex) => vertex.position.x)
        .filter((x) => x < 2 - 1e-6);
      return 2 - Math.max(...inner);
    };
    for (let step = 1; step <= 10; step++) {
      hover(editor, screenOf(2 - 0.1 * step, 0));
      expect(offset()).toBeCloseTo(0.1 * step, 6);
    }
  });

  it('Scale picks the grip in front over the one hidden behind it', () => {
    const bottomView: CameraState = { ...TOP_CAMERA, eye: vec3(0, 0, -10) };
    const editor = createTestEditor();
    editor.session.setCamera(bottomView);
    draw(editor.session.doc, boxEdges(0, 0, 0, 1, 1, 1));
    editor.selectAll();
    editor.tools.activate(SCALE_TOOL_ID);
    const screen = projectToScreen(bottomView, vec3(0.5, 0.5, 0), VIEW_SIZE);
    if (!screen) throw new Error('behind the camera');
    hover(editor, screen);
    const marker = editor.session.preview?.marker;
    expect(marker?.point.z).toBeCloseTo(0, 6);
  });
});
