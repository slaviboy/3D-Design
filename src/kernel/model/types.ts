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
  SceneId,
  SectionPlaneId,
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

// -------------------------------------------------------------------------------------------------- section planes

export interface SectionPlaneState {
  readonly name: string;
  /** A point on the plane, in the coordinates of the context that owns it. */
  readonly point: Vec3;
  /** Unit normal. Geometry on the side the normal points to is cut away while the plane is active. */
  readonly normal: Vec3;
  /** At most one section plane per context is active. */
  readonly active: boolean;
}

/** A section plane. It cuts the view of its context (and everything nested inside it) while active. */
export interface SectionPlaneData extends SectionPlaneState {
  readonly id: SectionPlaneId;
}

// -------------------------------------------------------------------------------------------------- shadows

/** Sun and shadow settings of a document. Location is entered by hand; nothing is looked up online. */
export interface ShadowSettings {
  /** Whether shadows are cast. */
  readonly enabled: boolean;
  /** Local date and time with its UTC offset, as `YYYY-MM-DDTHH:MM:SS±HH:MM`. */
  readonly dateTime: string;
  /** Degrees, −90 (south) to 90 (north). */
  readonly latitude: number;
  /** Degrees, −180 (west) to 180 (east). */
  readonly longitude: number;
  /** Degrees clockwise, seen from above, from the model's green (+Y) axis to true north. */
  readonly northAngle: number;
  /** Strength of direct sunlight, 0 to 1. */
  readonly light: number;
  /** Strength of ambient light, which is what shadowed areas receive, 0 to 1. */
  readonly dark: number;
  /** Light the model from the sun's position even while shadows are off. */
  readonly useSunForShading: boolean;
  /** Faces receive shadows. */
  readonly onFaces: boolean;
  /** Shadows fall on the ground plane (z = 0). */
  readonly onGround: boolean;
}

/**
 * The settings of a new document. `light` and `dark` reproduce the fixed lighting used before shadow settings
 * existed, so documents without shadow settings look exactly as they did.
 */
export const DEFAULT_SHADOW_SETTINGS: ShadowSettings = Object.freeze({
  enabled: false,
  dateTime: '2026-09-21T13:30:00+00:00',
  latitude: 45,
  longitude: 0,
  northAngle: 0,
  light: 0.8,
  dark: 0.45,
  useSunForShading: false,
  onFaces: true,
  onGround: true,
});

// -------------------------------------------------------------------------------------------------- scenes

/** A saved view, with the same fields as the application's camera state. */
export interface SceneCamera {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly fovDegrees: number;
  readonly projection: 'perspective' | 'parallel';
  readonly orthoHalfHeight: number;
}

/** Which properties a scene stores and restores. */
export interface SceneSaves {
  readonly camera: boolean;
  readonly visibleTags: boolean;
  readonly activeSections: boolean;
  readonly shadows: boolean;
  readonly axes: boolean;
}

export const DEFAULT_SCENE_SAVES: SceneSaves = Object.freeze({
  camera: true,
  visibleTags: true,
  activeSections: true,
  shadows: true,
  axes: false,
});

/** The active section plane of one context when the scene was saved; `plane` is null when none was active. */
export interface SceneSectionState {
  readonly context: DefinitionId;
  readonly plane: SectionPlaneId | null;
}

export interface SceneState {
  readonly name: string;
  readonly description: string;
  readonly includeInAnimation: boolean;
  readonly saves: SceneSaves;
  /** Saved values. Each is null when its save flag was off when the scene was last updated. */
  readonly camera: SceneCamera | null;
  /** Tags that were hidden. Tags created later, or deleted since, are left as they are. */
  readonly hiddenTags: readonly TagId[] | null;
  /** Every context that had section planes, with its active plane. */
  readonly sections: readonly SceneSectionState[] | null;
  readonly shadows: ShadowSettings | null;
  readonly axes: ModelAxes | null;
}

export interface SceneData extends SceneState {
  readonly id: SceneId;
}
