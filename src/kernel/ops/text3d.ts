import { KernelError } from '../errors';
import type { DefinitionId, EdgeId, FaceId } from '../ids';
import type { Point2 } from '../math/geom2d';
import { isMat4, type Mat4 } from '../math/mat4';
import { planeFromPointNormal } from '../math/plane';
import { cross, dot, isFiniteVec3, normalize, scale, sub, vec3, type Vec3 } from '../math/vec3';
import type { ModelDocument } from '../model/ModelDocument';
import { addDefinition, addInstance } from '../model/mutations';
import {
  DEFAULT_FACE_ATTRIBUTES,
  DEFAULT_INSTANCE_ATTRIBUTES,
  type InstanceAttributes,
} from '../model/types';
import type { TextPolygon } from '../text/font';
import { layoutText, type TextAlign } from '../text/layout';
import { EPS_LEN } from '../tolerance';
import { uniqueDefinitionName, type CreatedInstance } from './hierarchy';
import { insertSegments, type SegmentInput } from './insertSegments';
import { settleRegion } from './planar/settle';
import { pushPull } from './pushPull';

/** Smallest cap height: the font's thinnest features then stay far above the length tolerance. */
export const MIN_TEXT_HEIGHT = 0.001;
/** Longest text accepted, in characters, so a pasted document can't stall the editor. */
export const MAX_TEXT_LENGTH = 2000;

export interface Text3DOptions {
  readonly text: string;
  /** Cap height in meters. */
  readonly height: number;
  readonly align?: TextAlign;
  /** Multiple of the font's natural line spacing (1–10). */
  readonly lineSpacing?: number;
  /** Faces inside the letters (true, the default) or only their outline edges. */
  readonly filled?: boolean;
  /** Extrusion depth in meters along the text's normal; 0 (the default) keeps the letters flat. Needs `filled`. */
  readonly depth?: number;
  /** Make a reusable component instead of a group. */
  readonly component?: boolean;
  /** Attributes of the new instance (tag, name…). Its name defaults to the text's first line. */
  readonly instanceAttributes?: Partial<InstanceAttributes>;
}

/** Where the text goes: its local x runs along the lines, y up the letters, and the normal is x × y. */
export interface TextFrame {
  readonly origin: Vec3;
  readonly xAxis: Vec3;
  readonly yAxis: Vec3;
}

export type TextPlacement = Mat4 | TextFrame;

export interface Created3DText extends CreatedInstance {
  readonly faces: number;
  readonly edges: number;
}

/** An orthonormal transform from a frame; y is made perpendicular to x. Throws for degenerate axes. */
export function textFrameTransform(frame: TextFrame): Mat4 {
  const x = isFiniteVec3(frame.xAxis) ? normalize(frame.xAxis) : null;
  const yRaw = x && isFiniteVec3(frame.yAxis) ? sub(frame.yAxis, scale(x, dot(frame.yAxis, x))) : null;
  const y = yRaw ? normalize(yRaw) : null;
  if (!x || !y || !isFiniteVec3(frame.origin)) {
    throw new KernelError('invalid-geometry', 'The text needs a position and two independent directions');
  }
  const z = cross(x, y);
  const o = frame.origin;
  return [x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, o.x, o.y, o.z, 1];
}

/** The instance name for a text: its first non-empty line, shortened. */
export function textInstanceName(text: string): string {
  const line = text.split(/\r\n|\r|\n/).find((candidate) => candidate.trim() !== '') ?? '';
  const trimmed = line.trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed;
}

function validate(options: Text3DOptions): void {
  if (options.text.trim() === '') throw new KernelError('invalid-operation', 'Type some text first');
  if (options.text.length > MAX_TEXT_LENGTH) {
    throw new KernelError('invalid-operation', `Text is limited to ${String(MAX_TEXT_LENGTH)} characters`);
  }
  if (!Number.isFinite(options.height) || options.height < MIN_TEXT_HEIGHT) {
    throw new KernelError('invalid-geometry', 'The text height must be at least 1 mm');
  }
  const depth = options.depth ?? 0;
  if (!Number.isFinite(depth) || depth < 0) {
    throw new KernelError('invalid-geometry', 'The extrusion depth must be zero or more');
  }
  const spacing = options.lineSpacing ?? 1;
  if (!Number.isFinite(spacing)) throw new KernelError('invalid-geometry', 'Line spacing must be a number');
}

const ringPoints = (ring: readonly Point2[]): Vec3[] => ring.map((p) => vec3(p.x, p.y, 0));

/**
 * Creates 3D text from the built-in font as a new group (or component) in `context`, in one transaction.
 * Letters are drawn in the group's xy plane with their fronts facing +z: faces with holes when `filled`, then
 * extruded by `depth` towards +z, or outline edges only. GEOMETRY.md ("3D Text").
 */
export function create3DText(
  doc: ModelDocument,
  context: DefinitionId,
  placement: TextPlacement,
  options: Text3DOptions,
): Created3DText {
  return doc.transact('Place 3D Text', () => {
    validate(options);
    const transform = isMat4(placement) ? placement : textFrameTransform(placement);
    const layout = layoutText(options.text, {
      height: options.height,
      ...(options.align ? { align: options.align } : {}),
      ...(options.lineSpacing !== undefined ? { lineSpacing: options.lineSpacing } : {}),
    });
    if (layout.polygons.length === 0) throw new KernelError('invalid-operation', 'Type some text first');
    const filled = options.filled ?? true;
    const depth = options.depth ?? 0;

    const definition = addDefinition(
      doc,
      options.component === true
        ? { name: uniqueDefinitionName(doc, 'Text'), isGroup: false }
        : { name: 'Group', isGroup: true },
    );

    const segments: SegmentInput[] = [];
    const ranges: { readonly polygon: TextPolygon; readonly start: number; readonly end: number }[] = [];
    for (const polygon of layout.polygons) {
      const start = segments.length;
      for (const ring of [polygon.outer, ...polygon.holes]) {
        const points = ringPoints(ring);
        points.forEach((a, i) => segments.push({ a, b: points[(i + 1) % points.length] ?? a }));
      }
      ranges.push({ polygon, start, end: segments.length });
    }
    const inserted = insertSegments(doc, definition, segments, { autoFace: false });

    if (filled) {
      const up = vec3(0, 0, 1);
      const plane = planeFromPointNormal(vec3(0, 0, 0), up);
      const faces: FaceId[] = [];
      for (const { polygon, start, end } of ranges) {
        const seeds: EdgeId[] = [];
        for (let i = start; i < end; i++) seeds.push(...(inserted.segmentEdges[i] ?? []));
        faces.push(
          ...settleRegion(doc, definition, {
            plane,
            seeds,
            outer: ringPoints(polygon.outer),
            inners: polygon.holes.map(ringPoints),
            normal: up,
            attributes: DEFAULT_FACE_ATTRIBUTES,
            rule: 'merge',
          }),
        );
      }
      if (depth > EPS_LEN) for (const face of faces) pushPull(doc, definition, face, depth);
    }

    const instance = addInstance(doc, context, definition, transform, {
      ...DEFAULT_INSTANCE_ATTRIBUTES,
      name: textInstanceName(options.text),
      ...options.instanceAttributes,
    });
    const store = doc.store(definition);
    return { definition, instance, faces: store.faceCount, edges: store.edgeCount };
  });
}
