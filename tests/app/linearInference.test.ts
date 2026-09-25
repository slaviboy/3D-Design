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
import { projectToScreen, type CameraState, type ViewportSize } from '../../src/app/camera/camera';
import { infer, type InferenceReferences } from '../../src/app/inference/inference';
import { LINE_TOOL_ID, PUSH_PULL_TOOL_ID } from '../../src/app/tools/Tool';
import { IDENTITY } from '../../src/kernel/math/mat4';
import { distancePointToSegment } from '../../src/kernel/math/segment';
import { AXIS_Z, vec3, type Vec3 } from '../../src/kernel/math/vec3';
import type { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { boxEdges, draw, newDocument, segment } from '../kernel/helpers';
import { click, createTestEditor, pointer, screenOf, TOP_CAMERA, VIEW_SIZE } from './fixtures';

const diagonal = { a: vec3(0, 0, 0), b: vec3(1, 1, 0) };

function inferWith(doc: ModelDocument, x: number, y: number, references: InferenceReferences, anchor?: Vec3) {
  return infer(doc, doc.rootDefinitionId, IDENTITY, {
    camera: TOP_CAMERA,
    size: VIEW_SIZE,
    screen: screenOf(x, y),
    references,
    ...(anchor ? { anchor } : {}),
  });
}

describe('linear inferences', () => {
  it('infers lines parallel and perpendicular to a recent edge through the anchor', () => {
    const doc = newDocument();
    const references = { points: [], edges: [diagonal] };
    const parallel = inferWith(doc, 3, 1.05, references, vec3(2, 0, 0));
    expect(parallel).toMatchObject({ kind: 'parallel', label: 'Parallel to Edge' });
    expect(parallel.point.x - 2).toBeCloseTo(parallel.point.y, 9);

    const perpendicular = inferWith(doc, 3, -1, references, vec3(2, 0, 0));
    expect(perpendicular).toMatchObject({ kind: 'perpendicular' });
    expect(perpendicular.point.x).toBeCloseTo(3);
    expect(perpendicular.point.y).toBeCloseTo(-1);
  });

  it('infers the extension of an edge and axis lines through a recent point', () => {
    const doc = newDocument();
    const extension = inferWith(doc, 3, 3.02, { points: [], edges: [diagonal] });
    expect(extension).toMatchObject({ kind: 'extension', label: 'On Edge Extension' });
    expect(extension.point.x).toBeCloseTo(extension.point.y, 9);

    const fromPoint = inferWith(doc, 5, 2.05, { points: [vec3(2, 2, 0)], edges: [] });
    expect(fromPoint).toMatchObject({ kind: 'from-point', label: 'From Point' });
    expect(fromPoint.point.y).toBeCloseTo(2);
  });

  it('prefers the axis through the anchor when a from-point line coincides with it', () => {
    const doc = newDocument();
    const result = inferWith(doc, 5, 0, { points: [vec3(3, 0, 0)], edges: [] }, vec3(1, 0, 0));
    expect(result.kind).toBe('on-axis');
  });

  it('prefers geometry to extensions and from-point lines at the same distance', () => {
    const doc = newDocument();
    draw(doc, [{ a: vec3(-4, 2, 0), b: vec3(4, 2, 0) }]);
    const result = inferWith(doc, 3, 2, {
      points: [vec3(0, -3, 0)],
      edges: [{ a: vec3(1, 0, 0), b: vec3(2, 0, 0) }],
    });
    expect(result.kind).toBe('on-edge');
  });

  it('remembers hovered endpoints and edges while drawing', () => {
    const editor = createTestEditor();
    draw(editor.session.doc, [{ a: vec3(-3, -3, 0), b: vec3(-1, -2, 0) }]);
    editor.activateTool(LINE_TOOL_ID);
    const endpoint = screenOf(-1, -2);
    editor.tools.pointerMove(pointer(endpoint.x, endpoint.y, { buttons: 0 }));
    expect(editor.session.preview?.marker?.label).toBe('Endpoint');
    click(editor, screenOf(2, 0).x, screenOf(2, 0).y);
    // Straight up from the start, level with the remembered endpoint.
    const aligned = screenOf(2.03, -2);
    editor.tools.pointerMove(pointer(aligned.x, aligned.y, { buttons: 0 }));
    expect(editor.session.preview?.marker?.kind).toMatch(/on-axis|from-point/);
  });
});

/**
 * Lines and edges through the same place, seen in perspective, where the two ways of working out the point differ by
 * rounding (about 1e-14 px). Rounding must not choose the label on each pointer move.
 */
describe('lines through the same place as the model', () => {
  const SIZE: ViewportSize = { width: 800, height: 600 };

  function perspectiveEditor(camera: CameraState): Editor {
    const editor = createTestEditor();
    editor.setViewportSize(SIZE);
    editor.session.setCamera(camera);
    return editor;
  }

  /** Moves the pointer a little off the screen position of a world point, and returns the marker's label. */
  function hoverNear(editor: Editor, point: Vec3, offset = { x: 0.3, y: 0.2 }): string {
    const screen = projectToScreen(editor.session.camera, point, SIZE);
    if (!screen) throw new Error('behind the camera');
    editor.tools.pointerMove(pointer(screen.x + offset.x, screen.y + offset.y, { buttons: 0 }));
    return editor.session.preview?.marker?.label ?? 'none';
  }

  const unexpected = (labels: Iterable<string>, allowed: readonly string[]) =>
    [...new Set(labels)].filter((label) => !allowed.includes(label));

  it('reads On Edge all along an edge that the axis line through a remembered corner runs along', () => {
    const editor = perspectiveEditor({
      eye: vec3(6, -9, 7),
      target: vec3(1, 1, 0.5),
      up: AXIS_Z,
      fovDegrees: 35,
      projection: 'perspective',
      orthoHalfHeight: 5,
    });
    draw(editor.session.doc, boxEdges(0, 0, 0, 3, 2, 1));
    editor.activateTool(LINE_TOOL_ID);
    // Passing the corner remembers it, and the red line through it lies on the top front edge.
    expect(hoverNear(editor, vec3(0, 0, 1), { x: 0, y: 0 })).toBe('Endpoint');
    const labels: string[] = [];
    for (let step = 0; step <= 150; step++) labels.push(hoverNear(editor, vec3(0.4 + step * 0.015, 0, 1)));
    expect(unexpected(labels, ['On Edge', 'Midpoint'])).toEqual([]);
  });

  describe('beside a taller box', () => {
    const camera: CameraState = {
      eye: vec3(7, -10, 6),
      target: vec3(2, 1, 0.8),
      up: AXIS_Z,
      fovDegrees: 35,
      projection: 'perspective',
      orthoHalfHeight: 5,
    };

    function twoBoxes(): Editor {
      const editor = perspectiveEditor(camera);
      draw(editor.session.doc, boxEdges(0, 0, 0, 2, 2, 1));
      draw(editor.session.doc, boxEdges(3, 1, 0, 4, 2, 2.5));
      return editor;
    }

    it('lets Push/Pull follow an edge instead of jumping between it and a From Point line along it', () => {
      const editor = twoBoxes();
      editor.activateTool(PUSH_PULL_TOOL_ID);
      const press = projectToScreen(camera, vec3(1, 1, 1), SIZE);
      if (!press) throw new Error('behind the camera');
      click(editor, press.x, press.y);
      // The taller box's front corner edge: passing its midpoint remembers the point, and the blue line through it.
      expect(hoverNear(editor, vec3(3, 1, 1.25), { x: 0, y: 0 })).toBe('Midpoint');
      const top = () =>
        Math.max(
          ...[...editor.session.doc.rootStore.vertices()]
            .filter((vertex) => vertex.position.x <= 2 + 1e-9)
            .map((vertex) => vertex.position.z),
        );
      const labels: string[] = [];
      const heights: number[] = [];
      for (let z = 0.3; z <= 1.1; z += 0.02) {
        labels.push(hoverNear(editor, vec3(3, 1, z), { x: 0.4, y: 0 }));
        heights.push(top());
      }
      expect(unexpected(labels, ['On Edge'])).toEqual([]);
      for (const [index, height] of heights.entries()) {
        if (index > 0) expect(height).toBeGreaterThan(heights[index - 1] ?? -Infinity);
      }
    });

    it('never names a point on an edge From Point, also where two edges meet', () => {
      const editor = twoBoxes();
      editor.activateTool(LINE_TOOL_ID);
      const corner = vec3(3, 1, 2.5);
      expect(hoverNear(editor, corner, { x: 0, y: 0 })).toBe('Endpoint');
      const center = projectToScreen(camera, corner, SIZE);
      if (!center) throw new Error('behind the camera');
      const edges = [...editor.session.doc.rootStore.edges()].map((edge) => [
        editor.session.doc.rootStore.position(edge.v0),
        editor.session.doc.rootStore.position(edge.v1),
      ]);
      const onEdges: string[] = [];
      for (let dy = -14; dy <= 14; dy += 1.5) {
        for (let dx = -14; dx <= 14; dx += 1.5) {
          editor.tools.pointerMove(pointer(center.x + dx, center.y + dy, { buttons: 0 }));
          const marker = editor.session.preview?.marker;
          if (marker?.kind !== 'from-point') continue;
          const point = marker.point;
          if (edges.some(([a, b]) => a && b && distancePointToSegment(point, a, b) < 1e-6)) {
            onEdges.push(`(${String(dx)}, ${String(dy)})`);
          }
        }
      }
      expect(onEdges).toEqual([]);
    });
  });

  it('keeps one label past the end of an edge, where its extension and a From Point line coincide', () => {
    const editor = perspectiveEditor({
      eye: vec3(4, -8, 6),
      target: vec3(1.5, 0, 0),
      up: AXIS_Z,
      fovDegrees: 35,
      projection: 'perspective',
      orthoHalfHeight: 5,
    });
    draw(editor.session.doc, [segment([0, 0, 0], [1, 0, 0])]);
    editor.activateTool(LINE_TOOL_ID);
    // Hovering the end remembers both the edge and the point.
    expect(hoverNear(editor, vec3(1, 0, 0), { x: 0, y: 0 })).toBe('Endpoint');
    const labels: string[] = [];
    for (let step = 0; step <= 120; step++) labels.push(hoverNear(editor, vec3(1.4 + step * 0.01, 0, 0)));
    expect(unexpected(labels, ['On Edge Extension'])).toEqual([]);
  });
});
