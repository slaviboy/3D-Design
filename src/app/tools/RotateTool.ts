import type { Plane } from '../../kernel/math/plane';
import { planeFromPointNormal } from '../../kernel/math/plane';
import { add, scale, type Vec3 } from '../../kernel/math/vec3';
import type { TransactionRecord } from '../../kernel/model/ModelDocument';
import {
  copyRepeatedly,
  transformEntities,
  type TransformResult,
  type TransformSelection,
} from '../../kernel/ops/transform';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import { worldUnitsPerPixel } from '../camera/camera';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import { Selection } from '../selection/Selection';
import { DRAG_THRESHOLD_PX } from './SelectTool';
import {
  PRIMARY_BUTTON,
  type MeasurementField,
  type PointerInput,
  type PreviewLine,
  type Tool,
  type ToolPreview,
} from './Tool';
import {
  axisForArrowKey,
  canReplace,
  errorMessage,
  inferAt,
  markerFor,
  Speculation,
  toggleModifier,
  toggleModifierName,
} from './toolSupport';
import {
  directionInPlane,
  formatAngleValue,
  MIN_ANGLE,
  PROTRACTOR_RADIUS_PX,
  protractorLines,
  protractorPlane,
  refsOfResult,
  rotationAbout,
  signedAngle,
  snapAngle,
  toLocalTransform,
  transformSelectionOf,
} from './transformSupport';

export const ROTATE_TOOL_ID = 'tool.rotate';

interface Pivot {
  readonly center: Vec3;
  readonly plane: Plane;
}

interface Operation {
  readonly pivot: Pivot;
  /** Unit direction of the angle's zero line. */
  readonly reference: Vec3;
  readonly selection: TransformSelection;
  readonly speculation: Speculation;
  readonly pressX: number;
  readonly pressY: number;
  angle: number;
  copy: boolean;
  dragged: boolean;
  current: Inference | null;
  result: TransformResult | null;
  error: string | null;
}

interface Finished {
  readonly pivot: Pivot;
  readonly selection: TransformSelection;
  readonly angle: number;
  readonly copy: boolean;
  readonly record: TransactionRecord;
}

/**
 * Rotates or copies the selection about an axis: click the center (the protractor aligns with the face under the
 * pointer, or an axis locked with the arrow keys), click the zero line, then click or type the angle. The toggle
 * key copies; after a copy, `6x` makes a radial array and `6/` divides the angle.
 */
export class RotateTool implements Tool {
  readonly id = ROTATE_TOOL_ID;
  readonly label = 'Rotate';
  readonly cursor = 'crosshair';

