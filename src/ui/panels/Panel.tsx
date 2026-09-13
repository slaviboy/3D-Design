import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { panelOrder, type DropPlacement } from '../../app/dock/dockLayout';
import { PANEL_IDS, type PanelId } from '../../app/panels/panels';
import { useEditor, useEditorState } from '../EditorContext';

/** Drag data type for reordering panels, so other drags (files, text) are ignored. */
const PANEL_DRAG_TYPE = 'application/x-planar-panel';

/** The newest focus request already handled, so reopening a panel later doesn't take focus again. */
let handledFocusSerial = 0;

function isPanelId(value: string): value is PanelId {
  return (PANEL_IDS as readonly string[]).includes(value);
}

function placementAt(event: DragEvent<HTMLElement>): DropPlacement {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

/**
 * A dock panel. The header button collapses and expands its body; Move up and Move down buttons, or dragging the
 * header, reorder the panels. The dock layout is editor state, so it is kept between sessions.
 */
export function Panel({
  id,
  title,
  children,
}: {
  readonly id: PanelId;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const editor = useEditor();
  const expanded = useEditorState((state) => !state.dockLayout.collapsed.includes(id));
  const order = useEditorState((state) => state.dockLayout.order);
  const focusRequest = useEditorState((state) => state.panelFocusRequest);
  const sectionRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [drop, setDrop] = useState<DropPlacement | null>(null);
  const titleId = `panel-${id}-title`;
  const bodyId = `panel-${id}-body`;

  useEffect(() => {
    if (focusRequest?.panel !== id || focusRequest.serial <= handledFocusSerial) return;
    handledFocusSerial = focusRequest.serial;
    sectionRef.current?.scrollIntoView({ block: 'nearest' });
    toggleRef.current?.focus({ preventScroll: true });
  }, [focusRequest, id]);

  return (
    <section
      ref={sectionRef}
      className={drop ? `panel panel--drop-${drop}` : 'panel'}
      aria-labelledby={titleId}
      data-panel={id}
      // The dock lays panels out in the saved order.
      style={{ order: panelOrder(order).indexOf(id) }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(PANEL_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDrop(placementAt(event));
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
      }}
      onDrop={(event) => {
        setDrop(null);
        const dragged = event.dataTransfer.getData(PANEL_DRAG_TYPE);
        if (!isPanelId(dragged)) return;
        event.preventDefault();
        editor.movePanelTo(dragged, id, placementAt(event));
      }}
    >
      <h2
        className="panel__title"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(PANEL_DRAG_TYPE, id);
          event.dataTransfer.effectAllowed = 'move';
        }}
      >
        <button
          ref={toggleRef}
          type="button"
          id={titleId}
          className="panel__toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => {
            editor.setPanelCollapsed(id, expanded);
          }}
        >
          <span className="panel__chevron" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
          {title}
        </button>
      </h2>
      <div className="panel__actions">
        <button
          type="button"
          className="icon-button"
          aria-label={`Move ${title} up`}
          title="Move up"
          onClick={() => {
            editor.movePanel(id, -1);
          }}
        >
          <span aria-hidden="true">↑</span>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Move ${title} down`}
          title="Move down"
          onClick={() => {
            editor.movePanel(id, 1);
          }}
        >
          <span aria-hidden="true">↓</span>
        </button>
      </div>
      <div className="panel__body" id={bodyId} hidden={!expanded}>
        {expanded && children}
      </div>
    </section>
  );
}
