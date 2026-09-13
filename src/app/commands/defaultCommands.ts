import type { InstanceId } from '../../kernel/ids';
import type { StandardView } from '../camera/camera';
import type { Editor } from '../Editor';
import {
  CIRCLE_TOOL_ID,
  ERASER_TOOL_ID,
  LINE_TOOL_ID,
  MOVE_TOOL_ID,
  ORBIT_TOOL_ID,
  PAN_TOOL_ID,
  POLYGON_TOOL_ID,
  PUSH_PULL_TOOL_ID,
  RECTANGLE_TOOL_ID,
  SELECT_TOOL_ID,
  TAPE_MEASURE_TOOL_ID,
  ZOOM_TOOL_ID,
} from '../tools/Tool';
import type { CommandCategory, CommandDefinition, CommandRegistry } from './CommandRegistry';

type EditorCommand = CommandDefinition<Editor>;

const STANDARD_VIEWS: readonly { readonly view: StandardView; readonly label: string }[] = [
  { view: 'top', label: 'Top' },
  { view: 'bottom', label: 'Bottom' },
  { view: 'front', label: 'Front' },
  { view: 'back', label: 'Back' },
  { view: 'left', label: 'Left' },
  { view: 'right', label: 'Right' },
  { view: 'iso', label: 'Iso' },
];

const hasSelection = (editor: Editor): boolean => !editor.session.selection.isEmpty;
const hasSelectedInstances = (editor: Editor): boolean => editor.session.selection.count('instance') > 0;

function toolCommand(
  id: string,
  label: string,
  shortcut: string | null,
  aliases: readonly string[],
  category: CommandCategory = 'Tools',
): EditorCommand {
  return {
    id,
    label,
    category,
    ...(shortcut ? { defaultShortcuts: [shortcut] } : {}),
    aliases,
    isChecked: (editor) => editor.tools.activeToolId === id,
    run: (editor) => {
      editor.activateTool(id);
    },
  };
}

