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

import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** What Tab reaches inside `root`, in document order: enabled controls that are shown. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0 && element.closest('[hidden], [inert]') === null,
  );
}

/**
 * Modal dialog: focus moves into it, Tab stays inside, Escape closes, and focus returns to where it was. The first
 * element marked `data-autofocus` gets focus, otherwise the first text field, otherwise the first control.
 */
export function Dialog({ title, onClose, children, className }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog) {
      const items = focusableIn(dialog);
      const marked = items.find((item) => item.matches('[data-autofocus], [autofocus]'));
      (marked ?? items.find((item) => item instanceof HTMLInputElement) ?? items[0])?.focus();
    }
    return () => {
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          } else if (event.key === 'Tab' && dialogRef.current) {
            const items = focusableIn(dialogRef.current);
            const first = items[0];
            const last = items.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
