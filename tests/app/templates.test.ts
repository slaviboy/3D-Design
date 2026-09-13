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
import { templateById, TEMPLATES } from '../../src/app/templates/templates';
import { validateDocument } from '../../src/kernel/model/validate';
import { draw, rectangle } from '../kernel/helpers';
import { createTestEditor, MemoryFileAccess } from './fixtures';

describe('templates', () => {
  it('create valid documents without undo history', () => {
    for (const template of TEMPLATES) {
      const doc = template.create();
      expect(validateDocument(doc).problems).toEqual([]);
      expect(doc.canUndo).toBe(false);
    }
    const site = templateById('site')?.create();
    expect(site?.rootStore.instanceCount).toBe(1);
    expect([...(site?.rootStore.instances() ?? [])][0]?.attributes.name).toBe('Site');
  });

  it('replace the model only after unsaved changes may be discarded', async () => {
    const declined = createTestEditor({ confirm: false });
    draw(declined.session.doc, rectangle(0, 0, 1, 1));
    expect(await declined.newFromTemplate('site')).toBe(false);
    expect(declined.session.doc.rootStore.faceCount).toBe(1);

    const accepted = createTestEditor({ confirm: true });
    draw(accepted.session.doc, rectangle(0, 0, 1, 1));
    expect(await accepted.newFromTemplate('site')).toBe(true);
    expect(accepted.session.doc.rootStore.instanceCount).toBe(1);
    expect(accepted.session.isDirty).toBe(false);
    await expect(accepted.newFromTemplate('missing')).rejects.toThrow('Unknown template');
  });
});

describe('recent files', () => {
  it('records opened and saved files, and reopens them by handle', async () => {
    const files = new MemoryFileAccess();
    const editor = createTestEditor({ fileAccess: files });
    const recorded: string[] = [];
    editor.setRecentFiles({
      record: (name) => {
        recorded.push(name);
      },
    });

    draw(editor.session.doc, rectangle(0, 0, 1, 1));
    await editor.saveFile();
    expect(recorded).toEqual(['Untitled.planar']);

    expect(await editor.newFromTemplate('empty')).toBe(true);
    expect(await editor.openRecent('Untitled.planar', 'Untitled.planar')).toBe(true);
    expect(editor.session.doc.rootStore.faceCount).toBe(1);
    expect(recorded).toEqual(['Untitled.planar', 'Untitled.planar']);

    expect(await editor.openRecent('Gone.planar', 'Gone.planar')).toBe(false);
    expect(editor.notifications.at(-1)?.message).toMatch(/could not be opened/);
  });
});
