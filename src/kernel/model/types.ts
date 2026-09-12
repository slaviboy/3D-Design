import type { CurveId, DefinitionId, EdgeId, FaceId, InstanceId, MaterialId, TagId, VertexId } from '../ids';
import type { Mat4 } from '../math/mat4';
import type { Vec3 } from '../math/vec3';

/** One edge traversal in a face loop. `reversed === false` means the loop goes from `edge.v0` to `edge.v1`. */
export interface LoopUse {
  readonly edge: EdgeId;
  readonly reversed: boolean;
}

export type Loop = readonly LoopUse[];

export interface FaceLoops {
  /** Counter-clockwise around the face normal. */
  readonly outer: Loop;
  /** Holes, each clockwise around the face normal. */
  readonly inners: readonly Loop[];
}

export interface EdgeAttributes {
  readonly soft: boolean;
  readonly smooth: boolean;
  readonly hidden: boolean;
  readonly materialId: MaterialId | null;
  readonly tagId: TagId | null;
}

export const DEFAULT_EDGE_ATTRIBUTES: EdgeAttributes = Object.freeze({
  soft: false,
  smooth: false,
  hidden: false,
  materialId: null,
  tagId: null,
});

export interface FaceAttributes {
  readonly frontMaterialId: MaterialId | null;
  readonly backMaterialId: MaterialId | null;
  readonly tagId: TagId | null;
  readonly hidden: boolean;
}

export const DEFAULT_FACE_ATTRIBUTES: FaceAttributes = Object.freeze({
  frontMaterialId: null,
  backMaterialId: null,
  tagId: null,
  hidden: false,
});

export interface InstanceAttributes {
  readonly name: string;
  readonly tagId: TagId | null;
  /** Material painted on the instance, applied to faces inside that have no material of their own. */
  readonly materialId: MaterialId | null;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly castShadows: boolean;
  readonly receiveShadows: boolean;
}

export const DEFAULT_INSTANCE_ATTRIBUTES: InstanceAttributes = Object.freeze({
  name: '',
  tagId: null,
  materialId: null,
  hidden: false,
  locked: false,
  castShadows: true,
  receiveShadows: true,
});

/** Local frame of a circular curve: the curve lies in the plane through `center` perpendicular to `normal`. */
export interface CurveFrame {
  readonly center: Vec3;
  readonly normal: Vec3;
  /** Unit vector in the curve plane that marks angle 0. */
  readonly xAxis: Vec3;
  readonly radius: number;
}

/** Parameters that let a curve be edited later (for example, changing a circle's radius or segment count). */
export type CurveParams =
  | ({ readonly kind: 'circle'; readonly segments: number } & CurveFrame)
  | ({
      readonly kind: 'arc';
      readonly startAngle: number;
      readonly endAngle: number;
      readonly segments: number;
    } & CurveFrame)
  | ({ readonly kind: 'polygon'; readonly sides: number } & CurveFrame)
  | { readonly kind: 'polyline' };

export type CurveKind = CurveParams['kind'];

export interface VertexData {
  readonly id: VertexId;
  readonly position: Vec3;
}

export interface EdgeData {
  readonly id: EdgeId;
  readonly v0: VertexId;
  readonly v1: VertexId;
  readonly attributes: EdgeAttributes;
}

export interface FaceData extends FaceLoops {
  readonly id: FaceId;
  readonly attributes: FaceAttributes;
}

export interface CurveData {
  readonly id: CurveId;
  readonly params: CurveParams;
  /** Edges in chain order: consecutive edges share a vertex. */
  readonly edges: readonly EdgeId[];
}

export interface InstanceData {
  readonly id: InstanceId;
  readonly definitionId: DefinitionId;
  readonly transform: Mat4;
  readonly attributes: InstanceAttributes;
}

export interface DefinitionAttributes {
  readonly name: string;
  /** Groups are definitions that have exactly one instance and aren't listed as reusable components. */
  readonly isGroup: boolean;
}

export interface DefinitionData extends DefinitionAttributes {
  readonly id: DefinitionId;
}

/** Linear RGB, each channel in [0, 1]. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface MaterialAttributes {
  readonly name: string;
  readonly color: Rgb;
  /** 0 = fully transparent, 1 = opaque. */
  readonly opacity: number;
}

export interface MaterialData extends MaterialAttributes {
  readonly id: MaterialId;
}

export interface TagAttributes {
  readonly name: string;
  readonly visible: boolean;
}

export interface TagData extends TagAttributes {
  readonly id: TagId;
}
