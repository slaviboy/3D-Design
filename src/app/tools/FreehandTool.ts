import type { Plane } from '../../kernel/math/plane';
import { distance, type Vec3 } from '../../kernel/math/vec3';
import { addCurve } from '../../kernel/model/mutations';
import { insertSegments } from '../../kernel/ops/insertSegments';
import { EPS_LEN } from '../../kernel/tolerance';
import { projectToScreen } from '../camera/camera';
import type { Editor } from '../Editor';
import { PRIMARY_BUTTON, type PointerInput, type Tool, type ToolPreview } from './Tool';
import { drawingPlane, inferAt, markerFor, projectOntoPlane, toLocalPoint } from './toolSupport';
import type { Inference } from '../inference/inference';

export const FREEHAND_TOOL_ID = 'tool.freehand';

/** A new point is recorded once the pointer has moved this far on screen. */
const SAMPLE_SPACING_PX = 6;
/** Ending this close to the start closes the stroke. */
const CLOSE_DISTANCE_PX = 10;

/** Press and drag to draw a polyline curve on the plane under the starting point. */
export class FreehandTool implements Tool {
  readonly id = FREEHAND_TOOL_ID;
  readonly label = 'Freehand';
  readonly cursor = 'crosshair';

  #plane: Plane | null = null;
  #points: Vec3[] = [];
  #lastScreen = { x: 0, y: 0 };
  #hover: Inference | null = null;

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const inference = inferAt(editor, input);
    this.#plane = drawingPlane(editor, inference);
    this.#points = [inference.point];
    this.#lastScreen = { x: input.x, y: input.y };
  }

  pointerMove(input: PointerInput, editor: Editor): void {
    const plane = this.#plane;
    if (!plane) {
      this.#hover = inferAt(editor, input);
      return;
    }
    if (Math.hypot(input.x - this.#lastScreen.x, input.y - this.#lastScreen.y) < SAMPLE_SPACING_PX) return;
    const inference = inferAt(editor, input, { fallbackPlane: plane });
    this.#points.push(projectOntoPlane(plane, inference.point));
    this.#lastScreen = { x: input.x, y: input.y };
  }

  pointerUp(input: PointerInput, editor: Editor): void {
    if (!this.#plane || input.button !== PRIMARY_BUTTON) return;
    const points = this.#points;
    this.cancel();
    if (points.length < 2) return;
    const [first] = points;
    const last = points.at(-1);
    if (first && last && points.length > 2) {
      const a = projectToScreen(editor.session.camera, first, editor.viewportSize);
      const b = projectToScreen(editor.session.camera, last, editor.viewportSize);
      if (a && b && Math.hypot(a.x - b.x, a.y - b.y) <= CLOSE_DISTANCE_PX) points[points.length - 1] = first;
    }
    this.#commit(editor, points);
  }

  cancel(): void {
    this.#plane = null;
    this.#points = [];
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#plane) {
      this.cancel();
      return true;
    }
    return false;
  }

  preview(): ToolPreview {
    const points = this.#points;
    return {
      lines: points.slice(1).map((b, i) => ({ a: points[i] ?? b, b, style: 'preview' as const })),
      highlight: [],
      marker: this.#plane ? null : markerFor(this.#hover),
    };
  }

  statusHint(): string {
    return this.#plane
      ? 'Release to finish. End at the start point to close the shape.'
      : 'Press and drag to draw freehand.';
  }

  #commit(editor: Editor, points: readonly Vec3[]): void {
    const segments: { a: Vec3; b: Vec3 }[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (a && b && distance(a, b) > EPS_LEN)
        segments.push({ a: toLocalPoint(editor, a), b: toLocalPoint(editor, b) });
    }
    if (segments.length === 0) return;
    const { session } = editor;
    const doc = session.doc;
    const context = session.activeContext;
    doc.transact('Freehand', () => {
      const result = insertSegments(doc, context, segments, { autoFace: true });
      const edges = result.segmentEdges.flat();
      const store = doc.store(context);
      const unique = new Set(edges).size === edges.length;
      if (edges.length > 1 && unique && edges.every((id) => store.getEdge(id).curve === null)) {
        addCurve(doc, context, { kind: 'polyline' }, edges);
      }
    });
  }
}
