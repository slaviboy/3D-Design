import type { InstanceId } from '../../kernel/ids';
import { setModelAxes } from '../../kernel/model/mutations';
import { DEFAULT_MODEL_AXES } from '../../kernel/model/types';
import { AXES_TOOL_ID } from '../tools/AxesTool';
import { OFFSET_TOOL_ID } from '../tools/OffsetTool';
import { DIMENSION_TOOL_ID } from '../tools/DimensionTool';
import { TEXT_TOOL_ID } from '../tools/TextTool';
import { SECTION_PLANE_TOOL_ID } from '../tools/SectionPlaneTool';
import { PAINT_TOOL_ID } from '../tools/PaintBucketTool';
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
import { registerSolidCommands } from '../solids/solidCommands';
import { registerExchangeCommands } from '../io/exchangeCommands';
import type { CommandCategory, CommandDefinition, CommandRegistry } from './CommandRegistry';
import { registerWorkspaceCommands } from './workspaceCommands';

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
      id: 'file.startScreen',
      label: 'Start Screen…',
      category: 'File',
      description: 'Start a new model from a template, or open a recent file',
      aliases: ['welcome', 'new from template', 'templates', 'recent files'],
      run: (editor) => {
        editor.requestUi('start');
      },
    },
    {
      id: 'file.backups',
      label: 'Restore Backup…',
      category: 'File',
      description: 'Open a previous version of a file, kept each time you saved over it',
      aliases: ['backup', 'previous version', 'history'],
      isEnabled: (editor) => editor.hasBackups,
      run: (editor) => {
        editor.requestUi('backups');
      },
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
    toolCommand(PAINT_TOOL_ID, 'Paint Bucket', 'B', ['paint', 'material', 'color', 'texture', 'sample']),
    {
      id: 'materials.purgeUnused',
      label: 'Purge Unused Materials',
      category: 'Edit',
      aliases: ['clean up materials', 'remove unused materials', 'textures'],
      run: (editor) => {
        editor.purgeUnusedMaterials();
      },
    },
    {
      id: 'materials.paintSelection',
      label: 'Paint Selection',
      category: 'Edit',
      description: 'Apply the active material to the selected faces, groups and components',
      aliases: ['apply material', 'paint'],
      isEnabled: hasSelection,
      run: (editor) => {
        editor.paintSelection();
      },
    },
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
      id: 'app.preferences',
      label: 'Preferences…',
      category: 'Window',
      description: 'Theme, interface size, units, mouse wheel and autosave',
      aliases: ['settings', 'options', 'units', 'dark mode', 'theme'],
      defaultShortcuts: ['Mod+,'],
      run: (editor) => {
        editor.requestUi('preferences');
      },
    },
    {
      id: 'help.keyboardShortcuts',
      label: 'Keyboard Shortcuts…',
      category: 'Help',
      description: 'See, change, reset, import and export keyboard shortcuts',
      aliases: ['keys', 'hotkeys', 'bindings', 'customize shortcuts'],
      run: (editor) => {
        editor.requestUi('shortcuts');
      },
    },
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
  registerSolidCommands(registry);
  registerOrganizationCommands(registry);
  registerExchangeCommands(registry);
  registerPresentationCommands(registry);
  registerWorkspaceCommands(registry);
}

