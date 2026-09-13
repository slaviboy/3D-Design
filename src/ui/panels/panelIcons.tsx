/** Small original glyphs for panel rows, drawn on a 16×16 grid. */
const GLYPHS = {
  eye: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  eyeOff: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM2.5 13.5l11-11',
  locked: 'M4 7h8v6.5H4zM5.5 7V5a2.5 2.5 0 0 1 5 0v2',
  unlocked: 'M4 7h8v6.5H4zM5.5 7V5a2.5 2.5 0 0 1 4.9-.7',
  group: 'M2.5 2.5h11v11h-11zM5 5h3v3H5zM9 8h2.5v3H9z',
  component: 'M2.5 3.5h5v5h-5zM8.5 7.5h5v5h-5zM7.5 6h3.5v1.5',
} as const;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name }: { readonly name: GlyphName }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={GLYPHS[name]} />
    </svg>
  );
}
