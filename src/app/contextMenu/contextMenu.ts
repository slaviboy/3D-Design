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

import type { EdgeId, FaceId, InstanceId } from '../../kernel/ids';
import { vec3 } from '../../kernel/math/vec3';
import { projectToScreen, type ScreenPoint } from '../camera/camera';
import type { Editor } from '../Editor';
import { transformAabb } from '../geometry/bounds';
import { Selection } from '../selection/Selection';
import { selectionBounds, transformSelectionOf } from '../tools/transformSupport';

/** What is selected, as far as choosing context menu entries is concerned. */
export interface SelectionSummary {
  readonly faces: number;
  readonly edges: number;
  readonly instances: number;
  readonly sections: number;
  /** Selected faces, edges, groups and components that are hidden themselves. */
  readonly hidden: number;
  readonly lockedInstances: number;
  /** Selected edges that are soft or smooth. */
  readonly softEdges: number;
  /** Selected edges that belong to a curve. */
  readonly curveEdges: number;
  /** Number of open groups and components. */
  readonly editDepth: number;
}

export interface ContextSubmenuSpec {
  readonly submenu: string;
  readonly items: readonly string[];
}

/** A command id, or a labeled submenu of command ids. */
export type ContextMenuItemSpec = string | ContextSubmenuSpec;

export interface ContextMenuCommandEntry {
  readonly kind: 'command';
  readonly commandId: string;
  readonly label: string;
  /** For toggles, whether the command is on; null for plain commands. */
  readonly checked: boolean | null;
}

export type ContextMenuEntry =
  | ContextMenuCommandEntry
  | { readonly kind: 'submenu'; readonly label: string; readonly items: readonly ContextMenuCommandEntry[] }
  | { readonly kind: 'separator' };

/** How the context menu finds commands; the editor's command registry in the app, a fake in tests. */
export interface CommandLookup {
  /** The command's label, or undefined when no such command is registered. */
  label(commandId: string): string | undefined;
  isEnabled(commandId: string): boolean;
  /** Whether a toggle command is on; null when the command is not a toggle. */
  checked(commandId: string): boolean | null;
}

const SELECT_SUBMENU: ContextSubmenuSpec = {
  submenu: 'Select',
  items: [
    'select.connected',
    'select.boundingEdges',
    'select.sameTag',
    'select.sameMaterial',
    'select.invert',
  ],
};

const FLIP_SUBMENU: ContextSubmenuSpec = {
  submenu: 'Flip Along',
  items: ['edit.flipX', 'edit.flipY', 'edit.flipZ'],
};

const INTERSECT_SUBMENU: ContextSubmenuSpec = {
  submenu: 'Intersect Faces',
  items: ['edit.intersectWithModel', 'edit.intersectWithSelection'],
};

const SOLID_TOOLS_SUBMENU: ContextSubmenuSpec = {
  submenu: 'Solid Tools',
  items: [
    'tools.outerShell',
    'tools.union',
    'tools.subtract',
    'tools.trim',
    'tools.intersect',
    'tools.split',
  ],
};

/** Shorter labels for commands inside a submenu, whose title already gives the context. */
export const SUBMENU_ITEM_LABELS: Readonly<Record<string, string>> = {
  'select.connected': 'All Connected',
  'select.boundingEdges': 'Bounding Edges',
  'select.sameTag': 'All on Same Tag',
  'select.sameMaterial': 'All with Same Material',
  'select.invert': 'Invert Selection',
  'edit.flipX': 'Red Direction',
  'edit.flipY': 'Green Direction',
  'edit.flipZ': 'Blue Direction',
  'edit.intersectWithModel': 'With Model',
  'edit.intersectWithSelection': 'With Selection',
};

/**
 * The commands that may apply to a selection, in groups the menu separates. Commands that are not registered or
 * not enabled are left out later by `buildContextMenu`.
 */
export function contextMenuGroups(summary: SelectionSummary): ContextMenuItemSpec[][] {
  const { faces, edges, instances, sections, hidden, lockedInstances, editDepth } = summary;
  const entities = faces + edges + instances;
  if (entities + sections === 0) {
    return [
      ['edit.selectAll', 'edit.unhideAll'],
      editDepth > 0 ? ['edit.closeGroup'] : [],
      ['camera.zoomExtents'],
    ];
  }
  const anyLocked = lockedInstances > 0;
  const when = <T>(condition: boolean, items: readonly T[]): T[] => (condition ? [...items] : []);
  return [
    [
      'edit.entityInfo',
      ...when(!anyLocked, ['edit.delete']),
      ...when(entities > hidden, ['edit.hide']),
      ...when(hidden > 0, ['edit.unhide']),
      ...when(instances > lockedInstances, ['edit.lock']),
      ...when(anyLocked, ['edit.unlock']),
    ],
    [
      ...when(entities > 0, ['edit.makeGroup', 'edit.makeComponent']),
      ...when(instances > 0 && !anyLocked, ['edit.openGroup', 'edit.explode', 'edit.makeUnique']),
      ...when(editDepth > 0, ['edit.closeGroup']),
    ],
    [...when(entities > 0, [SELECT_SUBMENU]), ...when(entities > 0 && !anyLocked, [FLIP_SUBMENU])],
    [
      ...when(edges > 0, ['edit.soften']),
      ...when(summary.softEdges > 0, ['edit.unsoften']),
      ...when(edges > 0, ['edit.weld', 'edit.divide']),
      ...when(summary.curveEdges > 0, ['edit.explodeCurve']),
      ...when(faces > 0, ['edit.reverseFaces', INTERSECT_SUBMENU]),
      ...when(instances >= 2, [SOLID_TOOLS_SUBMENU]),
    ],
    when(sections > 0, ['section.toggleActive', 'section.reverse', 'section.createGroupFromSlice']),
    when(faces + instances > 0, ['materials.paintSelection', 'materials.sample']),
    when(entities > 0, ['camera.zoomSelection']),
  ];
}

