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
import type { PointerInput, PointerKind } from '../../app/tools/Tool';
import { Viewport } from '../../render/Viewport';
import { useEditor, useEditorState } from '../EditorContext';
import { AnnotationLabels } from './AnnotationLabels';
import { selectForContextMenu } from '../../app/contextMenu/contextMenu';
import { closeContextMenu, contextMenuJustOpened, showContextMenu } from '../contextmenu/contextMenuStore';
import { ClickCounter } from './clickCount';
import { UndoBanner } from './UndoBanner';

/** The right mouse button opens the context menu instead of reaching the active tool. */
const SECONDARY_BUTTON = 2;

/** Wheel deltas in lines (Firefox with a mouse) are converted at this many pixels a line. */
const WHEEL_LINE_HEIGHT_PX = 16;

/** Captures a pointer, so moves outside the view still reach it; synthetic pointers in tests can't be captured. */
function capture(host: HTMLElement, pointerId: number): void {
  try {
    host.setPointerCapture(pointerId);
  } catch {
    // Input still works, only without capture.
  }
}

function localPoint(event: ReactPointerEvent<HTMLElement>, element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pointerKind(type: string): PointerKind {
  return type === 'touch' || type === 'pen' ? type : 'mouse';
}

/** Safari's pinch gesture events (not in the standard DOM types). */
interface GestureEvent extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

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
    pointerType: pointerKind(event.pointerType),
  };
}

export function ViewportHost() {
  const editor = useEditor();
  const hostRef = useRef<HTMLDivElement>(null);
  const clicksRef = useRef(new ClickCounter());
  /** The pointer pressed on the tool, whose cancellation (by the system, mid-gesture) cancels the tool's operation. */
  const pressRef = useRef<number | null>(null);
  /** When the last touch ended: the browser's own long-press context menu then is ignored, as touch opens its own. */
  const lastTouchRef = useRef(Number.NEGATIVE_INFINITY);
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
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? WHEEL_LINE_HEIGHT_PX
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? rect.height
            : 1;
      editor.tools.wheel({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        deltaX: event.deltaX * unit,
        deltaY: event.deltaY * unit,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      });
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    // Safari zooms the page on a pinch unless its gesture events are cancelled; a trackpad pinch over the view
    // zooms the model instead.
    let lastScale = 1;
    const preventPageZoom = (event: Event) => {
      event.preventDefault();
    };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureEvent;
      if (editor.touch.activePointerCount === 0 && gesture.scale > 0) {
        const rect = host.getBoundingClientRect();
        editor.tools.pinch(
          { x: gesture.clientX - rect.left, y: gesture.clientY - rect.top },
          gesture.scale / lastScale,
        );
      }
      lastScale = gesture.scale;
    };
    document.addEventListener('gesturestart', preventPageZoom);
    host.addEventListener('gesturestart', onGestureStart);
    host.addEventListener('gesturechange', onGestureChange);
    const detachTouch = editor.touch.attach({
      openContextMenu: (point) => {
        const rect = host.getBoundingClientRect();
        selectForContextMenu(editor, point);
        showContextMenu(editor, { x: rect.left + point.x, y: rect.top + point.y }, host);
      },
      closeContextMenu,
    });
    const relay = editor.exchange.viewCapture;
    const detachCapture =
      relay instanceof ViewCaptureRelay ? relay.attach((options) => viewport.capture(options)) : null;
    return () => {
      detachTouch();
      detachCapture?.();
      host.removeEventListener('wheel', onWheel);
      document.removeEventListener('gesturestart', preventPageZoom);
      host.removeEventListener('gesturestart', onGestureStart);
      host.removeEventListener('gesturechange', onGestureChange);
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
        if (event.pointerType === 'touch') {
          capture(host, event.pointerId);
          host.focus({ preventScroll: true });
          editor.touch.pointerDown(event.pointerId, localPoint(event, host));
          return;
        }
        if (event.button === SECONDARY_BUTTON) {
          host.focus({ preventScroll: true });
          return;
        }
        capture(host, event.pointerId);
        host.focus({ preventScroll: true });
        pressRef.current = event.pointerId;
        editor.tools.pointerDown(pointerInput(event, host, clicksRef.current.press(event)));
      }}
      onPointerMove={(event) => {
        const host = hostRef.current;
        if (!host) return;
        if (event.pointerType === 'touch') {
          editor.touch.pointerMove(event.pointerId, localPoint(event, host));
          return;
        }
        editor.tools.pointerMove(pointerInput(event, host, clicksRef.current.current));
      }}
      onPointerUp={(event) => {
        const host = hostRef.current;
        if (event.pointerType === 'touch') {
          lastTouchRef.current = event.timeStamp;
          if (host) editor.touch.pointerUp(event.pointerId, localPoint(event, host));
          return;
        }
        if (event.button === SECONDARY_BUTTON) return;
        if (event.pointerId === pressRef.current) pressRef.current = null;
        if (hostRef.current)
          editor.tools.pointerUp(pointerInput(event, hostRef.current, clicksRef.current.current));
      }}
      onPointerCancel={(event) => {
        if (event.pointerType === 'touch') {
          lastTouchRef.current = event.timeStamp;
          editor.touch.pointerCancel(event.pointerId);
          return;
        }
        if (event.pointerId !== pressRef.current) return;
        pressRef.current = null;
        editor.tools.cancel();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        const host = hostRef.current;
        // A long press on a touch screen opens the menu through touch input, which also handles what comes after.
        const fromTouch =
          editor.touch.activePointerCount > 0 || event.timeStamp - lastTouchRef.current < 1000;
        if (!host || fromTouch || contextMenuJustOpened()) return;
        const rect = host.getBoundingClientRect();
        selectForContextMenu(editor, { x: event.clientX - rect.left, y: event.clientY - rect.top });
        showContextMenu(editor, { x: event.clientX, y: event.clientY }, host);
      }}
    >
      <AnnotationLabels />
      <UndoBanner />
      {marker && (
        <>
          <span
            className={`inference-marker inference-marker--${marker.kind}`}
            style={{ left: marker.x, top: marker.y }}
            aria-hidden="true"
          />
          {marker.label !== '' && (
            <span
              // A finger covers the point it touches, so for touch the label sits above it.
              className={`inference-tooltip${editor.pointerKind === 'touch' ? ' inference-tooltip--touch' : ''}`}
              style={
                editor.pointerKind === 'touch'
                  ? { left: marker.x, top: marker.y }
                  : { left: marker.x + 12, top: marker.y + 12 }
              }
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
