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

import { PANEL_IDS, type PanelId } from '../panels/panels';

/** Width of the dock before the interface scale is applied, in CSS pixels. */
export const DEFAULT_DOCK_WIDTH = 280;
/** The dock is never narrower than this on screen, in CSS pixels. */
export const MIN_DOCK_WIDTH = 200;
/** The dock is never wider than this fraction of the window. */
export const MAX_DOCK_WINDOW_FRACTION = 0.5;
/** Stored widths outside this range are ignored. */
const MIN_STORED_WIDTH = 100;
const MAX_STORED_WIDTH = 4000;

export interface DockLayout {
  /** Width before the interface scale is applied, in CSS pixels; null uses the default. */
  readonly width: number | null;
  /** Every panel in display order. */
  readonly order: readonly PanelId[];
  /** Panels whose body is collapsed to their title. */
  readonly collapsed: readonly PanelId[];
}

export const DEFAULT_DOCK_LAYOUT: DockLayout = Object.freeze({
  width: null,
  order: PANEL_IDS,
  collapsed: [],
});

export interface DockLayoutStorage {
  load(): DockLayout;
  save(layout: DockLayout): void;
}

/** A request for the UI to bring a panel into view and focus it. `serial` grows with each request. */
export interface PanelFocusRequest {
  readonly panel: PanelId;
  readonly serial: number;
}

export type DropPlacement = 'before' | 'after';

function isPanelId(value: unknown): value is PanelId {
  return typeof value === 'string' && (PANEL_IDS as readonly string[]).includes(value);
}

/** Widest the dock may be in a window this wide. */
export function maxDockWidth(windowWidth: number): number {
  return Math.max(MIN_DOCK_WIDTH, Math.floor(windowWidth * MAX_DOCK_WINDOW_FRACTION));
}

/** An on-screen width limited to the allowed range, in whole pixels. */
export function clampDockWidth(width: number, windowWidth: number): number {
  return Math.min(maxDockWidth(windowWidth), Math.max(MIN_DOCK_WIDTH, Math.round(width)));
}

/** How wide the dock is on screen for a layout, interface scale and window width. */
export function dockScreenWidth(layout: DockLayout, uiScale: number, windowWidth: number): number {
  return clampDockWidth((layout.width ?? DEFAULT_DOCK_WIDTH) * uiScale, windowWidth);
}

/** Known panels in the given order without repeats, followed by any missing panels in their default order. */
export function panelOrder(order: readonly PanelId[]): PanelId[] {
  const known: PanelId[] = [];
  for (const id of order) if (isPanelId(id) && !known.includes(id)) known.push(id);
  return [...known, ...PANEL_IDS.filter((id) => !known.includes(id))];
}

export function withDockWidth(layout: DockLayout, width: number | null): DockLayout {
  const valid = width !== null && Number.isFinite(width) ? width : null;
  return valid === layout.width ? layout : { ...layout, width: valid };
}

export function withPanelCollapsed(layout: DockLayout, panel: PanelId, collapsed: boolean): DockLayout {
  if (layout.collapsed.includes(panel) === collapsed) return layout;
  return {
    ...layout,
    collapsed: collapsed ? [...layout.collapsed, panel] : layout.collapsed.filter((id) => id !== panel),
  };
}

/** Puts `panel` just before or after `target`. */
export function moveDockPanelTo(
  layout: DockLayout,
  panel: PanelId,
  target: PanelId,
  placement: DropPlacement,
): DockLayout {
  if (panel === target || !isPanelId(panel) || !isPanelId(target)) return layout;
  const order = panelOrder(layout.order).filter((id) => id !== panel);
  const at = order.indexOf(target);
  order.splice(placement === 'before' ? at : at + 1, 0, panel);
  return { ...layout, order };
}

/**
 * Moves a panel above (−1) or below (+1) the nearest panel that is shown, skipping hidden panels so each move
 * visibly changes the dock. Returns the layout unchanged at either end.
 */
export function moveDockPanel(
  layout: DockLayout,
  panel: PanelId,
  offset: -1 | 1,
  shown: readonly PanelId[],
): DockLayout {
  const order = panelOrder(layout.order);
  const index = order.indexOf(panel);
  if (index < 0) return layout;
  for (let at = index + offset; at >= 0 && at < order.length; at += offset) {
    const neighbor = order[at];
    if (neighbor !== undefined && shown.includes(neighbor)) {
      return moveDockPanelTo(layout, panel, neighbor, offset < 0 ? 'before' : 'after');
    }
  }
  return layout;
}

export function serializeDockLayout(layout: DockLayout): string {
  return JSON.stringify({
    format: 'planar-dock',
    version: 1,
    layout: { width: layout.width, order: panelOrder(layout.order), collapsed: layout.collapsed },
  });
}

function readPanelIds(value: unknown): PanelId[] {
  if (!Array.isArray(value)) return [];
  const ids: PanelId[] = [];
  for (const item of value as unknown[]) if (isPanelId(item) && !ids.includes(item)) ids.push(item);
  return ids;
}

/** Reads a stored dock layout. Each invalid or missing part falls back to its default; unknown panels are dropped. */
export function parseDockLayout(text: string | null): DockLayout {
  if (text === null) return DEFAULT_DOCK_LAYOUT;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return DEFAULT_DOCK_LAYOUT;
  }
  const stored =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>).layout : undefined;
  if (typeof stored !== 'object' || stored === null) return DEFAULT_DOCK_LAYOUT;
  const layout = stored as Record<string, unknown>;
  const width = layout.width;
  return {
    width:
      typeof width === 'number' &&
      Number.isFinite(width) &&
      width >= MIN_STORED_WIDTH &&
      width <= MAX_STORED_WIDTH
        ? width
        : null,
    order: panelOrder(readPanelIds(layout.order)),
    collapsed: readPanelIds(layout.collapsed),
  };
}
