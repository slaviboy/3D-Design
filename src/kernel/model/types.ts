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
  readonly style: boolean;
  readonly fog: boolean;
}

export const DEFAULT_SCENE_SAVES: SceneSaves = Object.freeze({
  camera: true,
  visibleTags: true,
  activeSections: true,
  shadows: true,
  axes: false,
  style: false,
  fog: false,
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
  readonly style: StyleSettings | null;
  readonly fog: FogSettings | null;
}

export interface SceneData extends SceneState {
  readonly id: SceneId;
}

// -------------------------------------------------------------------------------------------------- styles

/** How faces are drawn. */
export type FaceStyle = 'wireframe' | 'hiddenLine' | 'shaded' | 'shadedWithTextures' | 'monochrome';

export const FACE_STYLES: readonly FaceStyle[] = [
  'wireframe',
  'hiddenLine',
  'shaded',
  'shadedWithTextures',
  'monochrome',
];

/** How edges are colored: one color, the edge's material, or the drawing axis they run along. */
export type EdgeColorMode = 'allSame' | 'byMaterial' | 'byAxis';

export const EDGE_COLOR_MODES: readonly EdgeColorMode[] = ['allSame', 'byMaterial', 'byAxis'];

/** Limits of the pixel sizes in style settings. */
export const STYLE_WIDTH_RANGE = Object.freeze({ min: 1, max: 20 });
export const STYLE_EXTENSION_RANGE = Object.freeze({ min: 0, max: 100 });

/** How the view is drawn: faces, edges and background. Colors are sRGB, each channel 0 to 1. */
export interface StyleSettings {
  readonly faceStyle: FaceStyle;
  /** Faces are see-through, on top of any face style. */
  readonly xRay: boolean;
  /** Color of faces with the default material. */
  readonly frontColor: Rgb;
  readonly backColor: Rgb;
  readonly showEdges: boolean;
  /** Edges hidden behind faces are drawn dashed. */
  readonly backEdges: boolean;
  /** Outline edges are drawn thicker. */
  readonly profiles: boolean;
  /** Width of profile edges in pixels. */
  readonly profileWidth: number;
  /** Nearer edges are drawn thicker. */
  readonly depthCue: boolean;
  /** Width of the nearest edges in pixels while depth cue is on. */
  readonly depthCueWidth: number;
  /** Edges run on past their ends. */
  readonly extensions: boolean;
  /** How far edges run on past their ends, in pixels. */
  readonly extensionLength: number;
  /** Edge ends are marked. */
  readonly endpoints: boolean;
  readonly edgeColorMode: EdgeColorMode;
  readonly edgeColor: Rgb;
  readonly backgroundColor: Rgb;
  readonly sky: boolean;
  readonly skyColor: Rgb;
  readonly ground: boolean;
  readonly groundColor: Rgb;
  /** Ground is drawn while the camera is below it. */
  readonly groundFromBelow: boolean;
}

/** An sRGB color from a 0xRRGGBB number. */
export const rgbFromHex = (hex: number): Rgb =>
  Object.freeze({ r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 });

/**
 * The style of a new document. Colors reproduce the fixed viewport colors used before styles existed, so documents
 * without style settings look exactly as they did.
 */
export const DEFAULT_STYLE_SETTINGS: StyleSettings = Object.freeze({
  faceStyle: 'shadedWithTextures',
  xRay: false,
  frontColor: rgbFromHex(0xf2f0ea),
  backColor: rgbFromHex(0x9eafc3),
  showEdges: true,
  backEdges: false,
  profiles: false,
  profileWidth: 3,
  depthCue: false,
  depthCueWidth: 4,
  extensions: false,
  extensionLength: 6,
  endpoints: false,
  edgeColorMode: 'allSame',
  edgeColor: rgbFromHex(0x1d232b),
  backgroundColor: rgbFromHex(0xdfe5eb),
  sky: false,
  skyColor: rgbFromHex(0x9cc3e6),
  ground: false,
  groundColor: rgbFromHex(0xc9c1b0),
  groundFromBelow: false,
});

/** A style saved in the model under a name. Names are unique within a document. */
export interface NamedStyle {
  readonly name: string;
  readonly settings: StyleSettings;
}

// -------------------------------------------------------------------------------------------------- fog

export interface FogSettings {
  readonly enabled: boolean;
  /** Distance from the camera where fog begins, in meters. */
  readonly start: number;
  /** Distance from the camera where fog hides everything, in meters; greater than `start`. */
  readonly end: number;
  /** Fog takes the style's background color instead of `color`. */
  readonly useBackgroundColor: boolean;
  /** sRGB, each channel 0 to 1. */
  readonly color: Rgb;
}

export const DEFAULT_FOG_SETTINGS: FogSettings = Object.freeze({
  enabled: false,
  start: 10,
  end: 200,
  useBackgroundColor: true,
  color: rgbFromHex(0xdfe5eb),
});

// -------------------------------------------------------------------------------------------------- environment

/** Environment ids are short lowercase words, for example `studio`; `custom` is an image loaded this session. */
export const ENVIRONMENT_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

/** Image-based lighting and backdrop around the model. */
export interface EnvironmentSettings {
  readonly enabled: boolean;
  /** Which environment: a built-in one, or `custom` for an image loaded in this session. */
  readonly environmentId: string;
  /** Turn of the environment around the blue axis, degrees in [0, 360). */
  readonly rotationDegrees: number;
  /** Brightness multiplier, 0 to 4. */
  readonly exposure: number;
  /** The environment replaces the style's background. */
  readonly showAsBackground: boolean;
  /** Painted materials reflect and are lit by the environment. */
  readonly useForReflections: boolean;
}

export const MAX_ENVIRONMENT_EXPOSURE = 4;

export const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = Object.freeze({
  enabled: false,
  environmentId: 'studio',
  rotationDegrees: 0,
  exposure: 1,
  showAsBackground: true,
  useForReflections: true,
});
