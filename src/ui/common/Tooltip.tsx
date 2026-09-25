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

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditorState } from '../EditorContext';

/** How long the pointer rests on a button before its name appears. Short enough to feel immediate. */
export const TOOLTIP_DELAY_MS = 250;
/** Focus this soon after a touch comes from the tap, not from the keyboard, and shows no tooltip. */
const TOUCH_FOCUS_QUIET_MS = 1000;
/** Gap between the button and the tooltip, and the smallest margin to the window edge. */
const GAP_PX = 8;
const EDGE_PX = 8;
/** Buttons this far from the left edge are in the tool palette, where a tooltip reads better beside the button. */
const PALETTE_EDGE_FRACTION = 0.25;

export interface TooltipRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface TooltipSize {
  readonly width: number;
  readonly height: number;
}

export interface TooltipPlacement {
  readonly x: number;
  readonly y: number;
  readonly side: 'right' | 'below';
}

/**
 * Where to put the tooltip for a button: beside it in the vertical tool palette, below it elsewhere, always kept
 * inside the window.
 */
export function tooltipPlacement(
  target: TooltipRect,
  viewport: TooltipSize,
  tip: TooltipSize,
): TooltipPlacement {
  const clamp = (value: number, max: number): number => Math.max(EDGE_PX, Math.min(value, max - EDGE_PX));
  const side = target.right < viewport.width * PALETTE_EDGE_FRACTION ? 'right' : 'below';
  const x = side === 'right' ? target.right + GAP_PX : (target.left + target.right) / 2 - tip.width / 2;
  const y = side === 'right' ? (target.top + target.bottom) / 2 - tip.height / 2 : target.bottom + GAP_PX;
  return {
    x: clamp(x, viewport.width - tip.width),
    y: clamp(y, viewport.height - tip.height),
    side,
  };
}

interface Hovered {
  readonly label: string;
  readonly rect: TooltipRect;
}

/**
 * Shows the name of the button under the pointer, after a short delay, for every element carrying `data-tooltip`.
 * One layer serves the whole window, so buttons only have to name themselves. Turned off in Preferences, where the
 * buttons fall back to the browser's own tooltip.
 */
export function TooltipLayer() {
  const enabled = useEditorState((state) => state.preferences.toolTips);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) {
      setHovered(null);
      return;
    }
    let timer: number | undefined;
    const hide = (): void => {
      window.clearTimeout(timer);
      setHovered(null);
    };
    const show = (element: HTMLElement): void => {
      const label = element.dataset.tooltip;
      if (label === undefined || label === '') return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const rect = element.getBoundingClientRect();
        setHovered({
          label,
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        });
      }, TOOLTIP_DELAY_MS);
    };
    const targetOf = (event: Event): HTMLElement | null =>
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tooltip]') : null;
    // A finger has no hover: a tap would otherwise leave a tooltip standing, from the pointer or the focus it gives.
    let lastTouch = Number.NEGATIVE_INFINITY;
    const onOver = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') {
        lastTouch = event.timeStamp;
        hide();
        return;
      }
      const element = targetOf(event);
      if (element) show(element);
      else hide();
    };
    const onFocus = (event: FocusEvent): void => {
      if (event.timeStamp - lastTouch < TOUCH_FOCUS_QUIET_MS) return;
      const element = targetOf(event);
      if (element) show(element);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('pointerover', onOver);
    window.addEventListener('pointerdown', hide);
    window.addEventListener('pointerleave', hide);
    window.addEventListener('focusin', onFocus);
    window.addEventListener('focusout', hide);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerover', onOver);
      window.removeEventListener('pointerdown', hide);
      window.removeEventListener('pointerleave', hide);
      window.removeEventListener('focusin', onFocus);
      window.removeEventListener('focusout', hide);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [enabled]);

  // The tooltip is measured once it holds its text, then moved into place, so it never hangs off the window.
  useLayoutEffect(() => {
    const element = tipRef.current;
    if (!hovered || !element) {
      setPlacement(null);
      return;
    }
    const box = element.getBoundingClientRect();
    setPlacement(
      tooltipPlacement(
        hovered.rect,
        { width: window.innerWidth, height: window.innerHeight },
        { width: box.width, height: box.height },
      ),
    );
  }, [hovered]);

  if (!enabled || !hovered) return null;
  return (
    <div
      ref={tipRef}
      className="tooltip"
      role="tooltip"
      data-testid="tooltip"
      data-side={placement?.side ?? 'below'}
      style={{
        left: `${String(placement?.x ?? 0)}px`,
        top: `${String(placement?.y ?? 0)}px`,
        visibility: placement ? 'visible' : 'hidden',
      }}
    >
      {hovered.label}
    </div>
  );
}
