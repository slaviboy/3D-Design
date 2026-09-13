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
import { KernelError } from '../../../src/kernel/errors';
import { translation, transformDirection, transformPoint } from '../../../src/kernel/math/mat4';
import { vec3 } from '../../../src/kernel/math/vec3';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { validateDocument } from '../../../src/kernel/model/validate';
import { isSolid } from '../../../src/kernel/ops/solids/solid';
import { create3DText, textFrameTransform, textInstanceName } from '../../../src/kernel/ops/text3d';
import { supportedCharacters } from '../../../src/kernel/text/font';
import { layoutText } from '../../../src/kernel/text/layout';
import { newDocument } from '../helpers';

const holesIn = (text: string) =>
  layoutText(text, { height: 1 }).polygons.reduce((sum, polygon) => sum + polygon.holes.length, 0);

describe('create3DText', () => {
  it('creates flat filled letters with holes in a new group', () => {
    const doc = newDocument();
    const polygons = layoutText('Planar 3D', { height: 1 }).polygons.length;
    const created = create3DText(doc, doc.rootDefinitionId, translation(vec3(1, 2, 0)), {
      text: 'Planar 3D',
      height: 1,
    });
    expect(validateDocument(doc).ok).toBe(true);
    expect(doc.undoLabel).toBe('Place 3D Text');
    const definition = doc.getDefinition(created.definition);
    expect(definition.attributes.isGroup).toBe(true);
    const store = definition.store;
    expect(store.faceCount).toBe(polygons);
    expect(created.faces).toBe(polygons);
    const faces = [...store.faces()];
    expect(faces.reduce((sum, face) => sum + face.inners.length, 0)).toBe(holesIn('Planar 3D'));
    for (const face of faces) expect(face.plane?.normal.z).toBeCloseTo(1);
    const instance = doc.rootStore.getInstance(created.instance);
    expect(instance.attributes.name).toBe('Planar 3D');
    expect(transformPoint(instance.transform, vec3(0, 0, 0))).toEqual(vec3(1, 2, 0));
  });

  it('extrudes letters into closed shapes facing outward', () => {
    const doc = newDocument();
    const text = 'Ob8';
    const polygons = layoutText(text, { height: 1 }).polygons.length;
    const created = create3DText(doc, doc.rootDefinitionId, translation(vec3(0, 0, 0)), {
      text,
      height: 1,
      depth: 0.25,
    });
    expect(validateDocument(doc).ok).toBe(true);
    const store = doc.getDefinition(created.definition).store;
    const faces = [...store.faces()];
    expect(faces.filter((face) => (face.plane?.normal.z ?? 0) > 0.99)).toHaveLength(polygons);
    expect(faces.filter((face) => (face.plane?.normal.z ?? 0) < -0.99)).toHaveLength(polygons);
    expect(faces.length).toBeGreaterThan(2 * polygons);
    const zs = [...store.vertices()].map((vertex) => vertex.position.z);
    expect(Math.min(...zs)).toBeCloseTo(0);
    expect(Math.max(...zs)).toBeCloseTo(0.25);
    expect(isSolid(store)).toBe(true);
  });

  it('creates only outline edges when not filled, and ignores the depth then', () => {
    const doc = newDocument();
    const layout = layoutText('AB', { height: 1 });
    const segments = layout.polygons.reduce(
      (sum, polygon) => sum + [polygon.outer, ...polygon.holes].reduce((n, ring) => n + ring.length, 0),
      0,
    );
    const created = create3DText(doc, doc.rootDefinitionId, translation(vec3(0, 0, 0)), {
      text: 'AB',
      height: 1,
      filled: false,
      depth: 1,
    });
    expect(validateDocument(doc).ok).toBe(true);
    const store = doc.getDefinition(created.definition).store;
    expect(store.faceCount).toBe(0);
    expect(store.edgeCount).toBe(segments);
  });

  it('makes a named component on request', () => {
    const doc = newDocument();
    const created = create3DText(doc, doc.rootDefinitionId, translation(vec3(0, 0, 0)), {
      text: 'Sign',
      height: 0.3,
      component: true,
    });
    const definition = doc.getDefinition(created.definition);
    expect(definition.attributes.isGroup).toBe(false);
    expect(definition.attributes.name).toBe('Text#1');
  });

  it('keeps every character of the font apart, so no letters merge', () => {
    const doc = newDocument();
    const characters = supportedCharacters().join('');
    const text = `${characters.slice(0, 48)}\n${characters.slice(48)}\n?€`;
    const layout = layoutText(text, { height: 0.5, align: 'center' });
    const created = create3DText(doc, doc.rootDefinitionId, translation(vec3(0, 0, 0)), {
      text,
      height: 0.5,
      align: 'center',
    });
    expect(validateDocument(doc).ok).toBe(true);
    const store = doc.getDefinition(created.definition).store;
    expect(store.faceCount).toBe(layout.polygons.length);
    const loops = [...store.faces()].reduce((sum, face) => sum + 1 + face.inners.length, 0);
    expect(loops).toBe(layout.polygons.reduce((sum, polygon) => sum + 1 + polygon.holes.length, 0));
  });

  it('extrudes the whole character set into valid geometry', () => {
    const doc = newDocument();
    const text = supportedCharacters().join('');
    create3DText(doc, doc.rootDefinitionId, translation(vec3(0, 0, 0)), { text, height: 0.2, depth: 0.05 });
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('is one undo step that restores the document exactly', () => {
    const doc = newDocument();
    const before = hashDocument(doc);
    create3DText(doc, doc.rootDefinitionId, translation(vec3(0, 0, 0)), {
      text: 'Undo\nme',
      height: 1,
      depth: 0.2,
      component: true,
    });
    const after = hashDocument(doc);
    expect(after).not.toBe(before);
    doc.undo();
    expect(hashDocument(doc)).toBe(before);
    expect(doc.canUndo).toBe(false);
    doc.redo();
    expect(hashDocument(doc)).toBe(after);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('places the text in a frame given by an origin and two directions', () => {
    const doc = newDocument();
    // Standing up on a wall facing -y: letters run along +x and point up +z.
    const created = create3DText(
      doc,
      doc.rootDefinitionId,
      { origin: vec3(1, 0, 2), xAxis: vec3(2, 0, 0), yAxis: vec3(0.1, 0, 3) },
      { text: 'Wall', height: 1 },
    );
    const { transform } = doc.rootStore.getInstance(created.instance);
    expect(transformPoint(transform, vec3(0, 0, 0))).toEqual(vec3(1, 0, 2));
    const x = transformDirection(transform, vec3(1, 0, 0));
    const y = transformDirection(transform, vec3(0, 1, 0));
    const z = transformDirection(transform, vec3(0, 0, 1));
    expect([x.x, x.y, x.z]).toEqual([1, 0, 0]);
    expect(y.z).toBeCloseTo(1);
    expect(z.y).toBeCloseTo(-1);
    expect(() =>
      textFrameTransform({ origin: vec3(0, 0, 0), xAxis: vec3(1, 0, 0), yAxis: vec3(2, 0, 0) }),
    ).toThrow(KernelError);
  });

  it('refuses unusable options without changing the document', () => {
    const doc = newDocument();
    const before = hashDocument(doc);
    const place = (options: Parameters<typeof create3DText>[3]) => () =>
      create3DText(doc, doc.rootDefinitionId, translation(vec3(0, 0, 0)), options);
    expect(place({ text: '   \n ', height: 1 })).toThrow(/Type some text/);
    expect(place({ text: 'A', height: 0.0001 })).toThrow(/at least 1 mm/);
    expect(place({ text: 'A', height: Number.POSITIVE_INFINITY })).toThrow(KernelError);
    expect(place({ text: 'A', height: 1, depth: -1 })).toThrow(/zero or more/);
    expect(place({ text: 'A'.repeat(3000), height: 1 })).toThrow(/limited/);
    expect(hashDocument(doc)).toBe(before);
    expect(doc.canUndo).toBe(false);
  });

  it('names the instance after the first non-empty line', () => {
    expect(textInstanceName('\n  Hello  \nWorld')).toBe('Hello');
    expect(textInstanceName('x'.repeat(60))).toHaveLength(40);
  });
});
