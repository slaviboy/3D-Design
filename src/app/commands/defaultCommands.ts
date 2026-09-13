import type { InstanceId } from '../../kernel/ids';
import { setModelAxes } from '../../kernel/model/mutations';
import { DEFAULT_MODEL_AXES } from '../../kernel/model/types';
import { AXES_TOOL_ID } from '../tools/AxesTool';
import { OFFSET_TOOL_ID } from '../tools/OffsetTool';
import { DIMENSION_TOOL_ID } from '../tools/DimensionTool';
import { TEXT_TOOL_ID } from '../tools/TextTool';
import type { StandardView } from '../camera/camera';
import type { Editor } from '../Editor';
import { PANELS } from '../panels/panels';
import { PLACE_COMPONENT_TOOL_ID } from '../tools/ComponentPlacementTool';
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
import { ARC_TOOL_ID, PIE_TOOL_ID, THREE_POINT_ARC_TOOL_ID, TWO_POINT_ARC_TOOL_ID } from '../tools/ArcTool';
import { FREEHAND_TOOL_ID } from '../tools/FreehandTool';
import { PROTRACTOR_TOOL_ID } from '../tools/ProtractorTool';
import { ROTATED_RECTANGLE_TOOL_ID } from '../tools/RotatedRectangleTool';
import { ROTATE_TOOL_ID } from '../tools/RotateTool';
import { SCALE_TOOL_ID } from '../tools/ScaleTool';
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
    toolCommand(ROTATE_TOOL_ID, 'Rotate', 'Q', ['turn', 'spin', 'radial array']),
    toolCommand(SCALE_TOOL_ID, 'Scale', 'S', ['resize', 'stretch', 'mirror', 'enlarge']),
    toolCommand(PROTRACTOR_TOOL_ID, 'Protractor', null, ['angle', 'angled guide']),
    toolCommand(AXES_TOOL_ID, 'Axes', null, ['move axes', 'origin', 'drawing axes']),
    toolCommand(OFFSET_TOOL_ID, 'Offset', 'F', ['inset', 'outline', 'parallel copy', 'wall thickness']),
    toolCommand(DIMENSION_TOOL_ID, 'Dimension', null, ['measure', 'dimension', 'length label']),
    toolCommand(TEXT_TOOL_ID, 'Text', null, ['label', 'leader', 'note', 'annotation']),
    {
      id: 'edit.divide',
      label: 'Divide…',
      category: 'Edit',
      description: 'Split the selected edge into equal parts',
      aliases: ['split edge', 'segments'],
      isEnabled: (editor) =>
        editor.session.selection.count('edge') === 1 && editor.session.selection.size === 1,
      run: (editor) => {
        editor.divideSelection();
      },
    },
    {
      id: 'edit.weld',
      label: 'Weld Edges',
      category: 'Edit',
      description: 'Join the selected connected edges into one curve',
      aliases: ['join edges', 'polyline', 'combine curve'],
      isEnabled: (editor) => editor.session.selection.count('edge') >= 2,
      run: (editor) => {
        editor.weldSelection();
      },
    },
    {
      id: 'edit.explodeCurve',
      label: 'Explode Curve',
      category: 'Edit',
      description: 'Turn the curves of the selected edges back into separate edges',
      aliases: ['unweld', 'split curve'],
      isEnabled: (editor) => editor.session.selection.count('edge') > 0,
      run: (editor) => {
        if (editor.explodeCurvesInSelection() === 0)
          editor.notify('info', 'None of the selected edges belong to a curve');
      },
    },
    {
      id: 'axes.reset',
      label: 'Reset Axes',
      category: 'Tools',
      aliases: ['default axes', 'world axes'],
      isEnabled: (editor) => {
        const { origin, xAxis, yAxis } = editor.session.doc.axes;
        const same = (a: typeof origin, b: typeof origin) => a.x === b.x && a.y === b.y && a.z === b.z;
        return !(
          same(origin, DEFAULT_MODEL_AXES.origin) &&
          same(xAxis, DEFAULT_MODEL_AXES.xAxis) &&
          same(yAxis, DEFAULT_MODEL_AXES.yAxis)
        );
      },
      run: (editor) => {
        const doc = editor.session.doc;
        doc.transact('Reset Axes', () => {
          setModelAxes(doc, DEFAULT_MODEL_AXES);
        });
      },
    },
    toolCommand(ARC_TOOL_ID, 'Arc', null, ['center arc', 'curve'], 'Draw'),
    toolCommand(TWO_POINT_ARC_TOOL_ID, '2-Point Arc', 'A', ['arc', 'bulge', 'fillet', 'curve'], 'Draw'),
    toolCommand(THREE_POINT_ARC_TOOL_ID, '3-Point Arc', null, ['arc through points', 'curve'], 'Draw'),
    toolCommand(PIE_TOOL_ID, 'Pie', null, ['wedge', 'sector'], 'Draw'),
    toolCommand(FREEHAND_TOOL_ID, 'Freehand', null, ['sketch', 'pen', 'polyline'], 'Draw'),
    toolCommand(
      ROTATED_RECTANGLE_TOOL_ID,
      'Rotated Rectangle',
      null,
      ['angled rectangle', 'tilted box'],
      'Draw',
    ),
    ...(['x', 'y', 'z'] as const).map((axis): EditorCommand => ({
      id: `edit.flip${axis.toUpperCase()}`,
      label: `Flip Along ${{ x: 'Red', y: 'Green', z: 'Blue' }[axis]} Direction`,
      category: 'Edit',
      aliases: ['mirror', 'flip'],
      isEnabled: hasSelection,
      run: (editor) => {
        editor.flipSelection(axis);
      },
    })),
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
  registerOrganizationCommands(registry);
}

