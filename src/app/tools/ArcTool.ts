import type { Plane } from '../../kernel/math/plane';
import { add, cross, distance, dot, length, normalize, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import type { TransactionRecord } from '../../kernel/model/ModelDocument';
import { DEFAULT_ARC_SEGMENTS, insertCurve, MAX_CURVE_SEGMENTS } from '../../kernel/ops/curves';
import { insertSegments } from '../../kernel/ops/insertSegments';
import { EPS_LEN } from '../../kernel/tolerance';
import type { MeasurementIntent, MeasurementKind } from '../../kernel/vcb/parseMeasurement';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import {
  PRIMARY_BUTTON,
  type MeasurementField,
  type PointerInput,
  type PreviewLine,
  type Tool,
  type ToolPreview,
} from './Tool';
import {
  canReplace,
  drawingPlane,
  formatDistance,
  inferAt,
  lineStyleBetween,
  markerFor,
  projectOntoPlane,
  toLocalDirection,
  toLocalNormal,
  toLocalPoint,
} from './toolSupport';
import { formatAngleValue, MIN_ANGLE, signedAngle, snapAngle } from './transformSupport';

export const ARC_TOOL_ID = 'tool.arc';
export const TWO_POINT_ARC_TOOL_ID = 'tool.twoPointArc';
export const THREE_POINT_ARC_TOOL_ID = 'tool.threePointArc';
export const PIE_TOOL_ID = 'tool.pie';

/**
 * - `center`: center, start point (radius), end angle.
 * - `two-point`: start, end, bulge.
 * - `three-point`: three points on the arc.
 * - `pie`: like `center`, closed with two radii into a face.
 */
export type ArcMode = 'center' | 'two-point' | 'three-point' | 'pie';

const FULL_TURN = 2 * Math.PI;

/** An arc in world coordinates, sweeping counterclockwise about `normal` from `xAxis`. */
export interface ArcSpec {
  readonly center: Vec3;
  readonly normal: Vec3;
  readonly xAxis: Vec3;
  readonly radius: number;
  /** In (0, 2π). */
  readonly sweep: number;
}

function arcPoint(spec: ArcSpec, angle: number): Vec3 {
  const yAxis = cross(spec.normal, spec.xAxis);
  return add(
    spec.center,
    add(scale(spec.xAxis, spec.radius * Math.cos(angle)), scale(yAxis, spec.radius * Math.sin(angle))),
  );
}

export function arcEndPoints(spec: ArcSpec): { start: Vec3; end: Vec3 } {
  return { start: arcPoint(spec, 0), end: arcPoint(spec, spec.sweep) };
}

/** Center-based arc; a negative angle sweeps the other way. Null when degenerate. */
export function arcFromCenter(center: Vec3, start: Vec3, normal: Vec3, angle: number): ArcSpec | null {
  const radius = distance(center, start);
  const xAxis = normalize(sub(start, center));
  if (!xAxis || radius <= EPS_LEN || Math.abs(angle) <= MIN_ANGLE || Math.abs(angle) >= FULL_TURN)
    return null;
  return angle > 0
    ? { center, normal, xAxis, radius, sweep: angle }
    : { center, normal: scale(normal, -1), xAxis, radius, sweep: -angle };
}

/**
 * The arc from `start` to `end` whose middle is `bulge` away from the chord, toward `side` (a unit vector in the
 * arc's plane, perpendicular to the chord). Null when degenerate.
 */
export function arcFromChord(start: Vec3, end: Vec3, bulge: number, side: Vec3): ArcSpec | null {
  const chord = distance(start, end);
  const height = Math.abs(bulge);
  if (chord <= EPS_LEN || height <= EPS_LEN) return null;
  const direction = scale(side, Math.sign(bulge));
  const radius = (chord * chord) / 4 / (2 * height) + height / 2;
  const middle = scale(add(start, end), 0.5);
  const center = add(middle, scale(direction, height - radius));
  const top = add(middle, scale(direction, height));
  const xAxis = normalize(sub(start, center));
  const normal = normalize(cross(sub(start, center), sub(top, center)));
  if (!xAxis || !normal) return null;
  return { center, normal, xAxis, radius, sweep: 4 * Math.atan((2 * height) / chord) };
}

/** The arc from `a` through `b` to `c`. Null when the points are (nearly) collinear. */
export function arcThroughPoints(a: Vec3, b: Vec3, c: Vec3): ArcSpec | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n = cross(ab, ac);
  const nn = dot(n, n);
  if (nn <= EPS_LEN * EPS_LEN * dot(ab, ab) * dot(ac, ac) || nn === 0) return null;
  const offset = scale(add(scale(cross(n, ab), dot(ac, ac)), scale(cross(ac, n), dot(ab, ab))), 1 / (2 * nn));
  const center = add(a, offset);
  const normal = normalize(n);
  const xAxis = normalize(sub(a, center));
  const toC = normalize(sub(c, center));
  if (!normal || !xAxis || !toC) return null;
  let sweep = signedAngle(xAxis, toC, normal);
  if (sweep <= 0) sweep += FULL_TURN;
  return { center, normal, xAxis, radius: length(offset), sweep };
}

