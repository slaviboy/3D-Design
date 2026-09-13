import type {
  CurveId,
  DefinitionId,
  EdgeId,
  FaceId,
  GuideId,
  InstanceId,
  MaterialId,
  TagId,
  VertexId,
  AnnotationId,
  AssetId,
} from '../ids';
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

/**
 * How a texture is placed on one side of a face, on top of the default planar projection. Offsets are in meters
 * along the face's texture axes, the rotation is in radians (counter-clockwise), and the scales multiply the
 * material's tile size (negative values mirror).
 */
export interface TexturePlacement {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export const DEFAULT_TEXTURE_PLACEMENT: TexturePlacement = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
});

export interface FaceAttributes {
  readonly frontMaterialId: MaterialId | null;
  readonly backMaterialId: MaterialId | null;
  readonly tagId: TagId | null;
  readonly hidden: boolean;
  /** Texture placement on the front; null uses the default projection. */
  readonly frontTexturePlacement: TexturePlacement | null;
  /** Texture placement on the back; null uses the default projection. */
  readonly backTexturePlacement: TexturePlacement | null;
}

export const DEFAULT_FACE_ATTRIBUTES: FaceAttributes = Object.freeze({
  frontMaterialId: null,
  backMaterialId: null,
  tagId: null,
  hidden: false,
  frontTexturePlacement: null,
  backTexturePlacement: null,
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

export interface GuideAttributes {
  readonly hidden: boolean;
  readonly tagId: TagId | null;
}

export const DEFAULT_GUIDE_ATTRIBUTES: GuideAttributes = Object.freeze({
  hidden: false,
  tagId: null,
});

/** Where a construction guide is: an infinite line through `point`, or a single point. */
export type GuideGeometry =
  | {
      readonly kind: 'line';
      readonly point: Vec3;
      /** Unit direction of the line. */
      readonly direction: Vec3;
    }
  | { readonly kind: 'point'; readonly point: Vec3 };

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

/** A construction guide. Guides help place geometry but never take part in topology. */
export interface GuideData {
  readonly id: GuideId;
  readonly geometry: GuideGeometry;
  readonly attributes: GuideAttributes;
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

/** An image tiled over faces. `width` and `height` are the size of one tile in meters. */
export interface MaterialTexture {
  readonly assetId: AssetId;
  readonly width: number;
  readonly height: number;
}

export interface MaterialAttributes {
  readonly name: string;
  readonly color: Rgb;
  /** 0 = fully transparent, 1 = opaque. */
  readonly opacity: number;
  /** 0 = dielectric, 1 = metal. */
  readonly metalness: number;
  /** 0 = polished, 1 = matte. */
  readonly roughness: number;
  readonly texture: MaterialTexture | null;
}

export const DEFAULT_MATERIAL_METALNESS = 0;
export const DEFAULT_MATERIAL_ROUGHNESS = 1;

/** What a new material needs; the physical attributes default to a matte, opaque, untextured surface. */
export type MaterialInput = Pick<MaterialAttributes, 'name' | 'color'> &
  Partial<Omit<MaterialAttributes, 'name' | 'color'>>;

export function materialAttributesFrom(input: MaterialInput): MaterialAttributes {
  return {
    name: input.name,
    color: input.color,
    opacity: input.opacity ?? 1,
    metalness: input.metalness ?? DEFAULT_MATERIAL_METALNESS,
    roughness: input.roughness ?? DEFAULT_MATERIAL_ROUGHNESS,
    texture: input.texture ?? null,
  };
}

export interface MaterialData extends MaterialAttributes {
  readonly id: MaterialId;
}

/** Image formats a texture asset may use. */
export type TextureMimeType = 'image/png' | 'image/jpeg';

/** An image stored in the document. `bytes` are the encoded file and must never be modified after creation. */
export interface TextureAssetData {
  readonly id: AssetId;
  readonly name: string;
  readonly mimeType: TextureMimeType;
  /** Pixel size, read from the image header. */
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

export interface TagAttributes {
  readonly name: string;
  readonly visible: boolean;
  /** Display color of the tag (used by color-by-tag styles and shown in the Tags panel). */
  readonly color: Rgb;
}

/** Color given to tags read from files that predate tag colors. */
export const DEFAULT_TAG_COLOR: Rgb = Object.freeze({ r: 0.5, g: 0.5, b: 0.5 });

export interface TagData extends TagAttributes {
  readonly id: TagId;
}

/** The drawing axes: an origin and two perpendicular unit directions. The blue axis is their cross product. */
export interface ModelAxes {
  readonly origin: Vec3;
  /** Red axis. */
  readonly xAxis: Vec3;
  /** Green axis. */
  readonly yAxis: Vec3;
}

export const DEFAULT_MODEL_AXES: ModelAxes = Object.freeze({
  origin: Object.freeze({ x: 0, y: 0, z: 0 }),
  xAxis: Object.freeze({ x: 1, y: 0, z: 0 }),
  yAxis: Object.freeze({ x: 0, y: 1, z: 0 }),
});

/** A point an annotation refers to. While `vertex` exists in the same context, the annotation follows it. */
export interface AnnotationAnchor {
  readonly point: Vec3;
  readonly vertex: VertexId | null;
}

export type AnnotationGeometry =
  | {
      readonly kind: 'linear-dimension';
      readonly start: AnnotationAnchor;
      readonly end: AnnotationAnchor;
      /** From the measured points to the dimension line. */
      readonly offset: Vec3;
    }
  | {
      readonly kind: 'radial-dimension';
      readonly curve: CurveId;
      /** Measure the diameter instead of the radius. */
      readonly diameter: boolean;
      readonly labelPoint: Vec3;
    }
  | {
      readonly kind: 'leader-text';
      readonly target: AnnotationAnchor;
      /** From the target to the label. */
      readonly offset: Vec3;
    }
  | {
      readonly kind: 'screen-text';
      /** Position in the view as fractions of its width and height, 0 to 1. */
      readonly x: number;
      readonly y: number;
    };

export type AnnotationKind = AnnotationGeometry['kind'];

export interface AnnotationAttributes {
  /** Text to show. For dimensions, null shows the measured value, which updates as the model changes. */
  readonly text: string | null;
  readonly hidden: boolean;
  readonly tagId: TagId | null;
}

export const DEFAULT_ANNOTATION_ATTRIBUTES: AnnotationAttributes = Object.freeze({
  text: null,
  hidden: false,
  tagId: null,
});

export interface AnnotationState {
  readonly geometry: AnnotationGeometry;
  readonly attributes: AnnotationAttributes;
}

/** A dimension or a text label. Annotations describe the model but never take part in topology. */
export interface AnnotationData extends AnnotationState {
  readonly id: AnnotationId;
}
