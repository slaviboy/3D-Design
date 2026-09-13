import type { Point2 } from '../math/geom2d';
import {
  CAP_HEIGHT_UNITS,
  DESCENDER_UNITS,
  GLYPH_GAP_UNITS,
  glyphFor,
  LINE_ADVANCE_UNITS,
  type TextPolygon,
} from './font';

export type TextAlign = 'left' | 'center' | 'right';

export const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'];

/** Line spacing is a multiple of the font's natural spacing, kept in this range so lines never overlap. */
export const MIN_LINE_SPACING = 1;
export const MAX_LINE_SPACING = 10;

/** Spaces a tab stands for. */
const TAB_SPACES = 4;

export interface TextLayoutOptions {
  /** Cap height in meters. */
  readonly height: number;
  readonly align?: TextAlign;
  /** Multiple of the natural line spacing, clamped to 1–10. Defaults to 1. */
  readonly lineSpacing?: number;
}

export interface TextBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface TextLayout {
  /** Outlines in meters, in a local frame: x along the text, y up, the last line's baseline on y = 0. */
  readonly polygons: readonly TextPolygon[];
  /** Width of the widest line. */
  readonly width: number;
  readonly lineCount: number;
  /** Bounds of the text block from the top of the first line's capitals to the last line's descenders. */
  readonly bounds: TextBounds;
  /** Size of one font cell in meters (the cap height divided by 7). */
  readonly unit: number;
}

/** Splits text into lines; tabs become spaces. */
export function textLines(text: string): string[] {
  return text.replace(/\t/g, ' '.repeat(TAB_SPACES)).split(/\r\n|\r|\n/);
}

function lineWidthUnits(characters: readonly string[]): number {
  if (characters.length === 0) return 0;
  return (
    characters.reduce((sum, character) => sum + glyphFor(character).width + GLYPH_GAP_UNITS, 0) -
    GLYPH_GAP_UNITS
  );
}

/**
 * Lays out text with the built-in font. Lines stack upwards from the last one, whose baseline starts at the origin
 * (left alignment), is centred on the widest line's middle, or ends at its right edge. Glyphs never touch: letters
 * are at least one cell apart and lines at least two.
 */
export function layoutText(text: string, options: TextLayoutOptions): TextLayout {
  const { height } = options;
  if (!Number.isFinite(height) || height <= 0) throw new RangeError('Text height must be a positive number');
  const unit = height / CAP_HEIGHT_UNITS;
  const align = options.align ?? 'left';
  const spacing = Math.min(MAX_LINE_SPACING, Math.max(MIN_LINE_SPACING, options.lineSpacing ?? 1));
  const lines = textLines(text).map((line) => Array.from(line));
  const widths = lines.map(lineWidthUnits);
  const widest = Math.max(0, ...widths);
  const polygons: TextPolygon[] = [];

  lines.forEach((characters, lineIndex) => {
    const lineWidth = widths[lineIndex] ?? 0;
    const startUnits =
      align === 'left' ? 0 : align === 'center' ? (widest - lineWidth) / 2 : widest - lineWidth;
    const baseline = (lines.length - 1 - lineIndex) * LINE_ADVANCE_UNITS * spacing;
    let x = startUnits;
    for (const character of characters) {
      const glyph = glyphFor(character);
      const place = (p: Point2): Point2 => ({ x: (x + p.x) * unit, y: (baseline + p.y) * unit });
      for (const polygon of glyph.polygons) {
        polygons.push({
          outer: polygon.outer.map(place),
          holes: polygon.holes.map((hole) => hole.map(place)),
        });
      }
      x += glyph.width + GLYPH_GAP_UNITS;
    }
  });

  const top = ((lines.length - 1) * LINE_ADVANCE_UNITS * spacing + CAP_HEIGHT_UNITS) * unit;
  return {
    polygons,
    width: widest * unit,
    lineCount: lines.length,
    bounds: { minX: 0, minY: -DESCENDER_UNITS * unit, maxX: widest * unit, maxY: top },
    unit,
  };
}