/** Radius for an arc over `chord` with the given bulge, or the bulge (sagitta) for a given radius. */
export function bulgeForRadius(chord: number, radius: number): number | null {
  const half = chord / 2;
  if (radius < half - EPS_LEN) return null;
  return radius - Math.sqrt(Math.max(0, radius * radius - half * half));
}

interface Drawn {
  readonly spec: ArcSpec;
  readonly record: TransactionRecord;
}

/** Draws arcs as curve entities, in four ways (see {@link ArcMode}). */
export class ArcTool implements Tool {
  readonly id: string;
  readonly label: string;
  readonly cursor = 'crosshair';
  readonly #mode: ArcMode;

  #segments = DEFAULT_ARC_SEGMENTS;
  #points: Vec3[] = [];
  #plane: Plane | null = null;
  #current: Inference | null = null;
  #last: Drawn | null = null;

  constructor(mode: ArcMode) {
    this.#mode = mode;
    const ids: Record<ArcMode, [string, string]> = {
      center: [ARC_TOOL_ID, 'Arc'],
      'two-point': [TWO_POINT_ARC_TOOL_ID, '2-Point Arc'],
      'three-point': [THREE_POINT_ARC_TOOL_ID, '3-Point Arc'],
      pie: [PIE_TOOL_ID, 'Pie'],
    };
    [this.id, this.label] = ids[mode];
  }

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#current = this.#infer(input, editor);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const inference = this.#infer(input, editor);
    this.#current = inference;
    const point = this.#currentPoint();
    if (!point) return;
    if (this.#points.length === 0) {
      const plane = drawingPlane(editor, inference);
      this.#plane = plane;
      this.#points = [projectOntoPlane(plane, point)];
      return;
    }
    if (this.#points.length === 1) {
      const [first] = this.#points;
      if (first && distance(first, point) > EPS_LEN) this.#points = [first, point];
      return;
    }
    const spec = this.#spec(point);
    if (spec) this.#draw(editor, spec);
  }

  cancel(): void {
    this.#points = [];
    this.#plane = null;
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#points.length > 0) {
      this.cancel();
      return true;
    }
    return false;
  }

  measurement(editor: Editor): MeasurementField {
    const phase = this.#points.length;
    const point = this.#currentPoint();
    const [first, second] = this.#points;
    const radial = this.#mode === 'center' || this.#mode === 'pie';
    if (phase === 1 && first && point) {
      return {
        label: radial ? 'Radius' : 'Length',
        value: formatDistance(editor, distance(first, point)),
        accepts: radial ? ['length', 'radius', 'segments'] : ['length', 'segments'],
      };
    }
    if (phase === 2 && first && second) {
      const spec = point ? this.#spec(point) : null;
      if (radial) {
        return {
          label: 'Angle',
          value: spec ? formatAngleValue(editor, spec.sweep) : '',
          accepts: ['angle', 'segments'],
        };
      }
      if (this.#mode === 'two-point') {
        const bulge = point ? Math.abs(this.#bulge(point)) : 0;
        return {
          label: 'Bulge',
          value: formatDistance(editor, bulge),
          accepts: ['length', 'radius', 'segments'],
        };
      }
      return { label: 'Segments', value: String(this.#segments), accepts: ['segments'] };
    }
    const last = this.#last;
    const accepts: MeasurementKind[] = ['segments'];
    if (last && canReplace(editor.session.doc, last.record)) accepts.push('radius', 'angle');
    return { label: 'Segments', value: String(this.#segments), accepts };
  }

  onMeasurement(intent: MeasurementIntent, editor: Editor): void {
    if (intent.kind === 'segments') {
      if (intent.count > MAX_CURVE_SEGMENTS)
        throw new Error(`Enter up to ${String(MAX_CURVE_SEGMENTS)} segments`);
      this.#segments = intent.count;
      if (this.#points.length === 0) this.#redrawLast(editor, (spec) => spec);
      return;
    }
    const [first, second] = this.#points;
    const point = this.#currentPoint();
    const plane = this.#plane;

    if (this.#points.length === 1 && first && (intent.kind === 'length' || intent.kind === 'radius')) {
      const direction = point ? normalize(sub(point, first)) : null;
      if (!direction) throw new Error('Move the pointer to show the direction');
      this.#points = [first, add(first, scale(direction, intent.value))];
      return;
    }

    if (this.#points.length === 2 && first && second && plane) {
      if ((this.#mode === 'center' || this.#mode === 'pie') && intent.kind === 'angle') {
        const current = point ? this.#spec(point) : null;
        const sign = current && dot(current.normal, plane.normal) < 0 ? -1 : 1;
        const spec = arcFromCenter(first, second, plane.normal, sign * intent.radians);
        if (!spec) throw new Error('The angle must be between 0° and 360°');
        this.#draw(editor, spec);
        return;
      }
      if (this.#mode === 'two-point' && (intent.kind === 'length' || intent.kind === 'radius')) {
        const side = normalize(cross(plane.normal, sub(second, first)));
        const currentBulge = point ? this.#bulge(point) : 0;
        const sign = currentBulge < 0 ? -1 : 1;
        let bulge = intent.value;
        if (intent.kind === 'radius') {
          const fromRadius = bulgeForRadius(distance(first, second), intent.value);
          if (fromRadius === null)
            throw new Error('The radius must be at least half the distance between the ends');
          bulge = fromRadius;
        }
        const spec = side ? arcFromChord(first, second, sign * bulge, side) : null;
        if (!spec) throw new Error('The arc needs a bulge');
        this.#draw(editor, spec);
        return;
      }
    }

    if (this.#points.length === 0) {
      if (intent.kind === 'radius') {
        const radius = intent.value;
        this.#redrawLast(editor, (spec) => ({ ...spec, radius }));
      } else if (intent.kind === 'angle') {
        const angle = Math.abs(intent.radians);
        if (angle <= MIN_ANGLE || angle >= FULL_TURN)
          throw new Error('The angle must be between 0° and 360°');
        this.#redrawLast(editor, (spec) => ({ ...spec, sweep: angle }));
      }
    }
  }

  preview(): ToolPreview {
    const point = this.#currentPoint();
    const marker = markerFor(this.#current);
    const [first] = this.#points;
    if (!point || !first) return { lines: [], highlight: [], marker };
    if (this.#points.length === 1) {
      return {
        lines: [{ a: first, b: point, style: lineStyleBetween(first, point) }],
        highlight: [],
        marker,
      };
    }
    const spec = this.#spec(point);
    const lines: PreviewLine[] = [];
    if (spec) {
      let previous = arcPoint(spec, 0);
      for (let i = 1; i <= this.#segments; i++) {
        const next = arcPoint(spec, (spec.sweep * i) / this.#segments);
        lines.push({ a: previous, b: next, style: 'preview' });
        previous = next;
      }
      if (this.#mode === 'pie') {
        const { start, end } = arcEndPoints(spec);
        lines.push(
          { a: spec.center, b: start, style: 'preview' },
          { a: spec.center, b: end, style: 'preview' },
        );
      }
    } else {
      lines.push({ a: first, b: point, style: 'guide' });
    }
    return { lines, highlight: [], marker };
  }

  statusHint(): string {
    const phase = this.#points.length;
    switch (this.#mode) {
      case 'center':
      case 'pie':
        return (
          [
            'Click the center.',
            'Click the start point, or type the radius.',
            'Click the end point, or type the angle.',
          ][phase] ?? ''
        );
      case 'two-point':
        return (
          [
            'Click the start point.',
            'Click the end point, or type the length.',
            'Click to set the bulge, or type the bulge or a radius (2mr).',
          ][phase] ?? ''
        );
      case 'three-point':
        return (
          ['Click the first point on the arc.', 'Click a second point on the arc.', 'Click the end point.'][
            phase
          ] ?? ''
        );
    }
  }

  #infer(input: PointerInput, editor: Editor): Inference {
    const [anchor] = this.#points;
    const plane = this.#plane;
    return inferAt(editor, input, {
      ...(anchor ? { anchor } : {}),
      ...(plane && this.#mode !== 'three-point' ? { fallbackPlane: plane } : {}),
    });
  }

  /** The pointer position used for the next point: projected into the drawing plane except for 3-point arcs. */
  #currentPoint(): Vec3 | null {
    const current = this.#current;
    if (!current) return null;
    const plane = this.#plane;
    return plane && this.#mode !== 'three-point' ? projectOntoPlane(plane, current.point) : current.point;
  }

  #bulge(point: Vec3): number {
    const [first, second] = this.#points;
    const plane = this.#plane;
    if (!first || !second || !plane) return 0;
    const side = normalize(cross(plane.normal, sub(second, first)));
    if (!side) return 0;
    return dot(sub(point, scale(add(first, second), 0.5)), side);
  }

  #spec(point: Vec3): ArcSpec | null {
    const [first, second] = this.#points;
    const plane = this.#plane;
    if (!first || !second || !plane) return null;
    switch (this.#mode) {
      case 'center':
      case 'pie': {
        const xAxis = normalize(sub(second, first));
        const toPoint = normalize(sub(point, first));
        if (!xAxis || !toPoint) return null;
        return arcFromCenter(
          first,
          second,
          plane.normal,
          snapAngle(signedAngle(xAxis, toPoint, plane.normal)),
        );
      }
      case 'two-point': {
        const side = normalize(cross(plane.normal, sub(second, first)));
        return side ? arcFromChord(first, second, this.#bulge(point), side) : null;
      }
      case 'three-point':
        return arcThroughPoints(first, second, point);
    }
  }

  #redrawLast(editor: Editor, change: (spec: ArcSpec) => ArcSpec): void {
    const last = this.#last;
    const doc = editor.session.doc;
    if (!last || !canReplace(doc, last.record)) return;
    doc.rollbackLastTransaction();
    this.#last = null;
    this.#draw(editor, change(last.spec));
  }

  #draw(editor: Editor, spec: ArcSpec): void {
    if (spec.radius <= EPS_LEN) throw new Error('The arc needs a radius');
    const { session } = editor;
    const doc = session.doc;
    const context = session.activeContext;
    const center = toLocalPoint(editor, spec.center);
    let normal = toLocalNormal(editor, spec.normal);
    const localX = toLocalDirection(editor, scale(spec.xAxis, spec.radius));
    const xAxis = normalize(sub(localX, scale(normal, dot(localX, normal))));
    if (!xAxis) throw new Error("The arc can't be drawn in this group");
    // A mirrored group reverses the sweep direction; flip the normal so the arc still ends where it should.
    const localY = toLocalDirection(editor, cross(spec.normal, spec.xAxis));
    if (dot(cross(normal, xAxis), localY) < 0) normal = scale(normal, -1);
    const radius = length(localX);
    const pie = this.#mode === 'pie';
    doc.transact(pie ? 'Pie' : 'Arc', () => {
      insertCurve(doc, context, {
        kind: 'arc',
        center,
        normal,
        xAxis,
        radius,
        startAngle: 0,
        endAngle: spec.sweep,
        segments: this.#segments,
      });
      if (pie) {
        const { start, end } = arcEndPoints(spec);
        insertSegments(
          doc,
          context,
          [
            { a: center, b: toLocalPoint(editor, start) },
            { a: center, b: toLocalPoint(editor, end) },
          ],
          { autoFace: true },
        );
      }
    });
    const record = doc.lastTransaction;
    this.cancel();
    this.#last = record ? { spec, record } : null;
  }
}
