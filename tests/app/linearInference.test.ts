import { describe, expect, it } from 'vitest';
import { infer, type InferenceReferences } from '../../src/app/inference/inference';
import { LINE_TOOL_ID } from '../../src/app/tools/Tool';
import { IDENTITY } from '../../src/kernel/math/mat4';
import { vec3, type Vec3 } from '../../src/kernel/math/vec3';
import type { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { draw, newDocument } from '../kernel/helpers';
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
