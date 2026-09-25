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

/** A separator between groups of buttons. */
export const TOOLBAR_SEPARATOR = '|';

/** The toolbar across the top of the window, and the tool palette down its left side. */
export type ToolbarId = 'main' | 'palette';

/** The command ids of each bar's buttons, in order, with separators. */
export interface ToolbarLayout {
  readonly main: readonly string[];
  readonly palette: readonly string[];
}

/** A place in one of the bars. */
export interface ToolbarSlot {
  readonly bar: ToolbarId;
  readonly index: number;
}

export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayout = Object.freeze({
  main: Object.freeze([
    'file.new',
    'file.open',
    'file.save',
    TOOLBAR_SEPARATOR,
    'edit.undo',
    'edit.redo',
    'edit.delete',
    TOOLBAR_SEPARATOR,
    'edit.makeGroup',
    'edit.makeComponent',
    TOOLBAR_SEPARATOR,
    'camera.zoomExtents',
    'camera.view.iso',
    'camera.view.top',
    'camera.view.front',
    TOOLBAR_SEPARATOR,
    'help.commandPalette',
  ]),
  palette: Object.freeze([
    'tool.select',
    'tool.eraser',
    'tool.line',
    'tool.rectangle',
    'tool.circle',
    'tool.polygon',
    'tool.twoPointArc',
    'tool.freehand',
    'tool.pushPull',
    'tool.move',
    'tool.rotate',
    'tool.scale',
    'tool.offset',
    'tool.tapeMeasure',
    'tool.protractor',
    'tool.dimension',
    'tool.text',
    'tool.paint',
    'tool.orbit',
    'tool.pan',
    'tool.zoom',
    'tool.followMe',
  ]),
});

export const otherToolbar = (bar: ToolbarId): ToolbarId => (bar === 'main' ? 'palette' : 'main');

function withBar(layout: ToolbarLayout, bar: ToolbarId, items: readonly string[]): ToolbarLayout {
  return bar === 'main' ? { ...layout, main: items } : { ...layout, palette: items };
}

/**
 * Moves the item at `from` so it ends up just before whatever is at `to` now (or last, past the end of the bar),
 * within one bar or across to the other.
 */
export function moveToolbarItem(layout: ToolbarLayout, from: ToolbarSlot, to: ToolbarSlot): ToolbarLayout {
  const source = [...layout[from.bar]];
  const [item] = source.splice(from.index, 1);
  if (item === undefined) return layout;
  if (from.bar === to.bar) {
    // Indexes past the removed item shift down by one.
    const index = to.index > from.index ? to.index - 1 : to.index;
    source.splice(Math.min(Math.max(index, 0), source.length), 0, item);
    return withBar(layout, from.bar, source);
  }
  const target = [...layout[to.bar]];
  target.splice(Math.min(Math.max(to.index, 0), target.length), 0, item);
  return withBar(withBar(layout, from.bar, source), to.bar, target);
}

/** Moves an item one place earlier (−1) or later (+1) in its bar. Unchanged at either end. */
export function nudgeToolbarItem(layout: ToolbarLayout, at: ToolbarSlot, offset: -1 | 1): ToolbarLayout {
  const target = at.index + offset;
  if (target < 0 || target >= layout[at.bar].length) return layout;
  return moveToolbarItem(layout, at, { bar: at.bar, index: offset > 0 ? target + 1 : target });
}

/** Moves an item to the end of the other bar. */
export function moveToOtherToolbar(layout: ToolbarLayout, at: ToolbarSlot): ToolbarLayout {
  const bar = otherToolbar(at.bar);
  return moveToolbarItem(layout, at, { bar, index: layout[bar].length });
}

/**
 * A layout with only known commands, each shown once, and with every default command that neither bar has added to
 * its default bar, so buttons added in later versions appear. Separators stay, but never two in a row or at the ends.
 */
export function completeToolbarLayout(
  layout: ToolbarLayout,
  isKnown: (commandId: string) => boolean,
): ToolbarLayout {
  const seen = new Set<string>();
  const clean = (items: readonly string[]): string[] => {
    const kept: string[] = [];
    for (const item of items) {
      if (item === TOOLBAR_SEPARATOR) {
        if (kept.length > 0 && kept.at(-1) !== TOOLBAR_SEPARATOR) kept.push(item);
        continue;
      }
      if (seen.has(item) || !isKnown(item)) continue;
      seen.add(item);
      kept.push(item);
    }
    while (kept.at(-1) === TOOLBAR_SEPARATOR) kept.pop();
    return kept;
  };
  const main = clean(layout.main);
  const palette = clean(layout.palette);
  const missing = (bar: ToolbarId) =>
    DEFAULT_TOOLBAR_LAYOUT[bar].filter(
      (item) => item !== TOOLBAR_SEPARATOR && !seen.has(item) && isKnown(item),
    );
  return { main: [...main, ...missing('main')], palette: [...palette, ...missing('palette')] };
}

export interface ToolbarLayoutStorage {
  load(): ToolbarLayout;
  save(layout: ToolbarLayout): void;
}

export function serializeToolbarLayout(layout: ToolbarLayout): string {
  return JSON.stringify({ format: 'planar-toolbars', version: 1, layout });
}

/** Reads a stored layout; anything malformed gives the default layout. Unknown commands are dropped later. */
export function parseToolbarLayout(text: string | null): ToolbarLayout {
  if (text === null) return DEFAULT_TOOLBAR_LAYOUT;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return DEFAULT_TOOLBAR_LAYOUT;
  }
  const stored =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>).layout : undefined;
  if (typeof stored !== 'object' || stored === null) return DEFAULT_TOOLBAR_LAYOUT;
  const { main, palette } = stored as Record<string, unknown>;
  const items = (list: unknown): string[] | null =>
    Array.isArray(list) && list.every((item) => typeof item === 'string') ? list : null;
  const mainItems = items(main);
  const paletteItems = items(palette);
  return mainItems && paletteItems ? { main: mainItems, palette: paletteItems } : DEFAULT_TOOLBAR_LAYOUT;
}
