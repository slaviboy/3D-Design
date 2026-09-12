import type { StandardView } from '../camera/camera';
import type { Editor } from '../Editor';
import { ORBIT_TOOL_ID, PAN_TOOL_ID, SELECT_TOOL_ID, ZOOM_TOOL_ID } from '../tools/Tool';
import type { CommandDefinition, CommandRegistry } from './CommandRegistry';

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

function toolCommand(id: string, label: string, shortcut: string, aliases: readonly string[]): EditorCommand {
  return {
    id,
    label,
    category: 'Tools',
    defaultShortcuts: [shortcut],
    aliases,
    isChecked: (editor) => editor.tools.activeToolId === id,
    run: (editor) => {
      editor.tools.activate(id);
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
