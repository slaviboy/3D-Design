import { useState, type ReactNode } from 'react';
import type { PanelId } from '../../app/panels/panels';

/** A dock panel with a header button that collapses and expands its body. */
export function Panel({
  id,
  title,
  children,
}: {
  readonly id: PanelId;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const titleId = `panel-${id}-title`;
  const bodyId = `panel-${id}-body`;
  return (
    <section className="panel" aria-labelledby={titleId} data-panel={id}>
      <h2 className="panel__title">
        <button
          type="button"
          id={titleId}
          className="panel__toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          <span className="panel__chevron" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
          {title}
        </button>
      </h2>
      <div className="panel__body" id={bodyId} hidden={!expanded}>
        {expanded && children}
      </div>
    </section>
  );
}
