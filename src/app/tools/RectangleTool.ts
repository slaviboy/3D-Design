import type { Plane } from '../../kernel/math/plane';
import { add, dot, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import type { TransactionRecord } from '../../kernel/model/ModelDocument';
import { insertSegments } from '../../kernel/ops/insertSegments';
import { EPS_LEN } from '../../kernel/tolerance';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import {
  PRIMARY_BUTTON,
  RECTANGLE_TOOL_ID,
  type MeasurementField,
  type PointerInput,
  type Tool,
  type ToolPreview,
} from './Tool';
import {
  canReplace,
  drawingPlane,
  formatDistance,
  inferAt,
  markerFor,
  planeAxes,
  projectOntoPlane,
  toLocalPoint,
} from './toolSupport';

interface Frame {
  readonly corner: Vec3;
  readonly plane: Plane;
  readonly u: Vec3;
  readonly v: Vec3;
}

interface Drawn {
  readonly frame: Frame;
  readonly width: number;
  readonly height: number;
  readonly record: TransactionRecord;
}

function corners(frame: Frame, width: number, height: number): Vec3[] {
  const along = scale(frame.u, width);
  const across = scale(frame.v, height);
  return [
    frame.corner,
    add(frame.corner, along),
    add(add(frame.corner, along), across),
    add(frame.corner, across),
  ];
}

/** Draws a rectangle from two corners, aligned with the axes of the plane it's drawn on. */
export class RectangleTool implements Tool {
  readonly id = RECTANGLE_TOOL_ID;
  readonly label = 'Rectangle';
  readonly cursor = 'crosshair';

  #frame: Frame | null = null;
  #current: Inference | null = null;
  #last: Drawn | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#current = this.#infer(input, editor);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const inference = this.#infer(input, editor);
    this.#current = inference;
    const frame = this.#frame;
    if (!frame) {
      const plane = drawingPlane(editor, inference);
      this.#frame = { corner: inference.point, plane, ...planeAxes(plane.normal) };
      return;
    }
    const { width, height } = this.#size(frame, inference.point);
    // A click that would make a degenerate rectangle is ignored; the tool keeps waiting for the opposite corner.
    if (Math.abs(width) <= EPS_LEN || Math.abs(height) <= EPS_LEN) return;
    this.#draw(editor, frame, width, height);
  }

  cancel(): void {
    this.#frame = null;
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#frame) {
      this.cancel();
      return true;
    }
    return false;
  }

  measurement(editor: Editor): MeasurementField {
    const frame = this.#frame;
    let value = '';
    if (frame && this.#current) {
      const { width, height } = this.#size(frame, this.#current.point);
      value = `${formatDistance(editor, Math.abs(width))}, ${formatDistance(editor, Math.abs(height))}`;
    } else if (this.#last) {
      value = `${formatDistance(editor, Math.abs(this.#last.width))}, ${formatDistance(editor, Math.abs(this.#last.height))}`;
    }
    return { label: 'Dimensions', value, accepts: ['lengthPair', 'length'] };
  }

  onMeasurement(intent: MeasurementIntent, editor: Editor): void {
    if (intent.kind !== 'lengthPair' && intent.kind !== 'length') return;
    const first = intent.kind === 'length' ? intent.value : intent.first;
    const second = intent.kind === 'length' ? null : intent.second;
    const signed = (typed: number | null, current: number): number =>
      typed === null ? current : (current < 0 ? -1 : 1) * typed;

    const frame = this.#frame;
    if (frame) {
      const current = this.#current ? this.#size(frame, this.#current.point) : { width: 0, height: 0 };
      this.#draw(editor, frame, signed(first, current.width), signed(second, current.height));
      return;
    }
    const last = this.#last;
    const doc = editor.session.doc;
    if (!last || !canReplace(doc, last.record))
      throw new Error('Click the first corner of a rectangle first');
    doc.rollbackLastTransaction();
    this.#last = null;
    this.#draw(editor, last.frame, signed(first, last.width), signed(second, last.height));
  }

  preview(): ToolPreview {
    const frame = this.#frame;
    const current = this.#current;
    if (!frame || !current) return { lines: [], highlight: [], marker: markerFor(current) };
    const { width, height } = this.#size(frame, current.point);
    const points = corners(frame, width, height);
    return {
      lines: points.map((a, i) => ({
        a,
        b: points[(i + 1) % points.length] ?? a,
        style: 'preview' as const,
      })),
      highlight: [],
      marker: markerFor(current),
    };
  }

  statusHint(): string {
    return this.#frame
      ? 'Click the opposite corner, or type the width and height, for example 2m,1m.'
      : 'Click the first corner of the rectangle.';
  }

  #infer(input: PointerInput, editor: Editor): Inference {
    const frame = this.#frame;
    if (!frame) return inferAt(editor, input);
    // No anchor: axis inferences through the first corner would only ever produce a flat rectangle.
    const inference = inferAt(editor, input, { fallbackPlane: frame.plane });
    return { ...inference, point: projectOntoPlane(frame.plane, inference.point) };
  }

  #size(frame: Frame, point: Vec3): { width: number; height: number } {
    const offset = sub(point, frame.corner);
    return { width: dot(offset, frame.u), height: dot(offset, frame.v) };
  }

  #draw(editor: Editor, frame: Frame, width: number, height: number): void {
    if (Math.abs(width) <= EPS_LEN || Math.abs(height) <= EPS_LEN) {
      throw new Error('A rectangle needs a width and a height');
    }
    const { session } = editor;
    const doc = session.doc;
    const points = corners(frame, width, height).map((point) => toLocalPoint(editor, point));
    doc.transact('Rectangle', () =>
      insertSegments(
        doc,
        session.activeContext,
        points.map((a, i) => ({ a, b: points[(i + 1) % points.length] ?? a })),
        { autoFace: true },
      ),
    );
    const record = doc.lastTransaction;
    this.#frame = null;
    this.#last = record ? { frame, width, height, record } : null;
  }
}
