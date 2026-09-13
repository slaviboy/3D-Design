/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from 'vitest';
import type { AssetId, EdgeId, FaceId, MaterialId } from '../../../src/kernel/ids';
import { scaling } from '../../../src/kernel/math/mat4';
import { normalize, vec3 } from '../../../src/kernel/math/vec3';
import {
  MAX_TEXTURE_BYTES,
  MAX_TEXTURE_DIMENSION,
  readImageHeader,
  sha256Hex,
  textureBytesProblem,
} from '../../../src/kernel/model/assets';
import type { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import {
  addInstance,
  addMaterial,
  addTextureAsset,
  removeTextureAsset,
  setEdgeAttributes,
  setFaceAttributes,
  setInstanceAttributes,
  setMaterialAttributes,
} from '../../../src/kernel/model/mutations';
import {
  createSnapshot,
  hashDocument,
  restoreSnapshot,
  snapshotTextureFiles,
} from '../../../src/kernel/model/snapshot';
import { validateDocument } from '../../../src/kernel/model/validate';
import { makeComponent } from '../../../src/kernel/ops/hierarchy';
import {
  connectedFaces,
  deleteMaterial,
  materialAreas,
  materialUsage,
  purgeUnusedMaterials,
  textureAxes,
  textureUv,
} from '../../../src/kernel/ops/materials';
import { smoothVertexNormals } from '../../../src/kernel/ops/shading';
import { boxEdges, draw, expectValid, faceIds, newDocument, polygon, rectangle } from '../helpers';
import { jpegBytes, pngBytes } from '../imageBytes';

const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };

function textureSource(doc: ModelDocument) {
  const files = snapshotTextureFiles(doc);
  return (digest: string) => files.get(digest)?.bytes;
}

