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

import { useEffect, useState } from 'react';
import {
  CORNER_IDS,
  gestureCommand,
  gestureTool,
  type CornerId,
  type GestureAction,
} from '../../app/gestures/gestureSettings';
import { useEditorState } from '../EditorContext';
import { hasIcon, Icon } from '../icons/Icon';

/** A corner zone that just ran its action; `serial` restarts the ripple for each tap. */
export interface CornerFlash {
  readonly corner: CornerId;
  readonly label: string;
  readonly serial: number;
}

/** Corner zones answer fingers and pens, so they only show on devices with a touch screen. */
export function isTouchDevice(): boolean {
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}

function iconFor(action: GestureAction): string | null {
  const id = gestureTool(action) ?? gestureCommand(action);
  return id !== null && hasIcon(id) ? id : null;
}

const cornerClass = (corner: CornerId): string =>
  corner.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** How long the name of the tool now in use stays by the corner, in milliseconds. */
const FLASH_MS = 1100;

/**
 * The corner zones of the view: faint marks showing where they are and what they do, and a ripple with the name of
 * the tool now in use when one runs. The zones themselves are found from the touches (see `TouchController`), so
 * nothing here takes pointer events.
 */
export function CornerZones({ flash }: { readonly flash: CornerFlash | null }) {
  const touch = useEditorState((state) => state.preferences.touch);
  const [touchDevice] = useState(isTouchDevice);
  // Shown for a moment by state rather than by an animation, so it still shows when motion is reduced.
  const [shownSerial, setShownSerial] = useState<number | null>(null);

  useEffect(() => {
    if (!flash) return;
    setShownSerial(flash.serial);
    const timer = window.setTimeout(() => {
      setShownSerial(null);
    }, FLASH_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [flash]);

  if (!touchDevice) return null;
  const size = touch.cornerSizePx;
  return (
    <>
      {touch.showCornerHints &&
        CORNER_IDS.filter((corner) => touch.corners[corner].action !== 'none').map((corner) => {
          const icon = iconFor(touch.corners[corner].action);
          return (
            <div
              key={corner}
              className={`corner-zone corner-zone--${cornerClass(corner)}`}
              style={{ width: size, height: size }}
              data-testid={`corner-zone-${corner}`}
              aria-hidden="true"
            >
              {icon !== null && (
                <span className="corner-zone__icon">
                  <Icon commandId={icon} />
                </span>
              )}
            </div>
          );
        })}
      {flash?.serial === shownSerial && (
        <div
          key={flash.serial}
          className={`corner-flash corner-flash--${cornerClass(flash.corner)}`}
          data-testid="corner-flash"
          aria-hidden="true"
        >
          <span className="corner-flash__ripple" style={{ width: size * 2, height: size * 2 }} />
          <span className="corner-flash__label">{flash.label}</span>
        </div>
      )}
      <div className="visually-hidden" role="status" aria-live="polite">
        {flash?.label ?? ''}
      </div>
    </>
  );
}
