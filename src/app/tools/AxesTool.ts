import { add, cross, distance, length, normalize, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import { setModelAxes } from '../../kernel/model/mutations';
import { EPS_LEN } from '../../kernel/tolerance';
import { worldUnitsPerPixel } from '../camera/camera';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import { PRIMARY_BUTTON, type PointerInput, type PreviewLine, type Tool, type ToolPreview } from './Tool';
import { inferAt, markerFor } from './toolSupport';

export const AXES_TOOL_ID = 'tool.axes';

/** On-screen length of the red axis shown while placing the green one. */
const PREVIEW_AXIS_PX = 80;

/**
 * Moves the drawing axes: click the new origin, a point along the red axis, and a point toward the green axis.
 * Inference, drawing planes, arrow-key locks and typed coordinates then follow the new axes.
 */
export class AxesTool implements Tool {
  readonly id = AXES_TOOL_ID;
  readonly label = 'Axes';
  readonly cursor = 'crosshair';

  #origin: Vec3 | null = null;
  #red: Vec3 | null = null;
  #current: Inference | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    const origin = this.#origin;
    this.#current = inferAt(editor, input, origin ? { anchor: origin } : {});
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const origin = this.#origin;
    const inference = inferAt(editor, input, origin ? { anchor: origin } : {});
    this.#current = inference;
    if (!origin) {
      this.#origin = inference.point;
      return;
    }
    if (distance(origin, inference.point) <= EPS_LEN) return;
    const red = this.#red;
    if (!red) {
      this.#red = normalize(sub(inference.point, origin));
      return;
    }
    const toward = sub(inference.point, origin);
    if (length(cross(red, toward)) <= EPS_LEN) return;
    this.cancel();
    const doc = editor.session.doc;
    doc.transact('Place Axes', () => {
      setModelAxes(doc, { origin, xAxis: red, yAxis: toward });
    });
  }

  cancel(): void {
    this.#origin = null;
    this.#red = null;
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#origin) {
      this.cancel();
      return true;
    }
    return false;
  }

  preview(editor: Editor): ToolPreview {
    const origin = this.#origin;
    const current = this.#current;
    const lines: PreviewLine[] = [];
    if (origin && current) {
      const red = this.#red;
      if (red) {
        const reach =
          worldUnitsPerPixel(editor.session.camera, origin, editor.viewportSize) * PREVIEW_AXIS_PX;
        lines.push(
          { a: origin, b: add(origin, scale(red, reach)), style: 'axis-x' },
          { a: origin, b: current.point, style: 'axis-y' },
        );
      } else {
        lines.push({ a: origin, b: current.point, style: 'axis-x' });
      }
    }
    return { lines, highlight: [], marker: markerFor(current) };
  }

  statusHint(): string {
    if (!this.#origin) return 'Click to place the origin of the drawing axes.';
    if (!this.#red) return 'Click a point along the red axis.';
    return 'Click a point toward the green axis.';
  }
}
