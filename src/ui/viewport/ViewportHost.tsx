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

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ViewCaptureRelay } from '../../app/io/viewCapture';
import type { PointerInput } from '../../app/tools/Tool';
import { Viewport } from '../../render/Viewport';
import { useEditor, useEditorState } from '../EditorContext';
import { AnnotationLabels } from './AnnotationLabels';
import { selectForContextMenu } from '../../app/contextMenu/contextMenu';
import { contextMenuJustOpened, showContextMenu } from '../contextmenu/contextMenuStore';
import { ClickCounter } from './clickCount';

/** The right mouse button opens the context menu instead of reaching the active tool. */
const SECONDARY_BUTTON = 2;

function pointerInput(
  event: ReactPointerEvent<HTMLElement>,
  element: HTMLElement,
  clickCount: number,
): PointerInput {
  const rect = element.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    button: event.button,
    buttons: event.buttons,
    detail: clickCount,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };
}

export function ViewportHost() {
  const editor = useEditor();
  const hostRef = useRef<HTMLDivElement>(null);
  const clicksRef = useRef(new ClickCounter());
  const [failure, setFailure] = useState<string | null>(null);
  const overlay = useEditorState((state) => state.overlay);
  const marker = useEditorState((state) => state.marker);
  const activeToolId = useEditorState((state) => state.activeToolId);
  const cursor = editor.tools.activeTool.cursor;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let viewport: Viewport;
    try {
      viewport = new Viewport(host, editor.session, {
        onResize: (size) => {
          editor.setViewportSize(size);
        },
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      editor.tools.wheel({ x: event.clientX - rect.left, y: event.clientY - rect.top, deltaY: event.deltaY });
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    const relay = editor.exchange.viewCapture;
    const detachCapture =
      relay instanceof ViewCaptureRelay ? relay.attach((options) => viewport.capture(options)) : null;
    return () => {
      detachCapture?.();
      host.removeEventListener('wheel', onWheel);
      viewport.dispose();
    };
  }, [editor]);

  if (failure) {
    return (
      <div className="viewport viewport--failed" role="alert">
        <p>The 3D view could not start because WebGL is unavailable in this browser.</p>
        <p className="viewport__detail">{failure}</p>
      </div>
    );
  }

  return (
    <div
      className="viewport"
      ref={hostRef}
      style={{ cursor }}
      data-active-tool={activeToolId}
      role="application"
      aria-label="3D viewport"
      tabIndex={-1}
      onPointerDown={(event) => {
        const host = hostRef.current;
        if (!host) return;
        if (event.button === SECONDARY_BUTTON) {
          host.focus({ preventScroll: true });
          return;
        }
        host.setPointerCapture(event.pointerId);
        host.focus({ preventScroll: true });
        editor.tools.pointerDown(pointerInput(event, host, clicksRef.current.press(event)));
      }}
      onPointerMove={(event) => {
        if (hostRef.current)
          editor.tools.pointerMove(pointerInput(event, hostRef.current, clicksRef.current.current));
      }}
      onPointerUp={(event) => {
        if (event.button === SECONDARY_BUTTON) return;
        if (hostRef.current)
          editor.tools.pointerUp(pointerInput(event, hostRef.current, clicksRef.current.current));
      }}
      onPointerCancel={() => {
        editor.tools.cancel();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        const host = hostRef.current;
        if (!host || contextMenuJustOpened()) return;
        const rect = host.getBoundingClientRect();
        selectForContextMenu(editor, { x: event.clientX - rect.left, y: event.clientY - rect.top });
        showContextMenu(editor, { x: event.clientX, y: event.clientY }, host);
      }}
    >
      <AnnotationLabels />
      {marker && (
        <>
          <span
            className={`inference-marker inference-marker--${marker.kind}`}
            style={{ left: marker.x, top: marker.y }}
            aria-hidden="true"
          />
          {marker.label !== '' && (
            <span
              className="inference-tooltip"
              style={{ left: marker.x + 12, top: marker.y + 12 }}
              data-testid="inference-label"
            >
              {marker.label}
            </span>
          )}
        </>
      )}
      {overlay?.kind === 'selection-rectangle' && (
        <div
          className={`selection-rectangle selection-rectangle--${overlay.mode}`}
          style={{
            left: Math.min(overlay.x0, overlay.x1),
            top: Math.min(overlay.y0, overlay.y1),
            width: Math.abs(overlay.x1 - overlay.x0),
            height: Math.abs(overlay.y1 - overlay.y0),
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
