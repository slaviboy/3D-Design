import type { FaceId } from '../../kernel/ids';
import { intersectFaces, type IntersectTarget } from '../../kernel/ops/intersect';
import type { CommandDefinition, CommandRegistry } from '../commands/CommandRegistry';
import type { Editor } from '../Editor';
import { Selection } from '../selection/Selection';
import { FOLLOW_ME_TOOL_ID } from '../tools/FollowMeTool';
import { hasSolidToolInputs, runSolidTool, SOLID_TOOLS, type SolidToolKind } from './solidTools';

type EditorCommand = CommandDefinition<Editor>;

/** Intersects the selected faces and selects the new edges. */
export function intersectSelectedFaces(editor: Editor, target: IntersectTarget): void {
  const { session } = editor;
  editor.tools.cancel();
  const faces = session.selection.ids('face') as FaceId[];
  const created = intersectFaces(session.doc, session.activeContext, faces, { with: target });
  if (created.length === 0) {
    editor.notify('info', 'The selected faces do not cross any other faces.');
    return;
  }
  session.setSelection(Selection.of(created.map((id) => ({ kind: 'edge' as const, id }))));
}

const SOLID_TOOL_ALIASES: Readonly<Record<SolidToolKind, readonly string[]>> = {
  outerShell: ['solid tools', 'shell', 'merge solids', 'remove inside'],
  union: ['solid tools', 'boolean', 'combine', 'add solids'],
  subtract: ['solid tools', 'boolean', 'cut', 'difference', 'minus'],
  trim: ['solid tools', 'boolean', 'cut and keep'],
  intersect: ['solid tools', 'boolean', 'overlap', 'common'],
  split: ['solid tools', 'boolean', 'separate'],
};

/** Commands for Intersect Faces, Follow Me and the solid tools. */
export function registerSolidCommands(registry: CommandRegistry<Editor>): void {
  const intersect = (target: IntersectTarget, label: string, minimumFaces: number): EditorCommand => ({
    id: target === 'model' ? 'edit.intersectWithModel' : 'edit.intersectWithSelection',
    label,
    category: 'Edit',
    description: 'Add edges where the selected faces cross other faces',
    aliases: ['intersect faces', 'imprint', 'cut lines'],
    isEnabled: (editor) => editor.session.selection.count('face') >= minimumFaces,
    run: (editor) => {
      intersectSelectedFaces(editor, target);
    },
  });

  registry.register(
    intersect('model', 'Intersect Faces with Model', 1),
    intersect('selection', 'Intersect Faces with Selection', 2),
    {
      id: FOLLOW_ME_TOOL_ID,
      label: 'Follow Me',
      category: 'Tools',
      aliases: ['sweep', 'lathe', 'extrude along path', 'revolve'],
      isChecked: (editor) => editor.tools.activeToolId === FOLLOW_ME_TOOL_ID,
      run: (editor) => {
        editor.activateTool(FOLLOW_ME_TOOL_ID);
      },
    },
    ...(Object.keys(SOLID_TOOLS) as SolidToolKind[]).map((kind): EditorCommand => ({
      id: `tools.${kind}`,
      label: SOLID_TOOLS[kind].label,
      category: 'Tools',
      description:
        SOLID_TOOLS[kind].inputs === 'pair'
          ? 'Works on two selected solid groups or components; the first selected acts on the second'
          : 'Works on two or more selected solid groups or components',
      aliases: SOLID_TOOL_ALIASES[kind],
      isEnabled: (editor) => hasSolidToolInputs(editor, kind),
      run: async (editor) => {
        await runSolidTool(editor, kind);
      },
    })),
  );
}
