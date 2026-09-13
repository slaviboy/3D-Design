import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Builds two overlapping closed boxes as groups through the test hook, using the kernel's primitive changes:
 * A = [0,2]³ (created first, so it is the cutter) and B = [1,3]³.
 */
async function buildOverlappingBoxes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const doc = editor.session.doc;
    const root = doc.rootDefinitionId;
    const edgeAttributes = { soft: false, smooth: false, hidden: false, materialId: null, tagId: null };
    const faceAttributes = {
      frontMaterialId: null,
      backMaterialId: null,
      tagId: null,
      hidden: false,
      frontTexturePlacement: null,
      backTexturePlacement: null,
    };
    const instanceAttributes = {
      name: '',
      tagId: null,
      materialId: null,
      hidden: false,
      locked: false,
      castShadows: true,
      receiveShadows: true,
    };

    const box = (min: number, max: number): void => {
      const definition = doc.ids.allocate() as never;
      doc.apply({ kind: 'definition.add', data: { id: definition, name: 'Group', isGroup: true } });
      const vertex = new Map<string, number>();
      for (const i of [0, 1])
        for (const j of [0, 1])
          for (const k of [0, 1]) {
            const id = doc.ids.allocate();
            const at = (bit: number) => (bit === 0 ? min : max);
            doc.apply({
              kind: 'vertex.add',
              context: definition,
              data: { id: id as never, position: { x: at(i), y: at(j), z: at(k) } },
            });
            vertex.set(`${String(i)}${String(j)}${String(k)}`, id);
          }
      const edges = new Map<string, { id: number; v0: number }>();
      const use = (a: string, b: string) => {
        const va = vertex.get(a) ?? 0;
        const vb = vertex.get(b) ?? 0;
        const key = [va, vb].sort((x, y) => x - y).join(':');
        let edge = edges.get(key);
        if (!edge) {
          edge = { id: doc.ids.allocate(), v0: va };
          doc.apply({
            kind: 'edge.add',
            context: definition,
            data: { id: edge.id as never, v0: va as never, v1: vb as never, attributes: edgeAttributes },
          });
          edges.set(key, edge);
        }
        return { edge: edge.id as never, reversed: edge.v0 !== va };
      };
      // Each face counter-clockwise seen from outside.
      const faces = [
        ['000', '001', '011', '010'],
        ['100', '110', '111', '101'],
        ['000', '100', '101', '001'],
        ['010', '011', '111', '110'],
        ['000', '010', '110', '100'],
        ['001', '101', '111', '011'],
      ];
      for (const corners of faces) {
        const outer = corners.map((corner, index) =>
          use(corner, corners[(index + 1) % corners.length] ?? corner),
        );
        doc.apply({
          kind: 'face.add',
          context: definition,
          data: { id: doc.ids.allocate() as never, outer, inners: [], attributes: faceAttributes },
        });
      }
      doc.apply({
        kind: 'instance.add',
        context: root,
        data: {
          id: doc.ids.allocate() as never,
          definitionId: definition,
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          attributes: instanceAttributes,
        },
      });
    };
    doc.transact('Build boxes', () => {
      box(0, 2);
      box(1, 3);
    });
  });
}

/** Number of root groups and the total volume they enclose, from the faces' loops (divergence theorem). */
async function groupsAndVolume(page: Page) {
  return page.evaluate(() => {
    const editor = window.__planar?.editor;
    if (!editor) throw new Error('test hook missing: build with --mode e2e');
    const doc = editor.session.doc;
    let volume = 0;
    for (const instance of doc.rootStore.instances()) {
      const store = doc.store(instance.definitionId);
      for (const face of store.faces()) {
        for (const loop of [face.outer, ...face.inners]) {
          const points = store.loopPoints(loop);
          const [anchor] = points;
          if (!anchor) continue;
          for (let i = 1; i + 1 < points.length; i++) {
            const b = points[i];
            const c = points[i + 1];
            if (!b || !c) continue;
            const ab = { x: b.x - anchor.x, y: b.y - anchor.y, z: b.z - anchor.z };
            const ac = { x: c.x - anchor.x, y: c.y - anchor.y, z: c.z - anchor.z };
            const cross = {
              x: ab.y * ac.z - ab.z * ac.y,
              y: ab.z * ac.x - ab.x * ac.z,
              z: ab.x * ac.y - ab.y * ac.x,
            };
            volume += (anchor.x * cross.x + anchor.y * cross.y + anchor.z * cross.z) / 6;
          }
        }
      }
    }
    return { groups: doc.rootStore.instanceCount, volume: Math.round(volume * 1e6) / 1e6 };
  });
}

test('subtracts one solid group from another through the Tools menu', async ({ page }) => {
  await page.goto('/');
  await buildOverlappingBoxes(page);
  expect(await groupsAndVolume(page)).toEqual({ groups: 2, volume: 16 });

  await page.keyboard.press('ControlOrMeta+A');
  await expect(page.getByTestId('selection-count')).toHaveText('2 selected');
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Subtract' }).click();

  await expect.poll(() => groupsAndVolume(page), { timeout: 20_000 }).toEqual({ groups: 1, volume: 7 });
  await expect(page.getByTestId('entity-info-heading')).toHaveText('Solid Group');

  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => groupsAndVolume(page)).toEqual({ groups: 2, volume: 16 });
});