/** Tags, components, locking and dock panels. */
function registerOrganizationCommands(registry: CommandRegistry<Editor>): void {
  registry.register(
    {
      id: 'edit.makeUnique',
      label: 'Make Unique',
      category: 'Edit',
      description: 'Give the selected component its own definition, so later edits change only this instance',
      aliases: ['unique', 'separate instance', 'detach component'],
      isEnabled: (editor) => editor.selectedComponentInstance() !== null,
      run: (editor) => {
        editor.makeUniqueSelection();
      },
    },
    {
      id: 'edit.lock',
      label: 'Lock',
      category: 'Edit',
      description: 'Protect the selected groups and components from changes',
      aliases: ['protect', 'freeze'],
      isEnabled: hasSelectedInstances,
      run: (editor) => {
        editor.updateSelectionAttributes({ locked: true });
      },
    },
    {
      id: 'edit.unlock',
      label: 'Unlock',
      category: 'Edit',
      aliases: ['unprotect', 'unfreeze'],
      isEnabled: hasSelectedInstances,
      run: (editor) => {
        editor.updateSelectionAttributes({ locked: false });
      },
    },
    {
      id: 'tags.add',
      label: 'Add Tag',
      category: 'View',
      aliases: ['new tag', 'layer', 'new layer'],
      run: (editor) => {
        editor.addTag();
      },
    },
    {
      id: 'tags.purgeUnused',
      label: 'Purge Unused Tags',
      category: 'View',
      aliases: ['clean up tags', 'remove unused layers'],
      run: (editor) => {
        editor.purgeUnusedTags();
      },
    },
    {
      id: 'components.purgeUnused',
      label: 'Purge Unused Components',
      category: 'Edit',
      aliases: ['clean up components', 'remove unused definitions'],
      run: (editor) => {
        editor.purgeUnusedComponents();
      },
    },
    {
      id: PLACE_COMPONENT_TOOL_ID,
      label: 'Place Component',
      category: 'Tools',
      description: 'Place another instance of a component; choose which one in the Components panel',
      aliases: ['insert component', 'place instance'],
      isEnabled: (editor) => editor.componentDefinitions().length > 0,
      isChecked: (editor) => editor.tools.activeToolId === PLACE_COMPONENT_TOOL_ID,
      run: (editor) => {
        const definitionId = editor.placementDefinition ?? editor.componentDefinitions()[0]?.id;
        if (definitionId !== undefined) editor.placeComponent(definitionId);
      },
    },
    ...PANELS.map(({ id, label, aliases }): EditorCommand => ({
      id: `window.${id}`,
      label,
      category: 'Window',
      description: `Show or hide the ${label} panel`,
      aliases: ['panel', ...aliases],
      isChecked: (editor) => editor.isPanelOpen(id),
      run: (editor) => {
        editor.togglePanel(id);
      },
    })),
  );
}
