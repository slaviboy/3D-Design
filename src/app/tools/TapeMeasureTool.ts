import { add, distance, dot, normalize, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import { addGuideLine, addGuidePoint } from '../../kernel/model/mutations';
import { EPS_LEN } from '../../kernel/tolerance';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import {
  PRIMARY_BUTTON,
  TAPE_MEASURE_TOOL_ID,
  type MeasurementField,
  type PointerInput,
  type Tool,
  type ToolPreview,
} from './Tool';
import {
  formatDistance,
  inferAt,
  markerFor,
  toggleModifier,
  toggleModifierName,
  toLocalDirection,
  toLocalPoint,
} from './toolSupport';

/** How far a previewed guide line extends to each side of the pointer, in meters. */
const GUIDE_PREVIEW_HALF_LENGTH = 50;

const POINT_KINDS = new Set(['endpoint', 'midpoint', 'center', 'origin']);

interface Measure {
  readonly start: Inference;
  /** Unit direction of the edge the measurement started on, when it started on an edge's interior. */
  readonly edgeDirection: Vec3 | null;
}

/**
 * Measures distances. Starting on an edge creates a parallel guide line where you click next; starting on a point
 * creates a guide point. Holding the toggle key only measures.
 */
export class TapeMeasureTool implements Tool {
  readonly id = TAPE_MEASURE_TOOL_ID;
  readonly label = 'Tape Measure';
  readonly cursor = 'crosshair';

  #measure: Measure | null = null;
  #current: Inference | null = null;
  #lastDistance: number | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#current = this.#infer(input, editor);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const inference = this.#infer(input, editor);
    this.#current = inference;
    const measure = this.#measure;
    if (!measure) {
      const edge =
        inference.kind === 'on-edge' && inference.edge
          ? normalize(sub(inference.edge.b, inference.edge.a))
          : null;
      this.#measure = { start: inference, edgeDirection: edge };
      return;
    }
    this.#finish(editor, measure, inference.point, !toggleModifier(input, editor));
  }

  cancel(): void {
    this.#measure = null;
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#measure) {
      this.cancel();
      return true;
    }
    return false;
  }

  measurement(editor: Editor): MeasurementField {
    const measure = this.#measure;
    let value = this.#lastDistance === null ? '' : formatDistance(editor, this.#lastDistance);
    if (measure && this.#current)
      value = formatDistance(editor, this.#distance(measure, this.#current.point));
    return { label: 'Length', value, accepts: ['length'] };
  }

  onMeasurement(intent: MeasurementIntent, editor: Editor): void {
    const measure = this.#measure;
    const current = this.#current;
    if (intent.kind !== 'length') return;
    if (!measure || !current) throw new Error('Click the point or edge to measure from first');
    const direction = normalize(this.#offset(measure, current.point));
    if (!direction) throw new Error('Move the pointer to show the direction to measure in');
    this.#finish(editor, measure, add(measure.start.point, scale(direction, intent.value)), true);
  }

  preview(): ToolPreview {
    const measure = this.#measure;
    const current = this.#current;
    if (!measure || !current) return { lines: [], highlight: [], marker: markerFor(current) };
    const lines: ToolPreview['lines'][number][] = [
      { a: measure.start.point, b: current.point, style: 'guide' },
    ];
    if (measure.edgeDirection) {
      const reach = scale(measure.edgeDirection, GUIDE_PREVIEW_HALF_LENGTH);
      lines.push({ a: sub(current.point, reach), b: add(current.point, reach), style: 'guide' });
    }
    return { lines, highlight: [], marker: markerFor(current) };
  }

  statusHint(editor: Editor): string {
    return this.#measure
      ? `Click to finish measuring, or type a distance. ${toggleModifierName(editor)} measures without creating a guide.`
      : 'Click an edge to start a parallel guide line, or a point to place a guide point.';
  }

  #infer(input: PointerInput, editor: Editor): Inference {
    const measure = this.#measure;
    return inferAt(editor, input, measure ? { anchor: measure.start.point } : {});
  }

  /** From the start to `point`, measured perpendicular to the edge when starting on an edge. */
  #offset(measure: Measure, point: Vec3): Vec3 {
    const offset = sub(point, measure.start.point);
    const edge = measure.edgeDirection;
    return edge ? sub(offset, scale(edge, dot(offset, edge))) : offset;
  }

  #distance(measure: Measure, point: Vec3): number {
    const offset = this.#offset(measure, point);
    return Math.hypot(offset.x, offset.y, offset.z);
  }

  #finish(editor: Editor, measure: Measure, point: Vec3, createGuide: boolean): void {
    this.#measure = null;
    this.#lastDistance = measure.edgeDirection
      ? this.#distance(measure, point)
      : distance(measure.start.point, point);
    if (!createGuide || this.#lastDistance <= EPS_LEN) return;
    const { session } = editor;
    const doc = session.doc;
    const context = session.activeContext;
    if (measure.edgeDirection) {
      const guidePoint = add(measure.start.point, this.#offset(measure, point));
      doc.transact('Guide Line', () =>
        addGuideLine(
          doc,
          context,
          toLocalPoint(editor, guidePoint),
          toLocalDirection(editor, measure.edgeDirection ?? point),
        ),
      );
    } else if (POINT_KINDS.has(measure.start.kind)) {
      doc.transact('Guide Point', () => addGuidePoint(doc, context, toLocalPoint(editor, point)));
    }
  }
}
