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
  completeToolbarLayout,
  DEFAULT_TOOLBAR_LAYOUT,
  moveToolbarItem,
  moveToOtherToolbar,
  nudgeToolbarItem,
  parseToolbarLayout,
  serializeToolbarLayout,
  TOOLBAR_SEPARATOR as SEP,
  type ToolbarLayout,
} from '../../src/app/toolbars/toolbarLayout';
import { createTestEditor } from './fixtures';

const small: ToolbarLayout = { main: ['a', 'b', SEP, 'c'], palette: ['x', 'y', 'z'] };

describe('toolbar layout', () => {
  it('moves a button within its bar, before the button at the target place', () => {
    expect(
      moveToolbarItem(small, { bar: 'palette', index: 0 }, { bar: 'palette', index: 2 }).palette,
    ).toEqual(['y', 'x', 'z']);
    expect(
      moveToolbarItem(small, { bar: 'palette', index: 2 }, { bar: 'palette', index: 0 }).palette,
    ).toEqual(['z', 'x', 'y']);
    // Past the end of the bar means last.
    expect(
      moveToolbarItem(small, { bar: 'palette', index: 0 }, { bar: 'palette', index: 3 }).palette,
    ).toEqual(['y', 'z', 'x']);
  });

  it('moves a button across to the other bar', () => {
    const moved = moveToolbarItem(small, { bar: 'palette', index: 1 }, { bar: 'main', index: 1 });
    expect(moved).toEqual({ main: ['a', 'y', 'b', SEP, 'c'], palette: ['x', 'z'] });
    expect(moveToOtherToolbar(small, { bar: 'main', index: 0 })).toEqual({
      main: ['b', SEP, 'c'],
      palette: ['x', 'y', 'z', 'a'],
    });
  });

  it('nudges a button one place, and not past either end', () => {
    expect(nudgeToolbarItem(small, { bar: 'palette', index: 0 }, 1).palette).toEqual(['y', 'x', 'z']);
    expect(nudgeToolbarItem(small, { bar: 'palette', index: 2 }, -1).palette).toEqual(['x', 'z', 'y']);
    expect(nudgeToolbarItem(small, { bar: 'palette', index: 0 }, -1)).toBe(small);
    expect(nudgeToolbarItem(small, { bar: 'palette', index: 2 }, 1)).toBe(small);
  });

  it('keeps known buttons once each, tidies separators, and adds default buttons that went missing', () => {
    const known = new Set([...DEFAULT_TOOLBAR_LAYOUT.main, ...DEFAULT_TOOLBAR_LAYOUT.palette]);
    const completed = completeToolbarLayout(
      {
        main: [SEP, 'file.new', 'gone.command', SEP, SEP, 'tool.line', 'file.new', SEP],
        palette: ['tool.select'],
      },
      (id) => known.has(id),
    );
    expect(completed.main.slice(0, 3)).toEqual(['file.new', SEP, 'tool.line']);
    expect(completed.main).not.toContain('gone.command');
    // Everything else from the defaults came back, in its default bar.
    expect(completed.palette.slice(0, 2)).toEqual(['tool.select', 'tool.eraser']);
    expect(completed.palette).not.toContain('tool.line');
    expect(completed.main).toContain('help.commandPalette');
  });

  it('reads stored layouts defensively', () => {
    expect(parseToolbarLayout(null)).toBe(DEFAULT_TOOLBAR_LAYOUT);
    expect(parseToolbarLayout('{')).toBe(DEFAULT_TOOLBAR_LAYOUT);
    expect(parseToolbarLayout(JSON.stringify({ layout: { main: [1], palette: [] } }))).toBe(
      DEFAULT_TOOLBAR_LAYOUT,
    );
    expect(parseToolbarLayout(serializeToolbarLayout(small))).toEqual(small);
  });

  it('is kept by the editor, completed, saved and reset', () => {
    const editor = createTestEditor();
    const saved: ToolbarLayout[] = [];
    editor.setToolbarLayoutStorage({
      load: () => ({ main: ['tool.line', 'no.such.command'], palette: ['tool.select'] }),
      save: (layout) => saved.push(layout),
    });
    expect(editor.toolbarLayout.main[0]).toBe('tool.line');
    expect(editor.toolbarLayout.main).not.toContain('no.such.command');
    expect(saved).toEqual([]);

    editor.moveToolbarItem({ bar: 'main', index: 0 }, { bar: 'palette', index: 0 });
    expect(editor.toolbarLayout.palette[0]).toBe('tool.line');
    expect(saved.at(-1)?.palette[0]).toBe('tool.line');

    editor.resetToolbarLayout();
    expect(editor.toolbarLayout).toEqual(DEFAULT_TOOLBAR_LAYOUT);
  });
});
