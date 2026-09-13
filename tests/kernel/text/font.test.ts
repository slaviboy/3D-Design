import { describe, expect, it } from 'vitest';
import { classifyPointInRing, orient, signedArea, type Point2 } from '../../../src/kernel/math/geom2d';
import {
  CAP_HEIGHT_UNITS,
  DESCENDER_UNITS,
  GLYPH_GAP_UNITS,
  glyphFor,
  hasGlyph,
  LINE_ADVANCE_UNITS,
  missingGlyph,
  SPACE_ADVANCE_UNITS,
  supportedCharacters,
  traceGlyph,
  type TextPolygon,
} from '../../../src/kernel/text/font';
import { layoutText } from '../../../src/kernel/text/layout';

interface Segment {
  readonly a: Point2;
  readonly b: Point2;
  readonly ring: number;
  readonly index: number;
  readonly ringLength: number;
}

const onSegment = (p: Point2, a: Point2, b: Point2): boolean =>
  orient(a, b, p) === 0 &&
  p.x >= Math.min(a.x, b.x) &&
  p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) &&
  p.y <= Math.max(a.y, b.y);

/** Closed segments share at least one point. */
function segmentsTouch(s: Segment, t: Segment): boolean {
  const d1 = orient(t.a, t.b, s.a);
  const d2 = orient(t.a, t.b, s.b);
  const d3 = orient(s.a, s.b, t.a);
  const d4 = orient(s.a, s.b, t.b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    onSegment(s.a, t.a, t.b) ||
    onSegment(s.b, t.a, t.b) ||
    onSegment(t.a, s.a, s.b) ||
    onSegment(t.b, s.a, s.b)
  );
}

/** Every ring of every polygon: closed, simple, and apart from all the others. Holes lie inside their outline. */
function expectCleanOutlines(polygons: readonly TextPolygon[], label: string): void {
  const rings: (readonly Point2[])[] = [];
  for (const polygon of polygons) {
    expect(signedArea(polygon.outer), `${label}: outline winds counter-clockwise`).toBeGreaterThan(0);
    rings.push(polygon.outer);
    for (const hole of polygon.holes) {
      expect(signedArea(hole), `${label}: hole winds clockwise`).toBeLessThan(0);
      for (const point of hole) {
        expect(classifyPointInRing(point, polygon.outer), `${label}: hole inside outline`).toBe('inside');
      }
      rings.push(hole);
    }
  }
  const segments: Segment[] = rings.flatMap((ring, ringIndex) => {
    expect(ring.length, `${label}: ring has at least three points`).toBeGreaterThanOrEqual(3);
    return ring.map((a, index) => ({
      a,
      b: ring[(index + 1) % ring.length] ?? a,
      ring: ringIndex,
      index,
      ringLength: ring.length,
    }));
  });
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (!s) continue;
    for (let j = i + 1; j < segments.length; j++) {
      const t = segments[j];
      if (!t) continue;
      const adjacent =
        s.ring === t.ring &&
        ((s.index + 1) % s.ringLength === t.index || (t.index + 1) % t.ringLength === s.index);
      if (adjacent) {
        // Neighbours meet only at their shared corner and never fold back along each other.
        expect(
          orient(s.a, s.b, s.index + 1 === t.index ? t.b : t.a),
          `${label}: no collinear neighbours`,
        ).not.toBe(0);
        continue;
      }
      expect(segmentsTouch(s, t), `${label}: segments ${String(i)} and ${String(j)} touch`).toBe(false);
    }
  }
}

describe('built-in font', () => {
  it('covers Latin letters, digits and ASCII punctuation', () => {
    const characters = supportedCharacters();
    for (let code = 0x20; code <= 0x7e; code++) {
      expect(hasGlyph(String.fromCharCode(code)), String.fromCharCode(code)).toBe(true);
    }
    expect(characters).toHaveLength(95);
    expect(hasGlyph('é')).toBe(false);
  });

  it('traces every glyph into closed, simple outlines that never touch', () => {
    for (const character of supportedCharacters()) {
      const glyph = glyphFor(character);
      if (character === ' ') {
        expect(glyph.polygons).toEqual([]);
        continue;
      }
      expect(glyph.polygons.length, character).toBeGreaterThan(0);
      expectCleanOutlines(glyph.polygons, JSON.stringify(character));
      for (const polygon of glyph.polygons) {
        for (const point of [polygon.outer, ...polygon.holes].flat()) {
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(glyph.width);
          expect(point.y).toBeGreaterThanOrEqual(-DESCENDER_UNITS);
          expect(point.y).toBeLessThanOrEqual(CAP_HEIGHT_UNITS);
        }
      }
    }
  });

  it('gives letters that enclose space the holes they need', () => {
    const holes = (character: string) => glyphFor(character).polygons.flatMap((p) => p.holes).length;
    expect(holes('O')).toBe(1);
    expect(holes('A')).toBe(1);
    expect(holes('B')).toBe(2);
    expect(holes('8')).toBe(2);
    expect(holes('0')).toBe(2);
    expect(holes('e')).toBe(1);
    expect(holes('L')).toBe(0);
    expect(glyphFor('i').polygons).toHaveLength(2);
  });

  it('draws unknown characters as a box', () => {
    const box = missingGlyph();
    expect(box.polygons).toHaveLength(1);
    expect(box.polygons[0]?.holes).toHaveLength(1);
    expect(glyphFor('€')).toBe(box);
    expect(glyphFor('')).toBe(box);
  });

  it('rejects drawings whose pieces touch at a corner', () => {
    expect(() => traceGlyph(['#.', '.#'])).toThrow(/touches itself/);
    expect(() => traceGlyph(['#.', '#'])).toThrow(/wrong width/);
    expect(() => traceGlyph(['#?'])).toThrow(/Unknown glyph cell/);
  });
});

