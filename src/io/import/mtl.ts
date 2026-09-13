import { rgbFromSrgb } from '../mesh/color';
import type { ImportedMaterial } from '../mesh/importedScene';

/*
 * A small MTL reader: diffuse color (Kd), dissolve (d) or transparency (Tr), and the diffuse texture name (map_Kd).
 * three's MTLLoader creates textures through the DOM when materials are used, which a worker can't do, and Planar
 * records texture names without importing the images.
 */

export function parseMtl(text: string): Map<string, ImportedMaterial> {
  const materials = new Map<string, ImportedMaterial>();
  let name: string | null = null;
  let color = { r: 0.8, g: 0.8, b: 0.8 };
  let opacity = 1;
  let textureName: string | null = null;
  const flush = (): void => {
    if (name !== null) materials.set(name, { name, color, opacity, textureName });
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [keyword = '', ...rest] = line.split(/\s+/);
    const key = keyword.toLowerCase();
    const numbers = rest.map(Number);
    if (key === 'newmtl') {
      flush();
      name = rest.join(' ');
      color = { r: 0.8, g: 0.8, b: 0.8 };
      opacity = 1;
      textureName = null;
    } else if (key === 'kd' && numbers.length >= 3 && numbers.slice(0, 3).every(Number.isFinite)) {
      color = rgbFromSrgb(numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0);
    } else if (key === 'd' && Number.isFinite(numbers[0])) {
      opacity = Math.min(1, Math.max(0, numbers[0] ?? 1));
    } else if (key === 'tr' && Number.isFinite(numbers[0])) {
      opacity = Math.min(1, Math.max(0, 1 - (numbers[0] ?? 0)));
    } else if (key === 'map_kd' && rest.length > 0) {
      // Options such as `-s 1 1 1` come before the file name, which is the last token.
      textureName = rest.at(-1) ?? null;
    }
  }
  flush();
  return materials;
}

/** File names listed by `mtllib` statements in an OBJ file. */
export function materialLibraries(objText: string): string[] {
  const names: string[] = [];
  for (const match of objText.matchAll(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/gm)) {
    const value = match[1] ?? '';
    // Several libraries may be listed on one line; names with spaces are rare and not supported.
    names.push(...value.split(/\s+/).filter((item) => item !== ''));
  }
  return names;
}
