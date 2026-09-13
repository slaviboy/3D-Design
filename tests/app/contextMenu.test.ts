import { describe, expect, it } from 'vitest';
import {
  buildContextMenu,
  contextMenuAnchor,
  contextMenuFor,
  contextMenuGroups,
  selectForContextMenu,
  summarizeSelection,
  type CommandLookup,
  type ContextMenuEntry,
  type SelectionSummary,
} from '../../src/app/contextMenu/contextMenu';
import type { Editor } from '../../src/app/Editor';
import { Selection } from '../../src/app/selection/Selection';
import type { EdgeId, InstanceId } from '../../src/kernel/ids';
import { vec3 } from '../../src/kernel/math/vec3';
import { draw, faceIds, rectangle } from '../kernel/helpers';
import { createTestEditor, screenOf } from './fixtures';

const NOTHING: SelectionSummary = {
  faces: 0,
  edges: 0,
  instances: 0,
  sections: 0,
  hidden: 0,
  lockedInstances: 0,
  softEdges: 0,
  curveEdges: 0,
  editDepth: 0,
};

/** A menu as a flat list: command ids, `Submenu > id` for submenu items, and `|` for separators. */
function outline(entries: readonly ContextMenuEntry[]): string[] {
  return entries.flatMap((entry) => {
    if (entry.kind === 'separator') return ['|'];
    if (entry.kind === 'command') return [entry.commandId];
    return entry.items.map((item) => `${entry.label} > ${item.commandId}`);
  });
}

/** An editor with a 2×2 m square face at (2, 2)–(4, 4), seen from above. */
function editorWithSquare(): { editor: Editor; face: number } {
  const editor = createTestEditor();
  draw(editor.session.doc, rectangle(2, 2, 4, 4));
  const [face] = faceIds(editor.session.doc.rootStore);
  if (face === undefined) throw new Error('expected a face');
  return { editor, face };
}

function selectFace(editor: Editor, face: number): void {
  editor.session.setSelection(Selection.of([{ kind: 'face', id: face }]));
}

