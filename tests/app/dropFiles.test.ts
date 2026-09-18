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
import {
  classifyDroppedFiles,
  describeDroppableFiles,
  DROPPABLE_EXTENSIONS,
  extensionOf,
} from '../../src/app/io/dropFiles';
import type { InputFile } from '../../src/io/import/fileSet';

const file = (name: string): InputFile => ({ name, bytes: new Uint8Array([1, 2, 3]) });

describe('dropped files', () => {
  it('opens a dropped project', () => {
    expect(classifyDroppedFiles([file('house.planar')])).toEqual({
      kind: 'project',
      file: file('house.planar'),
    });
  });

  it('prefers the project when a project and a model are dropped together', () => {
    const dropped = classifyDroppedFiles([file('chair.obj'), file('house.PLANAR')]);
    expect(dropped.kind).toBe('project');
  });

  it('imports models with the companions dropped beside them', () => {
    const dropped = classifyDroppedFiles([
      file('chair.obj'),
      file('chair.mtl'),
      file('wood.png'),
      file('notes.txt'),
    ]);
    expect(dropped.kind).toBe('import');
    expect(dropped.kind === 'import' ? dropped.files.map((f) => f.name) : []).toEqual([
      'chair.obj',
      'chair.mtl',
      'wood.png',
    ]);
  });

  it('accepts every format the importers read', () => {
    for (const name of ['model.glb', 'model.gltf', 'part.stl', 'scene.dae', 'scene.3ds']) {
      expect(classifyDroppedFiles([file(name)]).kind).toBe('import');
    }
  });

  it('reports files it cannot use', () => {
    const dropped = classifyDroppedFiles([file('notes.txt'), file('photo.gif')]);
    expect(dropped).toEqual({ kind: 'unsupported', names: ['notes.txt', 'photo.gif'] });
    // Companions on their own are no use without a model.
    expect(classifyDroppedFiles([file('chair.mtl')]).kind).toBe('unsupported');
  });

  it('reads extensions regardless of case and dots in the name', () => {
    expect(extensionOf('My House.v2.Planar')).toBe('.planar');
    expect(extensionOf('noextension')).toBe('');
  });

  it('describes what may be dropped, for the overlay and error messages', () => {
    expect(DROPPABLE_EXTENSIONS).toContain('.planar');
    expect(DROPPABLE_EXTENSIONS).toContain('.obj');
    expect(describeDroppableFiles()).toContain('.planar');
    expect(describeDroppableFiles()).toContain('OBJ');
  });
});