  #lockNormal: Vec3 | null = null;
  #pivot: Pivot | null = null;
  #operation: Operation | null = null;
  #current: Inference | null = null;
  #last: Finished | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    const operation = this.#operation;
    if (!operation) {
      const pivot = this.#pivot;
      this.#current = inferAt(
        editor,
        input,
        pivot ? { anchor: pivot.center, fallbackPlane: pivot.plane } : {},
      );
      return;
    }
    if (Math.hypot(input.x - operation.pressX, input.y - operation.pressY) > DRAG_THRESHOLD_PX) {
      operation.dragged = true;
    }
    operation.copy = toggleModifier(input, editor);
    const { center, plane } = operation.pivot;
    const inference = inferAt(editor, input, { anchor: center, fallbackPlane: plane });
    operation.current = inference;
    const direction = directionInPlane(plane, center, inference.point);
    if (direction) {
      this.#apply(editor, operation, snapAngle(signedAngle(operation.reference, direction, plane.normal)));
    }
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const operation = this.#operation;
    if (operation) {
      this.#commit(editor, operation);
      return;
    }
    const { session } = editor;
    const pivot = this.#pivot;
    if (!pivot) {
      if (session.selection.isEmpty) {
        const hit = editor.pickAt(input);
        if (!hit) return;
        session.setSelection(Selection.of([hit.ref]));
      }
      const inference = inferAt(editor, input);
      this.#current = inference;
      this.#pivot = { center: inference.point, plane: protractorPlane(editor, inference, this.#lockNormal) };
      return;
    }
    const inference = inferAt(editor, input, { anchor: pivot.center, fallbackPlane: pivot.plane });
    const reference = directionInPlane(pivot.plane, pivot.center, inference.point);
    if (!reference) return;
    this.#operation = {
      pivot,
      reference,
      selection: transformSelectionOf(session.selection),
      speculation: new Speculation(session.doc),
      pressX: input.x,
      pressY: input.y,
      angle: 0,
      copy: toggleModifier(input, editor),
      dragged: false,
      current: inference,
      result: null,
      error: null,
    };
  }

  pointerUp(input: PointerInput, editor: Editor): void {
    const operation = this.#operation;
    if (operation?.dragged && input.button === PRIMARY_BUTTON) this.#commit(editor, operation);
  }

  keyDown(chord: string): boolean {
    const axis = axisForArrowKey(chord);
    if (axis && !this.#operation) {
      this.#lockNormal = this.#lockNormal === axis ? null : axis;
      const pivot = this.#pivot;
      if (pivot && this.#lockNormal) {
        this.#pivot = { center: pivot.center, plane: planeFromPointNormal(pivot.center, this.#lockNormal) };
      }
      return true;
    }
    if (chord === 'Escape' && (this.#pivot || this.#operation)) {
      this.cancel();
      return true;
    }
    return false;
  }

  cancel(): void {
    this.#operation?.speculation.rollback();
    this.#operation = null;
    this.#pivot = null;
  }

  measurement(editor: Editor): MeasurementField {
    const angle = this.#operation?.angle ?? this.#last?.angle ?? null;
    return {
      label: 'Angle',
      value: angle === null ? '' : formatAngleValue(editor, Math.abs(angle)),
      accepts: ['angle', 'copies'],
    };
  }

  onMeasurement(intent: MeasurementIntent, editor: Editor): void {
    const operation = this.#operation;
    if (operation) {
      if (intent.kind !== 'angle')
        throw new Error('Finish the rotated copy first, then type the number of copies');
      this.#apply(editor, operation, (operation.angle < 0 ? -1 : 1) * intent.radians);
      if (operation.error !== null) throw new Error(operation.error);
      this.#commit(editor, operation);
      return;
    }
    const last = this.#last;
    const { session } = editor;
    const doc = session.doc;
    if (!last || !canReplace(doc, last.record)) throw new Error('Click the center of rotation first');
    if (intent.kind === 'copies' && !last.copy) {
      throw new Error('Arrays need a copy: hold the toggle key while rotating');
    }
    if (intent.kind !== 'copies' && intent.kind !== 'angle') return;
    doc.rollbackLastTransaction();
    this.#last = null;
    const { center, plane } = last.pivot;
    let angle = last.angle;
    let result: TransformResult;
    if (intent.kind === 'copies') {
      const step = intent.mode === 'external' ? last.angle : last.angle / intent.count;
      result = copyRepeatedly(doc, session.activeContext, last.selection, intent.count, (k) =>
        toLocalTransform(editor, rotationAbout(center, plane.normal, step * k)),
      );
    } else {
      angle = (last.angle < 0 ? -1 : 1) * intent.radians;
      result = transformEntities(
        doc,
        session.activeContext,
        last.selection,
        toLocalTransform(editor, rotationAbout(center, plane.normal, angle)),
        { copy: last.copy },
      );
    }
    const record = doc.lastTransaction;
    if (record) this.#last = { ...last, angle, record };
    session.setSelection(Selection.of(refsOfResult(result)));
  }

  preview(editor: Editor): ToolPreview {
    const operation = this.#operation;
    const pivot = operation?.pivot ?? this.#pivot;
    const lines: PreviewLine[] = pivot
      ? protractorLines(editor, pivot.center, pivot.plane.normal, operation?.reference ?? null)
      : [];
    if (operation && pivot) {
      const reach =
        worldUnitsPerPixel(editor.session.camera, pivot.center, editor.viewportSize) *
        PROTRACTOR_RADIUS_PX *
        1.5;
      lines.push({
        a: pivot.center,
        b: add(pivot.center, scale(operation.reference, reach)),
        style: 'guide',
      });
      if (operation.current) lines.push({ a: pivot.center, b: operation.current.point, style: 'preview' });
    }
    return { lines, highlight: [], marker: markerFor(operation?.current ?? this.#current) };
  }

  statusHint(editor: Editor): string {
    const operation = this.#operation;
    if (operation?.error) return operation.error;
    const key = toggleModifierName(editor);
    if (operation)
      return `Click or type the angle. ${key} copies; after a copy type 6x or 6/ for a radial array.`;
    if (this.#pivot) return 'Click the start of the angle (the zero line).';
    return 'Click the center of rotation. Arrow keys lock the rotation axis.';
  }

  #apply(editor: Editor, operation: Operation, angle: number): void {
    operation.angle = angle;
    operation.error = null;
    operation.result = null;
    const { session } = editor;
    try {
      if (Math.abs(angle) <= MIN_ANGLE) {
        operation.speculation.rollback();
        return;
      }
      const { center, plane } = operation.pivot;
      operation.result = operation.speculation.run(() =>
        transformEntities(
          session.doc,
          session.activeContext,
          operation.selection,
          toLocalTransform(editor, rotationAbout(center, plane.normal, angle)),
          { copy: operation.copy },
        ),
      );
    } catch (error) {
      operation.error = errorMessage(error);
    }
  }

  #commit(editor: Editor, operation: Operation): void {
    this.#operation = null;
    this.#pivot = null;
    if (operation.error !== null) {
      operation.speculation.rollback();
      editor.notify('error', operation.error);
      return;
    }
    const record = operation.speculation.commit();
    if (!record || !operation.result) return;
    this.#last = {
      pivot: operation.pivot,
      selection: operation.selection,
      angle: operation.angle,
      copy: operation.copy,
      record,
    };
    editor.session.setSelection(Selection.of(refsOfResult(operation.result)));
  }
}
