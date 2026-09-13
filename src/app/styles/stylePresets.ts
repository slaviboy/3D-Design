import { sameStyle } from '../../kernel/model/presentation';
import {
  DEFAULT_STYLE_SETTINGS,
  rgbFromHex,
  type EdgeColorMode,
  type FaceStyle,
  type NamedStyle,
  type Rgb,
  type StyleSettings,
} from '../../kernel/model/types';

/** A style that ships with Planar. Presets are data; applying one copies its settings into the model. */
export interface StylePreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly settings: StyleSettings;
}

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: 'planar-default',
    name: 'Planar Default',
    description: 'Light faces with thin dark edges on a pale blue-gray background',
    settings: DEFAULT_STYLE_SETTINGS,
  },
  {
    id: 'sketch-lines',
    name: 'Sketch Lines',
    description: 'Warm paper background, bold outlines, and lines that run past their ends',
    settings: {
      ...DEFAULT_STYLE_SETTINGS,
      frontColor: rgbFromHex(0xfbf8f1),
      backColor: rgbFromHex(0xb9c4cf),
      profiles: true,
      profileWidth: 3,
      extensions: true,
      extensionLength: 8,
      endpoints: true,
      edgeColor: rgbFromHex(0x3b3530),
      backgroundColor: rgbFromHex(0xf4efe4),
    },
  },
  {
    id: 'monochrome-study',
    name: 'Monochrome Study',
    description: 'Every face in white and gray, ignoring materials, with outlines',
    settings: {
      ...DEFAULT_STYLE_SETTINGS,
      faceStyle: 'monochrome',
      frontColor: rgbFromHex(0xffffff),
      backColor: rgbFromHex(0xa8a8a8),
      profiles: true,
      profileWidth: 2,
      edgeColor: rgbFromHex(0x2a2a2a),
      backgroundColor: rgbFromHex(0xf5f5f5),
    },
  },
  {
    id: 'x-ray-study',
    name: 'X-Ray Study',
    description: 'See-through faces in material colors, to look inside a model',
    settings: {
      ...DEFAULT_STYLE_SETTINGS,
      faceStyle: 'shaded',
      xRay: true,
      edgeColor: rgbFromHex(0x24405e),
      backgroundColor: rgbFromHex(0xe8eef3),
    },
  },
  {
    id: 'hidden-line',
    name: 'Hidden Line',
    description: 'Black lines on white; faces only hide what is behind them',
    settings: {
      ...DEFAULT_STYLE_SETTINGS,
      faceStyle: 'hiddenLine',
      profiles: true,
      profileWidth: 2,
      edgeColor: rgbFromHex(0x000000),
      backgroundColor: rgbFromHex(0xffffff),
    },
  },
  {
    id: 'daylight-site',
    name: 'Daylight Site',
    description: 'A sky gradient above the horizon and a ground color below it',
    settings: {
      ...DEFAULT_STYLE_SETTINGS,
      profiles: true,
      profileWidth: 2,
      edgeColor: rgbFromHex(0x2b2f33),
      backgroundColor: rgbFromHex(0xe6eef5),
      sky: true,
      skyColor: rgbFromHex(0x7fb2e5),
      ground: true,
      groundColor: rgbFromHex(0xb9b19d),
    },
  },
];

export function stylePreset(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((preset) => preset.id === id);
}

/** The first preset whose settings equal the style, or undefined. */
export function matchingPreset(style: StyleSettings): StylePreset | undefined {
  return STYLE_PRESETS.find((preset) => sameStyle(preset.settings, style));
}

/** The first in-model style whose settings equal the style, or undefined. */
export function matchingInModelStyle(
  styles: readonly NamedStyle[],
  style: StyleSettings,
): NamedStyle | undefined {
  return styles.find((named) => sameStyle(named.settings, style));
}

/** A name like `Style 2` that no in-model style uses yet. */
export function uniqueStyleName(styles: readonly NamedStyle[], base = 'Style'): string {
  const names = new Set(styles.map((style) => style.name));
  for (let n = 1; ; n++) {
    const name = `${base} ${String(n)}`;
    if (!names.has(name)) return name;
  }
}

export const FACE_STYLE_LABELS: Readonly<Record<FaceStyle, string>> = {
  wireframe: 'Wireframe',
  hiddenLine: 'Hidden line',
  shaded: 'Shaded',
  shadedWithTextures: 'Shaded with textures',
  monochrome: 'Monochrome',
};

export const EDGE_COLOR_MODE_LABELS: Readonly<Record<EdgeColorMode, string>> = {
  allSame: 'All the same',
  byMaterial: 'By material',
  byAxis: 'By axis',
};

/** Environments built into the renderer, by id. `custom` is an image file loaded in this session. */
export const BUILTIN_ENVIRONMENTS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'studio', label: 'Soft Studio' },
  { id: 'dusk', label: 'Warm Dusk' },
];

export const CUSTOM_ENVIRONMENT_ID = 'custom';

/** `#rrggbb` for an sRGB color. */
export function rgbToHex(color: Rgb): string {
  const channel = (value: number): string =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** The sRGB color of `#rrggbb`, or null for other text. */
export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return match?.[1] ? rgbFromHex(Number.parseInt(match[1], 16)) : null;
}
