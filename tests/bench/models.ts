import { vec3, type Vec3 } from '../../src/kernel/math/vec3';
import { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { addMaterial, addTextureAsset, setFaceAttributes } from '../../src/kernel/model/mutations';
import { insertSegments, type SegmentInput } from '../../src/kernel/ops/insertSegments';

/*
 * Benchmark models shared by the Node benchmarks (tests/bench) and the browser benchmarks (tests/perf).
 */

/** Each 1 m box is 8 vertices, 12 edges and 6 faces. */
export const ENTITIES_PER_BOX = 26;
const BOX_SPACING = 2;

function loop(points: readonly Vec3[]): SegmentInput[] {
  return points.map((a, i) => ({ a, b: points[(i + 1) % points.length] ?? a }));
}

function boxEdges(x: number, y: number): SegmentInput[] {
  const bottom = [vec3(x, y, 0), vec3(x + 1, y, 0), vec3(x + 1, y + 1, 0), vec3(x, y + 1, 0)];
  const top = bottom.map((p) => vec3(p.x, p.y, 1));
  return [...loop(bottom), ...loop(top), ...bottom.map((a, i) => ({ a, b: top[i] ?? a }))];
}

export interface BoxGrid {
  readonly doc: ModelDocument;
  readonly boxes: number;
  readonly entities: number;
}

/** A square grid of separate 1 m boxes with about `entityCount` entities. */
export function boxGrid(entityCount: number): BoxGrid {
  const doc = new ModelDocument();
  const boxes = Math.ceil(entityCount / ENTITIES_PER_BOX);
  const columns = Math.ceil(Math.sqrt(boxes));
  for (let i = 0; i < boxes; i++) {
    const x = (i % columns) * BOX_SPACING;
    const y = Math.floor(i / columns) * BOX_SPACING;
    insertSegments(doc, doc.rootDefinitionId, boxEdges(x, y), { autoFace: true });
  }
  return { doc, boxes, entities: boxes * ENTITIES_PER_BOX };
}

/** Adds `image` as a texture (one tile per 1 m) and paints both sides of every root face with it. */
export function paintAllFaces(doc: ModelDocument, image: Uint8Array): void {
  doc.transact('Paint', () => {
    const assetId = addTextureAsset(doc, 'texture.png', image);
    const material = addMaterial(doc, {
      name: 'Textured',
      color: { r: 1, g: 1, b: 1 },
      texture: { assetId, width: 1, height: 1 },
    });
    for (const face of [...doc.rootStore.faces()]) {
      setFaceAttributes(doc, doc.rootDefinitionId, face.id, {
        frontMaterialId: material,
        backMaterialId: material,
      });
    }
  });
}