function roundTrip(doc: ModelDocument): ModelDocument {
  const result = restoreSnapshot(JSON.parse(JSON.stringify(createSnapshot(doc))), {}, textureSource(doc));
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** A 2×1 m rectangle with a textured material painted on its back, and a second plain material. */
function texturedDocument() {
  const doc = newDocument();
  draw(doc, rectangle(0, 0, 2, 1));
  const [face] = faceIds(doc.rootStore);
  if (face === undefined) throw new Error('expected a face');
  const ids = doc.transact('Materials', () => {
    const asset = addTextureAsset(doc, 'bricks.png', pngBytes(64, 32));
    const brick = addMaterial(doc, {
      name: 'Brick',
      color: RED,
      roughness: 0.7,
      metalness: 0.1,
      texture: { assetId: asset, width: 0.5, height: 0.25 },
    });
    const glass = addMaterial(doc, { name: 'Glass', color: BLUE, opacity: 0.4 });
    setFaceAttributes(doc, doc.rootDefinitionId, face, {
      backMaterialId: brick,
      backTexturePlacement: { offsetX: 0.1, offsetY: 0, rotation: Math.PI / 4, scaleX: 2, scaleY: 1 },
    });
    return { asset, brick, glass };
  });
  return { doc, face, ...ids };
}

describe('image headers and digests', () => {
  it('reads PNG and JPEG sizes and rejects anything else', () => {
    expect(readImageHeader(pngBytes(640, 480))).toEqual({ mimeType: 'image/png', width: 640, height: 480 });
    expect(readImageHeader(jpegBytes(300, 200))).toEqual({ mimeType: 'image/jpeg', width: 300, height: 200 });
    expect(readImageHeader(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readImageHeader(pngBytes(4, 4).slice(0, 20))).toBeNull();
    expect(textureBytesProblem(new Uint8Array(0))).toMatch(/empty/);
    expect(textureBytesProblem(pngBytes(MAX_TEXTURE_DIMENSION + 1, 2))).toMatch(/pixels/);
    expect(textureBytesProblem(pngBytes(0, 2))).toMatch(/no pixels/);
  });

  it('computes SHA-256', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    // Crosses the 55/56-byte padding boundary.
    expect(sha256Hex(new TextEncoder().encode('a'.repeat(56)))).toBe(
      'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a',
    );
  });
});

describe('materials and texture assets', () => {
  it('fills physical defaults and keeps existing document hashes stable', () => {
    const doc = newDocument();
    const id = doc.transact('Add', () => addMaterial(doc, { name: 'Plain', color: RED }));
    expect(doc.material(id)).toMatchObject({ opacity: 1, metalness: 0, roughness: 1, texture: null });
    const snapshot = createSnapshot(doc);
    // Default attributes are not written, so documents saved before these attributes existed hash the same.
    expect(snapshot.materials[0]).toEqual({ id, name: 'Plain', color: RED, opacity: 1 });
    expect(snapshot.textures).toBeUndefined();
    draw(doc, rectangle(0, 0, 1, 1));
    expect(Object.keys(createSnapshot(doc).definitions[0]?.faces[0]?.attributes ?? {})).toEqual([
      'frontMaterialId',
      'backMaterialId',
      'tagId',
      'hidden',
    ]);
  });

  it('undoes and redoes material, asset and placement changes to identical hashes', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    const hashes = [hashDocument(doc)];
    const [ownFace] = faceIds(doc.rootStore);
    if (ownFace === undefined) throw new Error('expected a face');
    const assetId = doc.transact('Asset', () => addTextureAsset(doc, 'a.png', pngBytes(8, 8)));
    hashes.push(hashDocument(doc));
    const materialId = doc.transact('Material', () =>
      addMaterial(doc, { name: 'M', color: RED, texture: { assetId, width: 1, height: 1 } }),
    );
    hashes.push(hashDocument(doc));
    doc.transact('Edit', () => {
      setMaterialAttributes(doc, materialId, { metalness: 0.5, roughness: 0.25, opacity: 0.5 });
    });
    hashes.push(hashDocument(doc));
    doc.transact('Paint', () => {
      setFaceAttributes(doc, doc.rootDefinitionId, ownFace, {
        frontMaterialId: materialId,
        frontTexturePlacement: { offsetX: 1, offsetY: 2, rotation: 0.3, scaleX: -1, scaleY: 2 },
      });
    });
    hashes.push(hashDocument(doc));
    deleteMaterial(doc, materialId);
    hashes.push(hashDocument(doc));
    expect(doc.asset(assetId)).toBeUndefined();
    expect(doc.rootStore.getFace(ownFace).attributes.frontMaterialId).toBeNull();
    expect(new Set(hashes).size).toBe(hashes.length);

    for (let i = hashes.length - 2; i >= 0; i--) {
      doc.undo();
      expect(hashDocument(doc)).toBe(hashes[i]);
    }
    for (let i = 1; i < hashes.length; i++) {
      doc.redo();
      expect(hashDocument(doc)).toBe(hashes[i]);
    }
    expectValid(doc);
  });

  it('copies imported bytes and reads the type and size from the image', () => {
    const doc = newDocument();
    const bytes = jpegBytes(40, 30);
    const id = doc.transact('Asset', () => addTextureAsset(doc, 'photo.jpg', bytes));
    bytes[0] = 0;
    expect(doc.asset(id)).toMatchObject({ mimeType: 'image/jpeg', width: 40, height: 30 });
    expect(doc.asset(id)?.bytes[0]).toBe(0xff);
  });

  it('refuses invalid materials, placements and assets', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const [face] = faceIds(doc.rootStore);
    if (face === undefined) throw new Error('expected a face');
    const before = hashDocument(doc);
    const attempt = (fn: () => unknown) => () => doc.transact('Bad', fn);
    expect(attempt(() => addMaterial(doc, { name: 'x', color: RED, metalness: 2 }))).toThrow(/metalness/);
    expect(attempt(() => addMaterial(doc, { name: 'x', color: RED, roughness: -0.1 }))).toThrow(/roughness/);
    expect(attempt(() => addMaterial(doc, { name: 'x', color: RED, opacity: Number.NaN }))).toThrow(
      /opacity/,
    );
    expect(
      attempt(() =>
        addMaterial(doc, {
          name: 'x',
          color: RED,
          texture: { assetId: 999 as AssetId, width: 1, height: 1 },
        }),
      ),
    ).toThrow(/does not exist/);
    expect(
      attempt(() => {
        const assetId = addTextureAsset(doc, 'a.png', pngBytes(2, 2));
        addMaterial(doc, { name: 'x', color: RED, texture: { assetId, width: 0, height: 1 } });
      }),
    ).toThrow(/positive/);
    expect(
      attempt(() => {
        setFaceAttributes(doc, doc.rootDefinitionId, face, {
          frontTexturePlacement: { offsetX: 0, offsetY: 0, rotation: 0, scaleX: 0, scaleY: 1 },
        });
      }),
    ).toThrow(/zero/);
    expect(attempt(() => addTextureAsset(doc, 'x.gif', new TextEncoder().encode('GIF89a')))).toThrow(
      /PNG or JPEG/,
    );
    expect(attempt(() => addTextureAsset(doc, 'huge.png', pngBytes(MAX_TEXTURE_DIMENSION * 2, 4)))).toThrow(
      /pixels/,
    );
    const oversize = new Uint8Array(MAX_TEXTURE_BYTES + 1);
    oversize.set(pngBytes(4, 4));
    expect(attempt(() => addTextureAsset(doc, 'big.png', oversize))).toThrow(/larger than/);
    expect(hashDocument(doc)).toBe(before);

    const assetId = doc.transact('Asset', () => addTextureAsset(doc, 'a.png', pngBytes(2, 2)));
    doc.transact('Material', () =>
      addMaterial(doc, { name: 'uses', color: RED, texture: { assetId, width: 1, height: 1 } }),
    );
    expect(
      attempt(() => {
        removeTextureAsset(doc, assetId);
      }),
    ).toThrow(/still uses/);
  });

  it('reports invalid materials and assets found by validation', () => {
    const doc = newDocument();
    doc.applyWithoutHistory([
      {
        kind: 'material.add',
        data: {
          id: 50 as MaterialId,
          name: 'Broken',
          color: RED,
          opacity: 1,
          metalness: 3,
          roughness: 1,
          texture: null,
        },
      },
      {
        kind: 'material.add',
        data: {
          id: 51 as MaterialId,
          name: 'Dangling',
          color: RED,
          opacity: 1,
          metalness: 0,
          roughness: 1,
          texture: { assetId: 77 as AssetId, width: 1, height: 1 },
        },
      },
      {
        kind: 'asset.add',
        data: {
          id: 52 as AssetId,
          name: 'lies.png',
          mimeType: 'image/png',
          width: 10,
          height: 10,
          bytes: pngBytes(4, 4),
        },
      },
    ]);
    const codes = validateDocument(doc).problems.map((problem) => problem.code);
    expect(codes).toEqual(expect.arrayContaining(['invalid-material', 'missing-reference', 'invalid-asset']));
  });

  it('round-trips materials, texture bytes and placements through snapshots', () => {
    const { doc, face, brick } = texturedDocument();
    const restored = roundTrip(doc);
    expect(hashDocument(restored)).toBe(hashDocument(doc));
    expect(restored.material(brick)).toMatchObject({ metalness: 0.1, roughness: 0.7 });
    expect(restored.rootStore.getFace(face).attributes.backTexturePlacement).toMatchObject({ scaleX: 2 });
    const [asset] = [...restored.assets()];
    expect(asset?.bytes).toEqual(pngBytes(64, 32));
    expectValid(restored);
  });

  it('rejects snapshots with missing, corrupt, oversize or mislabeled textures', () => {
    const { doc } = texturedDocument();
    const json = () =>
      JSON.parse(JSON.stringify(createSnapshot(doc))) as {
        textures: { byteLength: number; width: number; sha256: string; mimeType: string }[];
      };
    const source = textureSource(doc);
    expect(restoreSnapshot(json())).toMatchObject({ ok: false, error: expect.stringContaining('missing') });
    const [digest] = [...snapshotTextureFiles(doc).keys()];
    const tampered = pngBytes(64, 32, 99);
    expect(restoreSnapshot(json(), {}, () => tampered)).toMatchObject({
      ok: false,
      error: expect.stringContaining('corrupt'),
    });
    const oversize = json();
    const [entry] = oversize.textures;
    if (!entry) throw new Error('expected a texture');
    entry.byteLength = MAX_TEXTURE_BYTES + 1;
    expect(restoreSnapshot(oversize, {}, source)).toMatchObject({
      ok: false,
      error: expect.stringContaining('too large'),
    });
    const wrongSize = json();
    if (wrongSize.textures[0]) wrongSize.textures[0].width = 65;
    expect(restoreSnapshot(wrongSize, {}, source)).toMatchObject({
      ok: false,
      error: expect.stringContaining('invalid-asset'),
    });
    const wrongType = json();
    if (wrongType.textures[0]) wrongType.textures[0].mimeType = 'image/gif';
    expect(restoreSnapshot(wrongType, {}, source)).toMatchObject({ ok: false });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('material operations', () => {
  it('deletes a material from faces, edges and instances, and purges unused ones', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const component = makeComponent(doc, doc.rootDefinitionId, { faces: faceIds(doc.rootStore) }, 'Tile');
    const inner = faceIds(doc.store(component.definition))[0] as FaceId;
    const edge = [...doc.store(component.definition).edges()][0]?.id as EdgeId;
    const { used, unused } = doc.transact('Setup', () => {
      const usedId = addMaterial(doc, { name: 'Used', color: RED });
      const unusedId = addMaterial(doc, { name: 'Unused', color: BLUE });
      setFaceAttributes(doc, component.definition, inner, {
        frontMaterialId: usedId,
        backMaterialId: usedId,
      });
      setEdgeAttributes(doc, component.definition, edge, { materialId: usedId });
      setInstanceAttributes(doc, doc.rootDefinitionId, component.instance, { materialId: usedId });
      return { used: usedId, unused: unusedId };
    });
    expect(materialUsage(doc).get(used)).toBe(4);
    expect(purgeUnusedMaterials(doc)).toEqual([unused]);
    expect(doc.material(unused)).toBeUndefined();
    deleteMaterial(doc, used);
    expect(doc.store(component.definition).getFace(inner).attributes).toMatchObject({
      frontMaterialId: null,
      backMaterialId: null,
    });
    expect(doc.rootStore.getInstance(component.instance).attributes.materialId).toBeNull();
    expect(doc.undoLabel).toBe('Delete Material');
    doc.undo();
    expect(doc.material(used)).toBeDefined();
    expectValid(doc);
  });

  it('sums painted area per material across instances, scaling and inheritance', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 2, 1));
    const [rootFace] = faceIds(doc.rootStore);
    draw(doc, rectangle(10, 0, 11, 1));
    const tileFace = faceIds(doc.rootStore).find((id) => id !== rootFace) as FaceId;
    const tile = makeComponent(doc, doc.rootDefinitionId, { faces: [tileFace] }, 'Tile');
    draw(doc, polygon([vec3(0, 5, 0), vec3(1, 5, 0), vec3(1, 5, 1), vec3(0, 5, 1)]));
    const wallFace = faceIds(doc.rootStore).find((id) => doc.rootStore.getFace(id).plane?.normal.z === 0);
    if (rootFace === undefined || wallFace === undefined) throw new Error('expected faces');
    const wall = makeComponent(doc, doc.rootDefinitionId, { faces: [wallFace] }, 'Wall');
    const { a, b, c } = doc.transact('Paint', () => {
      const idA = addMaterial(doc, { name: 'A', color: RED });
      const idB = addMaterial(doc, { name: 'B', color: BLUE });
      const idC = addMaterial(doc, { name: 'C', color: BLUE });
      setFaceAttributes(doc, doc.rootDefinitionId, rootFace, { frontMaterialId: idA, backMaterialId: idA });
      const innerTile = faceIds(doc.store(tile.definition))[0] as FaceId;
      setFaceAttributes(doc, tile.definition, innerTile, { frontMaterialId: idA });
      addInstance(doc, doc.rootDefinitionId, tile.definition, scaling(vec3(2, 2, 1)));
      setInstanceAttributes(doc, doc.rootDefinitionId, tile.instance, { materialId: idB });
      const innerWall = faceIds(doc.store(wall.definition))[0] as FaceId;
      setFaceAttributes(doc, wall.definition, innerWall, { frontMaterialId: idC });
      addInstance(doc, doc.rootDefinitionId, wall.definition, scaling(vec3(2, 3, 1)));
      return { a: idA, b: idB, c: idC };
    });
    const areas = materialAreas(doc);
    // Root face (2, counted once for both sides) + tile (1) + tile scaled ×2 in x and y (4).
    expect(areas.get(a)).toBeCloseTo(7, 9);
    // The tile's default back side shows the instance material on the painted instance only.
    expect(areas.get(b)).toBeCloseTo(1, 9);
    // A vertical 1 m² wall face, and a copy scaled 2 in x (3 in y is along its normal, so it doesn't count).
    expect(areas.get(c)).toBeCloseTo(3, 9);
  });

  it('finds connected faces through shared edges', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    draw(doc, rectangle(1, 0, 2, 1));
    draw(doc, rectangle(5, 0, 6, 1));
    const store = doc.rootStore;
    const [first, second, third] = faceIds(store);
    if (first === undefined || second === undefined || third === undefined) throw new Error('expected faces');
    expect(connectedFaces(store, first)).toEqual([first, second]);
    expect(connectedFaces(store, first, (id) => id !== second)).toEqual([first]);
    expect(connectedFaces(store, third)).toEqual([third]);
  });
});