describe('context menu entries', () => {
  it('offers selecting, closing and framing when nothing is selected', () => {
    expect(contextMenuGroups(NOTHING).flat()).toEqual([
      'edit.selectAll',
      'edit.unhideAll',
      'camera.zoomExtents',
    ]);
    expect(contextMenuGroups({ ...NOTHING, editDepth: 1 }).flat()).toContain('edit.closeGroup');

    const editor = createTestEditor();
    expect(outline(contextMenuFor(editor))).toEqual(['edit.selectAll', '|', 'camera.zoomExtents']);
  });

  it('lists only registered, enabled commands, with separators only between non-empty groups', () => {
    const lookup: CommandLookup = {
      label: (id) => (id === 'missing' ? undefined : `Label of ${id}`),
      isEnabled: (id) => !id.startsWith('disabled'),
      checked: (id) => (id === 'toggle' ? true : null),
    };
    const entries = buildContextMenu(
      [
        ['disabled.a', 'missing'],
        ['a', 'toggle', 'a'],
        [{ submenu: 'Empty', items: ['disabled.b'] }],
        [{ submenu: 'Select', items: ['select.connected', 'disabled.c'] }],
        [],
      ],
      lookup,
    );
    expect(entries).toEqual([
      { kind: 'command', commandId: 'a', label: 'Label of a', checked: null },
      { kind: 'command', commandId: 'toggle', label: 'Label of toggle', checked: true },
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: 'Select',
        items: [{ kind: 'command', commandId: 'select.connected', label: 'All Connected', checked: null }],
      },
    ]);
  });

  it('shows face commands for a selected face', () => {
    const { editor, face } = editorWithSquare();
    selectFace(editor, face);
    expect(outline(contextMenuFor(editor))).toEqual([
      'edit.entityInfo',
      'edit.delete',
      'edit.hide',
      '|',
      'edit.makeGroup',
      'edit.makeComponent',
      '|',
      'Select > select.connected',
      'Select > select.boundingEdges',
      'Select > select.sameTag',
      'Select > select.sameMaterial',
      'Select > select.invert',
      'Flip Along > edit.flipX',
      'Flip Along > edit.flipY',
      'Flip Along > edit.flipZ',
      '|',
      'edit.reverseFaces',
      'Intersect Faces > edit.intersectWithModel',
      '|',
      'materials.paintSelection',
      'materials.sample',
      '|',
      'camera.zoomSelection',
    ]);
  });

  it('shows edge commands, and Unsoften only for soft edges', () => {
    const { editor } = editorWithSquare();
    const [edge] = [...editor.session.doc.rootStore.edges()].map((e) => e.id);
    editor.session.setSelection(Selection.of([{ kind: 'edge', id: edge as EdgeId }]));
    const items = outline(contextMenuFor(editor));
    expect(items).toEqual(expect.arrayContaining(['edit.soften', 'edit.divide', 'camera.zoomSelection']));
    expect(items).not.toContain('edit.unsoften');
    expect(items).not.toContain('edit.reverseFaces');
    expect(items).not.toContain('edit.explodeCurve');
    expect(items).not.toContain('materials.sample');

    editor.updateSelectionAttributes({ soft: true, smooth: true });
    expect(outline(contextMenuFor(editor))).toContain('edit.unsoften');
  });

  it('shows group commands, and hides changes a locked group refuses', () => {
    const { editor } = editorWithSquare();
    editor.selectAll();
    editor.groupSelection('group');
    const items = outline(contextMenuFor(editor));
    expect(items).toEqual(
      expect.arrayContaining([
        'edit.delete',
        'edit.lock',
        'edit.openGroup',
        'edit.explode',
        'Select > select.sameTag',
        'Flip Along > edit.flipX',
      ]),
    );
    expect(items).not.toContain('edit.unlock');
    expect(items).not.toContain('edit.makeUnique');
    expect(items).not.toContain('Select > select.connected');

    editor.updateSelectionAttributes({ locked: true });
    const locked = outline(contextMenuFor(editor));
    expect(locked).toContain('edit.unlock');
    for (const refused of [
      'edit.lock',
      'edit.delete',
      'edit.explode',
      'edit.openGroup',
      'Flip Along > edit.flipX',
    ]) {
      expect(locked).not.toContain(refused);
    }

    editor.updateSelectionAttributes({ locked: false });
    editor.groupSelection('component');
    expect(outline(contextMenuFor(editor))).toContain('edit.makeUnique');
  });

  it('shows section plane commands for a selected section plane', () => {
    const editor = createTestEditor();
    editor.placeSectionPlane(vec3(0, 0, 0), vec3(1, 0, 0));
    const entries = contextMenuFor(editor);
    expect(outline(entries)).toEqual([
      'edit.entityInfo',
      'edit.delete',
      '|',
      'section.toggleActive',
      'section.reverse',
      'section.createGroupFromSlice',
    ]);
    expect(
      entries.find((entry) => entry.kind === 'command' && entry.commandId === 'section.toggleActive'),
    ).toEqual(expect.objectContaining({ label: 'Active Cut', checked: true }));
  });

  it('offers Unhide for hidden entities in the selection and Close Group inside a group', () => {
    const { editor, face } = editorWithSquare();
    selectFace(editor, face);
    editor.updateSelectionAttributes({ hidden: true });
    expect(summarizeSelection(editor)).toMatchObject({ faces: 1, hidden: 1 });
    const items = outline(contextMenuFor(editor));
    expect(items).toContain('edit.unhide');
    expect(items).not.toContain('edit.hide');

    editor.clearSelection();
    expect(outline(contextMenuFor(editor))).toContain('edit.unhideAll');

    editor.selectAll();
    editor.updateSelectionAttributes({ hidden: false });
    editor.selectAll();
    editor.groupSelection('group');
    const [group] = editor.session.selection.ids('instance');
    editor.openGroup(group as InstanceId);
    editor.clearSelection();
    expect(outline(contextMenuFor(editor))).toContain('edit.closeGroup');
  });
});

describe('opening a context menu', () => {
  it('selects an unselected entity under the pointer and keeps a selection it points at', () => {
    const { editor, face } = editorWithSquare();
    const inside = screenOf(3, 3);
    const edges = [...editor.session.doc.rootStore.edges()].map((edge) => edge.id);

    editor.session.setSelection(Selection.of(edges.map((id) => ({ kind: 'edge', id }))));
    selectForContextMenu(editor, inside);
    expect(editor.session.selection.refs()).toEqual([{ kind: 'face', id: face }]);

    editor.session.setSelection(
      Selection.of([{ kind: 'face', id: face }, ...edges.map((id) => ({ kind: 'edge' as const, id }))]),
    );
    selectForContextMenu(editor, inside);
    expect(editor.session.selection.size).toBe(5);

    selectForContextMenu(editor, screenOf(-4, -4));
    expect(editor.session.selection.size).toBe(5);
  });

  it('anchors keyboard menus at the selection center, or the view center without a selection', () => {
    const { editor, face } = editorWithSquare();
    expect(contextMenuAnchor(editor)).toEqual({ x: 100, y: 100 });
    selectFace(editor, face);
    const anchor = contextMenuAnchor(editor);
    expect(anchor.x).toBeCloseTo(160, 6);
    expect(anchor.y).toBeCloseTo(40, 6);
  });
});