export function registerDefaultCommands(registry: CommandRegistry<Editor>): void {
  registry.register(
    { id: 'file.new', label: 'New', category: 'File', run: (editor) => editor.newDocument() },
    {
      id: 'file.open',
      label: 'Open…',
      category: 'File',
      defaultShortcuts: ['Mod+O'],
      isEnabled: (editor) => editor.hasFileAccess,
      run: (editor) => editor.openFile(),
    },
    {
      id: 'file.save',
      label: 'Save',
      category: 'File',
      defaultShortcuts: ['Mod+S'],
      isEnabled: (editor) => editor.hasFileAccess,
      run: (editor) => editor.saveFile(),
    },
    {
      id: 'file.saveAs',
      label: 'Save As…',
      category: 'File',
      defaultShortcuts: ['Mod+Shift+S'],
      isEnabled: (editor) => editor.hasFileAccess,
      run: (editor) => editor.saveFileAs(),
    },
    {
      id: 'file.openSample',
      label: 'Open Sample Model',
      category: 'File',
      description: 'A small house for trying out navigation and selection',
      aliases: ['example', 'demo'],
      run: (editor) => editor.openSample(),
    },
    {
      id: 'edit.undo',
      label: 'Undo',
      category: 'Edit',
      defaultShortcuts: ['Mod+Z'],
      isEnabled: (editor) => editor.session.doc.canUndo,
      run: (editor) => {
        editor.undo();
      },
    },
    {
      id: 'edit.redo',
      label: 'Redo',
      category: 'Edit',
      defaultShortcuts: ['Mod+Shift+Z', 'Mod+Y'],
      isEnabled: (editor) => editor.session.doc.canRedo,
      run: (editor) => {
        editor.redo();
      },
    },
    {
      id: 'edit.selectAll',
      label: 'Select All',
      category: 'Edit',
      defaultShortcuts: ['Mod+A'],
      run: (editor) => {
        editor.selectAll();
      },
    },
    {
      id: 'edit.selectNone',
      label: 'Select None',
      category: 'Edit',
      defaultShortcuts: ['Mod+Shift+A'],
      aliases: ['deselect'],
      isEnabled: hasSelection,
      run: (editor) => {
        editor.clearSelection();
      },
    },
    {
      id: 'edit.delete',
      label: 'Delete',
      category: 'Edit',
      defaultShortcuts: ['Delete', 'Backspace'],
      aliases: ['erase', 'remove'],
      isEnabled: hasSelection,
      run: (editor) => {
        editor.deleteSelection();
      },
    },
    {
      id: 'edit.makeGroup',
      label: 'Make Group',
      category: 'Edit',
      defaultShortcuts: ['Mod+G'],
      aliases: ['group', 'combine'],
      isEnabled: hasSelection,
      run: (editor) => {
        editor.groupSelection('group');
      },
    },
    {
      id: 'edit.makeComponent',
      label: 'Make Component',
      category: 'Edit',
      defaultShortcuts: ['G'],
      aliases: ['component', 'block', 'reuse'],
      isEnabled: hasSelection,
      run: (editor) => {
        editor.groupSelection('component');
      },
    },
    {
      id: 'edit.explode',
      label: 'Explode',
      category: 'Edit',
      aliases: ['ungroup', 'break apart'],
      isEnabled: hasSelectedInstances,
      run: (editor) => {
        editor.explodeSelection();
      },
    },
    {
      id: 'edit.openGroup',
      label: 'Edit Group',
      category: 'Edit',
      description: 'Open the selected group or component to change what is inside it',
      aliases: ['enter group', 'open component'],
      isEnabled: (editor) => editor.session.selection.size === 1 && hasSelectedInstances(editor),
      run: (editor) => {
        const [instance] = editor.session.selection.ids('instance');
        if (instance !== undefined) editor.openGroup(instance as InstanceId);
      },
    },
    {
      id: 'edit.closeGroup',
      label: 'Close Group',
      category: 'Edit',
      aliases: ['exit group', 'close component'],
      isEnabled: (editor) => editor.session.editPath.length > 0,
      run: (editor) => {
        editor.closeGroup();
      },
    },
    {
      id: 'camera.zoomExtents',
      label: 'Zoom Extents',
      category: 'Camera',
      defaultShortcuts: ['Shift+Z'],
      aliases: ['fit', 'frame all'],
      run: (editor) => {
        editor.zoomExtents();
      },
    },
    ...STANDARD_VIEWS.map(({ view, label }): EditorCommand => ({
      id: `camera.view.${view}`,
      label: `${label} View`,
      category: 'Camera',
      aliases: ['standard view'],
      run: (editor) => {
        editor.setStandardView(view);
      },
    })),
    {
      id: 'camera.perspective',
      label: 'Perspective',
      category: 'Camera',
      isChecked: (editor) => editor.session.camera.projection === 'perspective',
      run: (editor) => {
        editor.setProjection('perspective');
      },
    },
    {
      id: 'camera.parallel',
      label: 'Parallel Projection',
      category: 'Camera',
      aliases: ['orthographic'],
      isChecked: (editor) => editor.session.camera.projection === 'parallel',
      run: (editor) => {
        editor.setProjection('parallel');
      },
    },
    toolCommand(SELECT_TOOL_ID, 'Select', 'Space', ['pick', 'arrow']),
    toolCommand(ERASER_TOOL_ID, 'Eraser', 'E', ['delete edges', 'hide edges', 'soften']),
    toolCommand(LINE_TOOL_ID, 'Line', 'L', ['pencil', 'edge', 'draw'], 'Draw'),
    toolCommand(RECTANGLE_TOOL_ID, 'Rectangle', 'R', ['square', 'box'], 'Draw'),
    toolCommand(CIRCLE_TOOL_ID, 'Circle', 'C', ['round', 'disc'], 'Draw'),
    toolCommand(POLYGON_TOOL_ID, 'Polygon', null, ['hexagon', 'regular polygon'], 'Draw'),
    toolCommand(PUSH_PULL_TOOL_ID, 'Push/Pull', 'P', ['extrude', 'raise', 'thicken']),
    toolCommand(MOVE_TOOL_ID, 'Move', 'M', ['translate', 'copy', 'array', 'stretch']),
    toolCommand(TAPE_MEASURE_TOOL_ID, 'Tape Measure', 'T', ['measure', 'distance', 'guide']),
    toolCommand(ORBIT_TOOL_ID, 'Orbit', 'O', ['rotate view', 'turn']),
    toolCommand(PAN_TOOL_ID, 'Pan', 'H', ['hand', 'scroll view']),
    toolCommand(ZOOM_TOOL_ID, 'Zoom', 'Z', ['magnify']),
    {
      id: 'help.commandPalette',
      label: 'Search Commands…',
      category: 'Help',
      defaultShortcuts: ['Shift+S'],
      aliases: ['find', 'search', 'command palette'],
      run: (editor) => {
        editor.requestUi('command-palette');
      },
    },
  );
}
