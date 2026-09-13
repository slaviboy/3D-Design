import type { Point2 } from '../math/geom2d';
import { GLYPH_ART, MISSING_GLYPH_ART } from './glyphArt';

/**
 * Planar's built-in outline font. Glyphs are traced from the cell drawings in `glyphArt.ts` into closed outlines in
 * font units, where one unit is one cell. The font is original to Planar and built entirely from this data, so text
 * looks the same on every machine and nothing is loaded from the network or the system.
 */

/** Rows from the baseline to the top of capitals and digits. */
export const CAP_HEIGHT_UNITS = 7;
/** Rows below the baseline used by descenders. */
export const DESCENDER_UNITS = 2;
/** Empty columns between neighbouring glyphs. */
export const GLYPH_GAP_UNITS = 1;
/** Advance of a space. */
export const SPACE_ADVANCE_UNITS = 3;
/** Distance between baselines at a line spacing of 1: glyph height plus two empty rows. */
export const LINE_ADVANCE_UNITS = CAP_HEIGHT_UNITS + DESCENDER_UNITS + 2;

/** A filled outline with holes. `outer` winds counter-clockwise and each hole clockwise (y up). */
export interface TextPolygon {
  readonly outer: readonly Point2[];
  readonly holes: readonly (readonly Point2[])[];
}

export interface Glyph {
  /** Width of the drawing in font units; the advance adds {@link GLYPH_GAP_UNITS}. */
  readonly width: number;
  /** Outlines in font units, with the baseline at y = 0 and the left edge at x = 0. */
  readonly polygons: readonly TextPolygon[];
}

type Corner = 'TL' | 'TR' | 'BR' | 'BL';

/** Counter-clockwise corners of each kind of cell piece. */
const PIECES: Readonly<Record<string, readonly Corner[]>> = {
  '#': ['BL', 'BR', 'TR', 'TL'],
  F: ['BL', 'TR', 'TL'],
  '7': ['BR', 'TR', 'TL'],
  L: ['BL', 'BR', 'TL'],
  J: ['BL', 'BR', 'TR'],
};

const key = (p: Point2): string => `${String(p.x)},${String(p.y)}`;

/**
 * Traces a cell drawing into outlines: the cell pieces' sides that no neighbouring piece shares form closed loops.
 * Throws when the drawing is malformed or two pieces touch at a single point.
 */
export function traceGlyph(art: readonly string[]): Glyph {
  const width = art[0]?.length ?? 0;
  if (width === 0) throw new Error('A glyph drawing needs at least one column');
  // Directed boundary sides, keyed "from>to"; a side shared by two pieces appears in both directions and cancels.
  const sides = new Map<string, { readonly from: Point2; readonly to: Point2 }>();
  art.forEach((row, rowIndex) => {
    if (row.length !== width) throw new Error(`Glyph row ${String(rowIndex)} has the wrong width`);
    const top = CAP_HEIGHT_UNITS - rowIndex;
    for (let column = 0; column < width; column++) {
      const symbol = row[column] ?? '.';
      if (symbol === '.') continue;
      const piece = PIECES[symbol];
      if (!piece) throw new Error(`Unknown glyph cell "${symbol}"`);
      const corners: Record<Corner, Point2> = {
        TL: { x: column, y: top },
        TR: { x: column + 1, y: top },
        BR: { x: column + 1, y: top - 1 },
        BL: { x: column, y: top - 1 },
      };
      piece.forEach((corner, i) => {
        const from = corners[corner];
        const to = corners[piece[(i + 1) % piece.length] ?? corner];
        const reverse = `${key(to)}>${key(from)}`;
        if (sides.has(reverse)) sides.delete(reverse);
        else sides.set(`${key(from)}>${key(to)}`, { from, to });
      });
    }
  });

  const outgoing = new Map<string, Point2>();
  for (const { from, to } of sides.values()) {
    if (outgoing.has(key(from))) throw new Error(`Glyph outline touches itself at ${key(from)}`);
    outgoing.set(key(from), to);
  }

  const rings: Point2[][] = [];
  const visited = new Set<string>();
  for (const { from } of sides.values()) {
    if (visited.has(key(from))) continue;
    const ring: Point2[] = [];
    let current = from;
    while (!visited.has(key(current))) {
      visited.add(key(current));
      ring.push(current);
      const next = outgoing.get(key(current));
      if (!next) throw new Error(`Glyph outline is open at ${key(current)}`);
      current = next;
    }
    rings.push(withoutCollinearPoints(ring));
  }

  const outers = rings.filter((ring) => ringArea(ring) > 0);
  const holes = rings.filter((ring) => ringArea(ring) < 0);
  const holesOf = outers.map((): Point2[][] => []);
  for (const hole of holes) {
    const probe = hole[0];
    let best = -1;
    outers.forEach((outer, index) => {
      if (!probe || !insideRing(probe, outer)) return;
      const current = outers[best];
      if (!current || ringArea(outer) < ringArea(current)) best = index;
    });
    const target = holesOf[best];
    if (!target) throw new Error('Glyph hole is outside every outline');
    target.push(hole);
  }
  return { width, polygons: outers.map((outer, index) => ({ outer, holes: holesOf[index] ?? [] })) };
}

function ringArea(ring: readonly Point2[]): number {
  let twice = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    twice += p.x * q.y - q.x * p.y;
  });
  return twice / 2;
}

/** Even-odd test for a point that is not on the ring (outlines never touch, so this holds for glyph points). */
function insideRing(point: Point2, ring: readonly Point2[]): boolean {
  let inside = false;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    if (a.y > point.y !== b.y > point.y) {
      const x = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (point.x < x) inside = !inside;
    }
  });
  return inside;
}

function withoutCollinearPoints(ring: readonly Point2[]): Point2[] {
  const result = [...ring];
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      const prev = result[(i - 1 + result.length) % result.length];
      const p = result[i];
      const next = result[(i + 1) % result.length];
      if (!prev || !p || !next) continue;
      if ((p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x) === 0) {
        result.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return result;
}

const glyphCache = new Map<string, Glyph>();
let cachedMissingGlyph: Glyph | null = null;

/** Every character with its own glyph, in code point order. The space is included and has no outline. */
export function supportedCharacters(): string[] {
  return [' ', ...Object.keys(GLYPH_ART)].sort((a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0));
}

export function hasGlyph(character: string): boolean {
  return character === ' ' || Object.hasOwn(GLYPH_ART, character);
}

/** The box drawn for characters the font doesn't have. */
export function missingGlyph(): Glyph {
  cachedMissingGlyph ??= traceGlyph(MISSING_GLYPH_ART);
  return cachedMissingGlyph;
}

/** The glyph for one character (a single code point); unknown characters get the box glyph. */
export function glyphFor(character: string): Glyph {
  if (character === ' ') return { width: SPACE_ADVANCE_UNITS - GLYPH_GAP_UNITS, polygons: [] };
  const art = Object.hasOwn(GLYPH_ART, character) ? GLYPH_ART[character] : undefined;
  if (!art) return missingGlyph();
  let glyph = glyphCache.get(character);
  if (!glyph) {
    glyph = traceGlyph(art);
    glyphCache.set(character, glyph);
  }
  return glyph;
}