/** Turns groups of command ids into menu entries: only registered, enabled commands, with separators between groups. */
export function buildContextMenu(
  groups: readonly (readonly ContextMenuItemSpec[])[],
  lookup: CommandLookup,
): ContextMenuEntry[] {
  const command = (commandId: string, override?: string): ContextMenuCommandEntry | null => {
    const label = lookup.label(commandId);
    if (label === undefined || !lookup.isEnabled(commandId)) return null;
    return { kind: 'command', commandId, label: override ?? label, checked: lookup.checked(commandId) };
  };
  const entries: ContextMenuEntry[] = [];
  const used = new Set<string>();
  for (const group of groups) {
    const items: ContextMenuEntry[] = [];
    for (const spec of group) {
      if (typeof spec === 'string') {
        const entry = used.has(spec) ? null : command(spec);
        if (entry) items.push(entry);
        used.add(spec);
        continue;
      }
      const submenu = spec.items
        .map((commandId) => command(commandId, SUBMENU_ITEM_LABELS[commandId]))
        .filter((entry): entry is ContextMenuCommandEntry => entry !== null);
      if (submenu.length > 0) items.push({ kind: 'submenu', label: spec.submenu, items: submenu });
    }
    if (items.length === 0) continue;
    if (entries.length > 0) entries.push({ kind: 'separator' });
    entries.push(...items);
  }
  return entries;
}

export function summarizeSelection(editor: Editor): SelectionSummary {
  const { session } = editor;
  const { selection } = session;
  const store = session.doc.store(session.activeContext);
  let hidden = 0;
  let lockedInstances = 0;
  let softEdges = 0;
  let curveEdges = 0;
  for (const id of selection.ids('instance')) {
    const attributes = store.instance(id as InstanceId)?.attributes;
    if (attributes?.hidden) hidden++;
    if (attributes?.locked) lockedInstances++;
  }
  for (const id of selection.ids('face')) {
    if (store.face(id as FaceId)?.attributes.hidden) hidden++;
  }
  for (const id of selection.ids('edge')) {
    const edge = store.edge(id as EdgeId);
    if (!edge) continue;
    if (edge.attributes.hidden) hidden++;
    if (edge.attributes.soft || edge.attributes.smooth) softEdges++;
    if (edge.curve !== null) curveEdges++;
  }
  return {
    faces: selection.count('face'),
    edges: selection.count('edge'),
    instances: selection.count('instance'),
    sections: selection.count('section'),
    hidden,
    lockedInstances,
    softEdges,
    curveEdges,
    editDepth: session.editPath.length,
  };
}

/** Looks commands up in the editor's registry. */
export function editorCommandLookup(editor: Editor): CommandLookup {
  return {
    label: (commandId) => editor.commands.get(commandId)?.label,
    isEnabled: (commandId) => editor.commands.isEnabled(commandId, editor),
    checked: (commandId) =>
      editor.commands.get(commandId)?.isChecked ? editor.commands.isChecked(commandId, editor) : null,
  };
}

/** The context menu for the current selection. */
export function contextMenuFor(editor: Editor): ContextMenuEntry[] {
  return buildContextMenu(contextMenuGroups(summarizeSelection(editor)), editorCommandLookup(editor));
}

/**
 * Prepares a context menu opened with the pointer at a viewport position: an entity that isn't selected becomes
 * the selection, as a click with the Select tool would do, while a click on part of the selection keeps it.
 */
export function selectForContextMenu(editor: Editor, screen: ScreenPoint): void {
  const { session } = editor;
  const hit = editor.pickAt(screen, { includeSectionPlanes: session.showSectionPlanes });
  if (!hit || session.selection.has(hit.ref)) return;
  editor.tools.cancel();
  session.setSelection(Selection.of([hit.ref]));
}

/** Where a context menu opened from the keyboard appears, in viewport pixels: the selection's center, if visible. */
export function contextMenuAnchor(editor: Editor): ScreenPoint {
  const { session } = editor;
  const size = editor.viewportSize;
  const center = { x: size.width / 2, y: size.height / 2 };
  const box = selectionBounds(editor, transformSelectionOf(session.selection));
  if (!box) return center;
  const world = transformAabb(box, session.activeContextTransform);
  const projected = projectToScreen(
    session.camera,
    vec3((world.minX + world.maxX) / 2, (world.minY + world.maxY) / 2, (world.minZ + world.maxZ) / 2),
    size,
  );
  if (
    !projected ||
    projected.x < 0 ||
    projected.y < 0 ||
    projected.x > size.width ||
    projected.y > size.height
  ) {
    return center;
  }
  return { x: projected.x, y: projected.y };
}
