import type { CurveId, EdgeId, VertexId } from '../../kernel/ids';
import { transformPoint } from '../../kernel/math/mat4';
import { planeFromPointNormal, type Plane } from '../../kernel/math/plane';
import { add, cross, distance, dot, normalize, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import { addAnnotation } from '../../kernel/model/mutations';
import { EPS_LEN } from '../../kernel/tolerance';
import { cameraBasis } from '../camera/camera';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import { PRIMARY_BUTTON, type PointerInput, type PreviewLine, type Tool, type ToolPreview } from './Tool';
import { inferAt, markerFor, modelFrame, toLocalDirection, toLocalPoint } from './toolSupport';

export const DIMENSION_TOOL_ID = 'tool.dimension';

interface Anchor {
  /** World position. */
  readonly world: Vec3;
  /** The vertex at this point in the open context, which the dimension will follow. */
  readonly vertex: VertexId | null;
}

interface RadialTarget {
  readonly curve: CurveId;
  readonly diameter: boolean;
  /** World center of the arc or circle. */
  readonly center: Vec3;
}

/**
 * Places dimensions. Click two points (or an edge), then move to pull the dimension line away and click. Clicking an
 * arc or circle places a radius or diameter dimension. Dimensions follow the vertices and curves they measure.
 */
export class DimensionTool implements Tool {
  readonly id = DIMENSION_TOOL_ID;
  readonly label = 'Dimension';
  readonly cursor = 'crosshair';

  #start: Anchor | null = null;
  #end: Anchor | null = null;
  #radial: RadialTarget | null = null;
  #current: Inference | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#current = this.#infer(input, editor);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const inference = this.#infer(input, editor);
    this.#current = inference;
    const radial = this.#radial;
    if (radial) {
      this.#placeRadial(editor, radial, inference.point);
      return;
    }
    const start = this.#start;
    if (!start) {
      const curve = this.#curveAt(editor, inference);
      if (curve) {
        this.#radial = curve;
        return;
      }
      const edge = inference.kind === 'on-edge' ? this.#edgeAt(editor, inference) : null;
      if (edge) {
        [this.#start, this.#end] = edge;
        return;
      }
      this.#start = this.#anchorFor(editor, inference);
      return;
    }
    const end = this.#end;
    if (!end) {
      const anchor = this.#anchorFor(editor, inference);
      if (distance(anchor.world, start.world) > EPS_LEN) this.#end = anchor;
      return;
    }
    this.#placeLinear(editor, start, end, this.#offset(start, end, inference.point));
  }

  cancel(): void {
    this.#start = null;
    this.#end = null;
    this.#radial = null;
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && (this.#start || this.#radial)) {
      this.cancel();
      return true;
    }
    return false;
  }

  preview(): ToolPreview {
    const current = this.#current;
    const marker = markerFor(current);
    if (!current) return { lines: [], highlight: [], marker };
    const lines: PreviewLine[] = [];
    const radial = this.#radial;
    const start = this.#start;
    const end = this.#end;
    if (radial) {
      lines.push({ a: radial.center, b: current.point, style: 'preview' });
    } else if (start && end) {
      const offset = this.#offset(start, end, current.point);
      const a = add(start.world, offset);
      const b = add(end.world, offset);
      lines.push(
        { a: start.world, b: a, style: 'guide' },
        { a: end.world, b, style: 'guide' },
        { a, b, style: 'preview' },
      );
    } else if (start) {
      lines.push({ a: start.world, b: current.point, style: 'guide' });
    }
    return { lines, highlight: [], marker };
  }

  statusHint(): string {
    if (this.#radial) return 'Click to place the radius or diameter label.';
    if (!this.#start) return 'Click the first point, an edge, or an arc or circle to dimension.';
    if (!this.#end) return 'Click the second point.';
    return 'Move to pull the dimension away from the geometry, then click to place it.';
  }

  #infer(input: PointerInput, editor: Editor): Inference {
    const start = this.#start;
    const end = this.#end;
    if (start && end) return inferAt(editor, input, { fallbackPlane: this.#offsetPlane(editor, start, end) });
    return inferAt(editor, input, start ? { anchor: start.world } : {});
  }

  /** The plane the dimension line is pulled in: it contains the measured points and faces the viewer. */
  #offsetPlane(editor: Editor, start: Anchor, end: Anchor): Plane {
    const along = sub(end.world, start.world);
    const toward = cross(cameraBasis(editor.session.camera).forward, along);
    const normal = normalize(cross(along, toward)) ?? modelFrame(editor).z;
    return planeFromPointNormal(start.world, normal);
  }

  /** The component of `point − start` perpendicular to the measured segment. */
  #offset(start: Anchor, end: Anchor, point: Vec3): Vec3 {
    const direction = normalize(sub(end.world, start.world));
    const relative = sub(point, start.world);
    return direction ? sub(relative, scale(direction, dot(relative, direction))) : relative;
  }

  #anchorFor(editor: Editor, inference: Inference): Anchor {
    if (inference.inGroup) return { world: inference.point, vertex: null };
    const { session } = editor;
    const store = session.doc.store(session.activeContext);
    const [vertex] = store.verticesWithin(toLocalPoint(editor, inference.point), EPS_LEN);
    return { world: inference.point, vertex: vertex ?? null };
  }

  /** The endpoints of a straight edge of the open context under the pointer. */
  #edgeAt(editor: Editor, inference: Inference): [Anchor, Anchor] | null {
    const entity = inference.entity;
    if (entity?.kind !== 'edge' || inference.inGroup) return null;
    const { session } = editor;
    const store = session.doc.store(session.activeContext);
    const edge = store.edge(entity.id as EdgeId);
    if (edge?.curve !== null) return null;
    const toWorld = session.activeContextTransform;
    return [
      { world: transformPoint(toWorld, store.position(edge.v0)), vertex: edge.v0 },
      { world: transformPoint(toWorld, store.position(edge.v1)), vertex: edge.v1 },
    ];
  }

  /** An arc or circle of the open context under the pointer (on an edge or its midpoint). */
  #curveAt(editor: Editor, inference: Inference): RadialTarget | null {
    const entity = inference.entity;
    if (entity?.kind !== 'edge' || inference.inGroup) return null;
    if (inference.kind !== 'on-edge' && inference.kind !== 'midpoint') return null;
    const { session } = editor;
    const store = session.doc.store(session.activeContext);
    const curveId = store.edge(entity.id as EdgeId)?.curve ?? null;
    const curve = curveId === null ? undefined : store.curve(curveId);
    if (!curve || (curve.params.kind !== 'arc' && curve.params.kind !== 'circle')) return null;
    return {
      curve: curve.id,
      diameter: curve.params.kind === 'circle',
      center: transformPoint(session.activeContextTransform, curve.params.center),
    };
  }

  #placeLinear(editor: Editor, start: Anchor, end: Anchor, offset: Vec3): void {
    const { session } = editor;
    const doc = session.doc;
    const context = session.activeContext;
    this.cancel();
    doc.transact('Dimension', () =>
      addAnnotation(doc, context, {
        kind: 'linear-dimension',
        start: { point: toLocalPoint(editor, start.world), vertex: start.vertex },
        end: { point: toLocalPoint(editor, end.world), vertex: end.vertex },
        offset: toLocalDirection(editor, offset),
      }),
    );
  }

  #placeRadial(editor: Editor, target: RadialTarget, labelPoint: Vec3): void {
    const { session } = editor;
    const doc = session.doc;
    const context = session.activeContext;
    this.cancel();
    doc.transact('Dimension', () =>
      addAnnotation(doc, context, {
        kind: 'radial-dimension',
        curve: target.curve,
        diameter: target.diameter,
        labelPoint: toLocalPoint(editor, labelPoint),
      }),
    );
  }
}