/** Section planes, shadows, scenes and animation. */
function registerPresentationCommands(registry: CommandRegistry<Editor>): void {
  const hasSectionPlane = (editor: Editor): boolean => editor.selectedSectionPlane() !== null;
  registry.register(
    toolCommand(SECTION_PLANE_TOOL_ID, 'Section Plane', null, ['section', 'cut', 'slice', 'clipping plane']),
    {
      id: 'section.toggleActive',
      label: 'Active Cut',
      category: 'Tools',
      description: 'Turn the selected section plane’s cut on or off',
      aliases: ['activate section', 'deactivate section', 'section cut'],
      isEnabled: hasSectionPlane,
      isChecked: (editor) => editor.selectedSectionPlane()?.active === true,
      run: (editor) => {
        editor.toggleSectionPlaneActive();
      },
    },
    {
      id: 'section.reverse',
      label: 'Reverse Section Plane',
      category: 'Tools',
      description: 'Cut away the other side of the selected section plane',
      aliases: ['flip section', 'reverse cut'],
      isEnabled: hasSectionPlane,
      run: (editor) => {
        editor.reverseSectionPlane();
      },
    },
    {
      id: 'section.createGroupFromSlice',
      label: 'Create Group from Slice',
      category: 'Tools',
      description: 'Make a group of the edges where the selected section plane cuts the geometry',
      aliases: ['slice', 'section outline', 'cut edges'],
      isEnabled: hasSectionPlane,
      run: (editor) => {
        editor.createGroupFromSlice();
      },
    },
    {
      id: 'view.sectionPlanes',
      label: 'Section Planes',
      category: 'View',
      description: 'Show or hide section plane rectangles',
      aliases: ['show section planes', 'hide section planes'],
      isChecked: (editor) => editor.session.showSectionPlanes,
      run: (editor) => {
        editor.setSectionDisplay({ planes: !editor.session.showSectionPlanes });
      },
    },
    {
      id: 'view.sectionCuts',
      label: 'Section Cuts',
      category: 'View',
      description: 'Turn clipping at active section planes on or off',
      aliases: ['show section cuts', 'hide section cuts', 'section fill'],
      isChecked: (editor) => editor.session.showSectionCuts,
      run: (editor) => {
        editor.setSectionDisplay({ cuts: !editor.session.showSectionCuts });
      },
    },
    {
      id: 'view.shadows',
      label: 'Shadows',
      category: 'View',
      description: 'Cast shadows from the sun',
      aliases: ['sun', 'shade', 'toggle shadows'],
      isChecked: (editor) => editor.shadowSettings.enabled,
      run: (editor) => {
        editor.updateShadowSettings({ enabled: !editor.shadowSettings.enabled });
      },
    },
    {
      id: 'scene.add',
      label: 'Add Scene',
      category: 'View',
      description: 'Save the current view as a scene',
      aliases: ['new scene', 'save view', 'page'],
      run: (editor) => {
        editor.addScene();
      },
    },
    {
      id: 'scene.update',
      label: 'Update Scene',
      category: 'View',
      description: 'Save the current view into the active scene',
      aliases: ['save scene', 'overwrite scene'],
      isEnabled: (editor) => editor.activeSceneId !== null,
      run: (editor) => {
        editor.updateSceneFromView();
      },
    },
    {
      id: 'scene.remove',
      label: 'Delete Scene',
      category: 'View',
      aliases: ['remove scene'],
      isEnabled: (editor) => editor.activeSceneId !== null,
      run: (editor) => {
        editor.removeScene();
      },
    },
    {
      id: 'scene.previous',
      label: 'Previous Scene',
      category: 'View',
      isEnabled: (editor) => editor.session.doc.scenes.length > 0,
      run: (editor) => {
        editor.applyAdjacentScene(-1);
      },
    },
    {
      id: 'scene.next',
      label: 'Next Scene',
      category: 'View',
      isEnabled: (editor) => editor.session.doc.scenes.length > 0,
      run: (editor) => {
        editor.applyAdjacentScene(1);
      },
    },
    {
      id: 'view.animation.play',
      label: 'Play Animation',
      category: 'View',
      description: 'Show the scenes one after another; press Escape to stop',
      aliases: ['slideshow', 'presentation', 'animate scenes'],
      isEnabled: (editor) => editor.session.doc.scenes.some((scene) => scene.includeInAnimation),
      isChecked: (editor) => editor.isAnimationPlaying,
      run: (editor) => {
        editor.playAnimation();
      },
    },
    {
      id: 'view.animation.stop',
      label: 'Stop Animation',
      category: 'View',
      isEnabled: (editor) => editor.isAnimationPlaying,
      run: (editor) => {
        editor.stopAnimation();
      },
    },
  );
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