describe('texture projection and smooth shading', () => {
  it('projects horizontal faces along the red and green axes and walls upright', () => {
    expect(textureAxes(vec3(0, 0, -1))).toEqual({ u: vec3(1, 0, 0), v: vec3(0, 1, 0) });
    const wall = textureAxes(vec3(0, -1, 0));
    expect(wall.u.x).toBeCloseTo(1);
    expect(wall.v.z).toBeCloseTo(1);
    const tile = { width: 0.5, height: 0.25 };
    expect(textureUv(vec3(1, 0.5, 0), textureAxes(vec3(0, 0, 1)), tile, null)).toEqual({ u: 2, v: 2 });
    const turned = textureUv(
      vec3(0, 1, 0),
      textureAxes(vec3(0, 0, 1)),
      { width: 1, height: 1 },
      {
        offsetX: 0,
        offsetY: 0,
        rotation: Math.PI / 2,
        scaleX: 2,
        scaleY: 1,
      },
    );
    expect(turned.u).toBeCloseTo(0.5);
    expect(turned.v).toBeCloseTo(0);
  });

  it('averages vertex normals across soft and smooth edges only', () => {
    const doc = newDocument();
    draw(doc, boxEdges(0, 0, 0, 1, 1, 1));
    const store = doc.rootStore;
    const top = [...store.faces()].find((face) => face.plane?.normal.z === 1);
    const side = [...store.faces()].find((face) => face.plane?.normal.x === 1);
    if (!top || !side) throw new Error('expected box faces');
    const shared = store.faceEdges(top.id).find((edge) => store.getEdge(edge).faces.includes(side.id));
    if (shared === undefined) throw new Error('expected a shared edge');
    expect(smoothVertexNormals(store).size).toBe(0);
    doc.transact('Soften', () => {
      setEdgeAttributes(doc, doc.rootDefinitionId, shared, { soft: true, smooth: false });
    });
    expect(smoothVertexNormals(store).size).toBe(0);
    doc.transact('Smooth', () => {
      setEdgeAttributes(doc, doc.rootDefinitionId, shared, { soft: true, smooth: true });
    });
    const normals = smoothVertexNormals(store);
    expect([...normals.keys()].sort((x, y) => x - y)).toEqual([top.id, side.id].sort((x, y) => x - y));
    const edge = store.getEdge(shared);
    const expected = normalize(vec3(1, 0, 1));
    expect(normals.get(top.id)?.get(edge.v0)).toEqual(expected);
    expect(normals.get(side.id)?.get(edge.v1)).toEqual(expected);
    // A vertex of the top face away from the shared edge keeps the top face's normal.
    const far = store.loopVertices(top.outer).find((vertex) => vertex !== edge.v0 && vertex !== edge.v1);
    if (far === undefined) throw new Error('expected a vertex');
    expect(normals.get(top.id)?.get(far)).toEqual(vec3(0, 0, 1));
  });
});
