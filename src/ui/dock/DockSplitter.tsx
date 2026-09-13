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

import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  DEFAULT_DOCK_WIDTH,
  MAX_DOCK_WINDOW_FRACTION,
  MIN_DOCK_WIDTH,
  clampDockWidth,
  dockScreenWidth,
  maxDockWidth,
} from '../../app/dock/dockLayout';
import { useEditor, useEditorState } from '../EditorContext';

/** Pixels an arrow key moves the splitter; Page Up and Page Down move it further. */
const KEY_STEP = 10;
const PAGE_STEP = 50;

function subscribeToResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
  };
}

const windowWidth = (): number => window.innerWidth;

/**
 * The boundary between the 3D view and the dock: drag it, or focus it and use the arrow keys, Home and End, to
 * change the dock width. Double-click restores the default width.
 */
export function DockSplitter() {
  const editor = useEditor();
  const layout = useEditorState((state) => state.dockLayout);
  const uiScale = useEditorState((state) => state.preferences.uiScale);
  const currentWindowWidth = useSyncExternalStore(subscribeToResize, windowWidth);
  const width = dockScreenWidth(layout, uiScale, currentWindowWidth);
  const maximum = maxDockWidth(currentWindowWidth);
  const drag = useRef<{ readonly startX: number; readonly startWidth: number } | null>(null);

  useEffect(() => {
    // The stored width is scaled like the rest of the interface, then kept within the allowed range.
    const root = document.documentElement;
    const base = String(layout.width ?? DEFAULT_DOCK_WIDTH);
    root.style.setProperty(
      '--dock-width',
      `clamp(${String(MIN_DOCK_WIDTH)}px, calc(${base}px * var(--ui-scale)), ${String(MAX_DOCK_WINDOW_FRACTION * 100)}vw)`,
    );
    return () => {
      root.style.removeProperty('--dock-width');
    };
  }, [layout.width]);

  const resize = (screenWidth: number) => {
    editor.setDockWidth(clampDockWidth(screenWidth, window.innerWidth) / uiScale);
  };

  return (
    <div
      className="dock-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      aria-valuenow={width}
      aria-valuemin={MIN_DOCK_WIDTH}
      aria-valuemax={maximum}
      aria-valuetext={`Panels ${String(width)} pixels wide`}
      tabIndex={0}
      title="Drag to resize the panels. Double-click to restore the default width."
      onKeyDown={(event) => {
        switch (event.key) {
          case 'ArrowLeft':
            resize(width + KEY_STEP);
            break;
          case 'ArrowRight':
            resize(width - KEY_STEP);
            break;
          case 'PageUp':
            resize(width + PAGE_STEP);
            break;
          case 'PageDown':
            resize(width - PAGE_STEP);
            break;
          case 'Home':
            resize(MIN_DOCK_WIDTH);
            break;
          case 'End':
            resize(maximum);
            break;
          default:
            return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: width };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start) resize(start.startWidth + start.startX - event.clientX);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={() => {
        editor.setDockWidth(null);
      }}
    />
  );
}
