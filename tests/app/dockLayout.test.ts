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
  DEFAULT_DOCK_LAYOUT,
  clampDockWidth,
  dockScreenWidth,
  maxDockWidth,
  moveDockPanel,
  moveDockPanelTo,
  panelOrder,
  parseDockLayout,
  serializeDockLayout,
  withPanelCollapsed,
  type DockLayout,
} from '../../src/app/dock/dockLayout';
import { PANEL_IDS, type PanelId } from '../../src/app/panels/panels';
import { createEditorStore } from '../../src/app/stores/editorStore';
import { createTestEditor } from './fixtures';

describe('dock layout', () => {
  it('reads stored layouts defensively', () => {
    expect(parseDockLayout(null)).toBe(DEFAULT_DOCK_LAYOUT);
    expect(parseDockLayout('{not json')).toBe(DEFAULT_DOCK_LAYOUT);
    expect(parseDockLayout('{"layout":5}')).toBe(DEFAULT_DOCK_LAYOUT);
    expect(parseDockLayout('[]')).toBe(DEFAULT_DOCK_LAYOUT);

    const layout = parseDockLayout(
      JSON.stringify({
        layout: {
          width: '300',
          order: ['tags', 'nope', 'tags', 7, 'outliner'],
          collapsed: ['materials', 'bogus', 3],
        },
      }),
    );
    expect(layout.width).toBeNull();
    expect(layout.order.slice(0, 3)).toEqual(['tags', 'outliner', 'entityInfo']);
    expect([...layout.order].sort()).toEqual([...PANEL_IDS].sort());
    expect(layout.collapsed).toEqual(['materials']);

    for (const width of [50, 99999, null]) {
      expect(parseDockLayout(JSON.stringify({ layout: { width } })).width).toBeNull();
    }
    expect(parseDockLayout(JSON.stringify({ layout: { width: 320.5 } })).width).toBe(320.5);
  });

  it('writes layouts that read back the same', () => {
    const layout: DockLayout = {
      width: 360,
      order: ['instructor', ...PANEL_IDS.slice(0, -1)],
      collapsed: ['tags'],
    };
    const text = serializeDockLayout(layout);
    expect(JSON.parse(text)).toMatchObject({ format: 'planar-dock', version: 1 });
    expect(parseDockLayout(text)).toEqual(layout);
  });

  it('completes panel orders with panels they are missing', () => {
    expect(panelOrder(['tags', 'bogus' as PanelId, 'tags'])).toEqual([
      'tags',
      ...PANEL_IDS.filter((id) => id !== 'tags'),
    ]);
  });

  it('moves panels past hidden ones, and to a drop position', () => {
    const shown: PanelId[] = ['entityInfo', 'outliner', 'tags'];
    const moved = moveDockPanel(DEFAULT_DOCK_LAYOUT, 'tags', -1, shown);
    expect(moved.order.slice(0, 4)).toEqual(['entityInfo', 'tags', 'outliner', 'components']);
    expect(moveDockPanel(DEFAULT_DOCK_LAYOUT, 'entityInfo', -1, shown)).toBe(DEFAULT_DOCK_LAYOUT);
    expect(moveDockPanel(DEFAULT_DOCK_LAYOUT, 'tags', 1, shown)).toBe(DEFAULT_DOCK_LAYOUT);

    expect(moveDockPanelTo(DEFAULT_DOCK_LAYOUT, 'instructor', 'entityInfo', 'before').order[0]).toBe(
      'instructor',
    );
    const after = moveDockPanelTo(DEFAULT_DOCK_LAYOUT, 'entityInfo', 'outliner', 'after').order;
    expect(after.slice(0, 2)).toEqual(['outliner', 'entityInfo']);
    expect(moveDockPanelTo(DEFAULT_DOCK_LAYOUT, 'tags', 'tags', 'after')).toBe(DEFAULT_DOCK_LAYOUT);
  });

  it('collapses and expands panels', () => {
    const collapsed = withPanelCollapsed(DEFAULT_DOCK_LAYOUT, 'tags', true);
    expect(collapsed.collapsed).toEqual(['tags']);
    expect(withPanelCollapsed(collapsed, 'tags', true)).toBe(collapsed);
    expect(withPanelCollapsed(collapsed, 'tags', false).collapsed).toEqual([]);
  });

  it('keeps the dock between 200 pixels and half the window, scaled with the interface', () => {
    expect(clampDockWidth(100, 1280)).toBe(200);
    expect(clampDockWidth(900, 1280)).toBe(640);
    expect(clampDockWidth(300.4, 1280)).toBe(300);
    expect(maxDockWidth(300)).toBe(200);
    expect(dockScreenWidth(DEFAULT_DOCK_LAYOUT, 1, 1280)).toBe(280);
    expect(dockScreenWidth(DEFAULT_DOCK_LAYOUT, 1.25, 1280)).toBe(350);
    expect(dockScreenWidth({ ...DEFAULT_DOCK_LAYOUT, width: 600 }, 1.5, 1280)).toBe(640);
  });
});

describe('dock layout in the editor', () => {
  it('loads the layout from storage, saves changes, and exposes it in the store', () => {
    const editor = createTestEditor();
    const saved: DockLayout[] = [];
    editor.setDockLayoutStorage({
      load: () => ({ ...DEFAULT_DOCK_LAYOUT, width: 320 }),
      save: (layout) => saved.push(layout),
    });
    const store = createEditorStore(editor);
    expect(store.getState().dockLayout.width).toBe(320);
    expect(saved).toEqual([]);

    editor.movePanel('components', -1);
    editor.setPanelCollapsed('tags', true);
    editor.setDockWidth(Number.NaN);
    expect(saved).toHaveLength(3);
    expect(store.getState().dockLayout).toEqual({
      width: null,
      order: panelOrder(['entityInfo', 'components', 'outliner']),
      collapsed: ['tags'],
    });
    store.dispose();
  });

  it('reports storage failures without losing the change', () => {
    const editor = createTestEditor();
    editor.setDockLayoutStorage({
      load: () => DEFAULT_DOCK_LAYOUT,
      save: () => {
        throw new Error('quota exceeded');
      },
    });
    editor.setDockWidth(400);
    expect(editor.dockLayout.width).toBe(400);
    expect(editor.notifications.at(-1)?.message).toBe('Could not save the panel layout: quota exceeded');
  });
});
