import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}

/** Modal dialog: focus moves into it, Tab stays inside, Escape closes, and focus returns to where it was. */
export function Dialog({ title, onClose, children, className }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () =>
      dialog
        ? [
            ...dialog.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
            ),
          ]
        : [];
    (dialog?.querySelector<HTMLElement>('[autofocus], input') ?? focusable()[0])?.focus();
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
            const items = [
              ...dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
              ),
            ];
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