describe('layoutText', () => {
  it('scales the font so the cap height is the requested height', () => {
    const layout = layoutText('H', { height: 0.7 });
    expect(layout.unit).toBeCloseTo(0.1);
    const ys = layout.polygons.flatMap((p) => p.outer.map((q) => q.y));
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(0.7);
    expect(layout.width).toBeCloseTo(0.5);
    expect(layout.bounds.maxY).toBeCloseTo(0.7);
    expect(layout.bounds.minY).toBeCloseTo(-0.2);
  });

  it('advances by the glyph width plus the gap, and spaces by their own advance', () => {
    const unit = 0.1;
    expect(layoutText('HI', { height: 0.7 }).width).toBeCloseTo((5 + GLYPH_GAP_UNITS + 3) * unit);
    expect(layoutText('H H', { height: 0.7 }).width).toBeCloseTo(
      (5 + GLYPH_GAP_UNITS + SPACE_ADVANCE_UNITS + 5) * unit,
    );
    const xs = layoutText('HI', { height: 0.7 }).polygons[1]?.outer.map((p) => p.x) ?? [];
    expect(Math.min(...xs)).toBeCloseTo(6 * unit);
  });

  it('stacks lines upwards with the last baseline at the origin', () => {
    const layout = layoutText('A\nB', { height: 0.7 });
    expect(layout.lineCount).toBe(2);
    const [first, second] = layout.polygons;
    expect(Math.min(...(first?.outer.map((p) => p.y) ?? []))).toBeCloseTo(LINE_ADVANCE_UNITS * 0.1);
    expect(Math.min(...(second?.outer.map((p) => p.y) ?? []))).toBeCloseTo(0);
    const spaced = layoutText('A\nB', { height: 0.7, lineSpacing: 2 });
    expect(Math.min(...(spaced.polygons[0]?.outer.map((p) => p.y) ?? []))).toBeCloseTo(
      2 * LINE_ADVANCE_UNITS * 0.1,
    );
    // Spacing below 1 would let lines collide, so it is clamped.
    const tight = layoutText('A\nB', { height: 0.7, lineSpacing: 0.1 });
    expect(Math.min(...(tight.polygons[0]?.outer.map((p) => p.y) ?? []))).toBeCloseTo(
      LINE_ADVANCE_UNITS * 0.1,
    );
  });

  it('aligns lines left, centre or right within the widest line', () => {
    const minX = (align: 'left' | 'center' | 'right') => {
      const layout = layoutText('HHH\nI', { height: 0.7, align });
      const last = layout.polygons.at(-1);
      return Math.min(...(last?.outer.map((p) => p.x) ?? []));
    };
    // "HHH" is 17 units wide and "I" 3.
    expect(minX('left')).toBeCloseTo(0);
    expect(minX('center')).toBeCloseTo(0.7);
    expect(minX('right')).toBeCloseTo(1.4);
  });

  it('turns tabs into spaces and keeps empty lines', () => {
    expect(layoutText('\tH', { height: 0.7 }).width).toBeCloseTo((4 * SPACE_ADVANCE_UNITS + 5) * 0.1);
    expect(layoutText('H\n\nH', { height: 0.7 }).lineCount).toBe(3);
  });

  it('keeps every glyph of the whole character set apart, in one line and across lines', () => {
    const characters = supportedCharacters().join('');
    const text = `${characters}\n${supportedCharacters().reverse().join('')}\n€${characters.slice(0, 20)}`;
    for (const align of ['left', 'center', 'right'] as const) {
      const { polygons } = layoutText(text, { height: 1, align });
      const boxes = polygons.map((polygon) => {
        const xs = polygon.outer.map((p) => p.x);
        const ys = polygon.outer.map((p) => p.y);
        return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      });
      let checkedPairs = 0;
      for (let i = 0; i < polygons.length; i++) {
        for (let j = i + 1; j < polygons.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const p = polygons[i];
          const q = polygons[j];
          if (!a || !b || !p || !q) continue;
          // Outlines whose boxes are apart can't touch; the rest (parts of one glyph) get the full check.
          if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
          checkedPairs++;
          expectCleanOutlines([p, q], `layout ${align}, outlines ${String(i)} and ${String(j)}`);
        }
      }
      expect(checkedPairs).toBeLessThan(polygons.length);
    }
  });

  it('refuses a height that is not positive', () => {
    expect(() => layoutText('A', { height: 0 })).toThrow(RangeError);
    expect(() => layoutText('A', { height: Number.NaN })).toThrow(RangeError);
  });
});
