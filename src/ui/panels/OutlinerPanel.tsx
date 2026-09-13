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

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { buildOutlinerTree, flattenOutliner, type OutlinerNode } from '../../app/outliner/outlinerTree';
import { useEditor, useEditorState } from '../EditorContext';
import { showContextMenu } from '../contextmenu/contextMenuStore';
import { Glyph } from './panelIcons';
import { Panel } from './Panel';

function RenameInput({
  initial,
  onDone,
}: {
  readonly initial: string;
  readonly onDone: (name: string | null) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (name: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(name);
  };
  return (
    <input
      ref={ref}
      type="text"
      className="outliner__rename"
      aria-label="New name"
      value={draft}
      spellCheck={false}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(draft);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => {
        finish(draft);
      }}
    />
  );
}

/** The model hierarchy as a WAI-ARIA tree: arrows move and expand, Enter selects, F2 renames. */
export function OutlinerPanel() {
  const editor = useEditor();
  const revision = useEditorState((state) => state.revision);
  const selectionVersion = useEditorState((state) => state.selectionVersion);
  const editPath = useEditorState((state) => state.editPath);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const tree = useMemo(
    () => buildOutlinerTree(editor.session.doc, filter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, revision, filter],
  );
  const filtering = filter.trim() !== '';
  const isOpen = (node: OutlinerNode): boolean =>
    node.children.length > 0 && (filtering || expanded.has(node.key));
  const rows = flattenOutliner(tree, isOpen);

  const selectedKeys = useMemo(() => {
    const prefix = editPath.map((id) => `${String(id)}/`).join('');
    return new Set(editor.session.selection.ids('instance').map((id) => `${prefix}${String(id)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editPath, selectionVersion]);
  const openKeys = new Set(editPath.map((_, index) => editPath.slice(0, index + 1).join('/')));

  const focusedIndex = rows.findIndex((row) => row.node.key === focusKey);
  const tabStop = focusedIndex >= 0 ? focusedIndex : 0;

  const focusRow = (index: number) => {
    const row = rows[Math.min(Math.max(index, 0), rows.length - 1)];
    if (!row) return;
    setFocusKey(row.node.key);
    rowRefs.current.get(row.node.key)?.focus();
  };

  const setNodeExpanded = (key: string, open: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const select = (node: OutlinerNode) => {
    setFocusKey(node.key);
    editor.selectInstanceAtPath(node.parentPath, node.id);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number) => {
    const row = rows[index];
    if (!row || event.target !== event.currentTarget) return;
    const { node } = row;
    const open = isOpen(node);
    switch (event.key) {
      case 'ArrowDown':
        focusRow(index + 1);
        break;
      case 'ArrowUp':
        focusRow(index - 1);
        break;
      case 'Home':
        focusRow(0);
        break;
      case 'End':
        focusRow(rows.length - 1);
        break;
      case 'ArrowRight':
        if (node.children.length > 0 && !open) setNodeExpanded(node.key, true);
        else if (open) focusRow(index + 1);
        break;
      case 'ArrowLeft':
        if (open && !filtering) setNodeExpanded(node.key, false);
        else if (row.parentIndex >= 0) focusRow(row.parentIndex);
        break;
      case 'Enter':
      case ' ':
        select(node);
        break;
      case 'F2':
        setRenaming(node.key);
        break;
      case 'ContextMenu':
      case 'F10': {
        if (event.key === 'F10' && !event.shiftKey) return;
        select(node);
        const rect = event.currentTarget.getBoundingClientRect();
        showContextMenu(editor, { x: rect.left + 24, y: rect.bottom }, event.currentTarget);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const finishRename = (node: OutlinerNode, initial: string, name: string | null) => {
    setRenaming(null);
    rowRefs.current.get(node.key)?.focus();
    if (name !== null && name.trim() !== initial.trim()) {
      editor.updateInstanceAt(node.parentPath, node.id, { name });
    }
  };

  return (
    <Panel id="outliner" title="Outliner">
      <input
        type="search"
        className="panel__search"
        placeholder="Filter"
        aria-label="Filter groups and components"
        value={filter}
        onChange={(event) => {
          setFilter(event.target.value);
        }}
      />
      {rows.length === 0 ? (
        <p className="panel__empty">{filtering ? 'Nothing matches the filter' : 'No groups or components'}</p>
      ) : (
        <ul className="outliner" role="tree" aria-label="Model hierarchy">
          {rows.map((row, index) => {
            const { node } = row;
            const open = isOpen(node);
            const selected = selectedKeys.has(node.key);
            const inEditPath = openKeys.has(node.key);
            const initialName = node.name || (node.kind === 'group' ? node.label : '');
            const state = [node.hidden ? 'hidden' : '', node.locked ? 'locked' : '', inEditPath ? 'open' : '']
              .filter(Boolean)
              .join(', ');
            return (
              <li
                key={node.key}
                ref={(element) => {
                  if (element) rowRefs.current.set(node.key, element);
                  else rowRefs.current.delete(node.key);
                }}
                role="treeitem"
                aria-label={state ? `${node.label} (${state})` : node.label}
                aria-level={row.level}
                aria-setsize={row.setSize}
                aria-posinset={row.posInSet}
                aria-expanded={node.children.length > 0 ? open : undefined}
                aria-selected={selected}
                tabIndex={index === tabStop ? 0 : -1}
                className={[
                  'outliner__row',
                  selected ? 'outliner__row--selected' : '',
                  inEditPath ? 'outliner__row--open' : '',
                  node.hidden ? 'outliner__row--hidden' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ paddingInlineStart: `${String((row.level - 1) * 14 + 2)}px` }}
                onClick={() => {
                  select(node);
                }}
                onDoubleClick={() => {
                  editor.openInstanceAtPath(node.parentPath, node.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  select(node);
                  showContextMenu(editor, { x: event.clientX, y: event.clientY }, event.currentTarget);
                }}
                onFocus={(event) => {
                  if (event.target === event.currentTarget) setFocusKey(node.key);
                }}
                onKeyDown={(event) => {
                  onRowKeyDown(event, index);
                }}
              >
                <span
                  className="outliner__twisty"
                  aria-hidden="true"
                  onClick={(event) => {
                    if (node.children.length === 0 || filtering) return;
                    event.stopPropagation();
                    setNodeExpanded(node.key, !open);
                  }}
                >
                  {node.children.length > 0 ? (open ? '▾' : '▸') : ''}
                </span>
                <span className="outliner__kind" title={node.kind === 'group' ? 'Group' : 'Component'}>
                  <Glyph name={node.kind} />
                </span>
                {renaming === node.key ? (
                  <RenameInput
                    initial={initialName}
                    onDone={(name) => {
                      finishRename(node, initialName, name);
                    }}
                  />
                ) : (
                  <span
                    className="outliner__label"
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      setRenaming(node.key);
                    }}
                  >
                    {node.label}
                  </span>
                )}
                <button
                  type="button"
                  className="icon-button"
                  tabIndex={-1}
                  aria-label={`${node.hidden ? 'Show' : 'Hide'} ${node.label}`}
                  title={node.hidden ? 'Show' : 'Hide'}
                  onClick={(event) => {
                    event.stopPropagation();
                    editor.updateInstanceAt(node.parentPath, node.id, { hidden: !node.hidden });
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <Glyph name={node.hidden ? 'eyeOff' : 'eye'} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  tabIndex={-1}
                  aria-label={`${node.locked ? 'Unlock' : 'Lock'} ${node.label}`}
                  title={node.locked ? 'Unlock' : 'Lock'}
                  onClick={(event) => {
                    event.stopPropagation();
                    editor.updateInstanceAt(node.parentPath, node.id, { locked: !node.locked });
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <Glyph name={node.locked ? 'locked' : 'unlocked'} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
