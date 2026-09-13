import type { DefinitionId, EdgeId, FaceId, InstanceId, TagId } from '../kernel/ids';
import { ModelDocument } from '../kernel/model/ModelDocument';
import {
  addTag as addTagMutation,
  setDefinitionAttributes,
  setEdgeAttributes,
  setFaceAttributes,
  setInstanceAttributes,
  setTagAttributes,
} from '../kernel/model/mutations';
import type { EdgeAttributes, InstanceAttributes, Rgb } from '../kernel/model/types';
import { deleteFaces, eraseEdges } from '../kernel/ops/erase';
import {
  deleteInstances,
  explodeInstance,
  makeComponent,
  makeGroup,
  makeUnique,
  purgeUnusedDefinitions,
} from '../kernel/ops/hierarchy';
import { deleteTag as deleteTagOp, purgeUnusedTags as purgeUnusedTagsOp } from '../kernel/ops/tags';
import { transformEntities } from '../kernel/ops/transform';
import { vec3 } from '../kernel/math/vec3';
import { METRIC_UNIT_SETTINGS, type UnitSettings } from '../kernel/units/units';
import { parseMeasurement } from '../kernel/vcb/parseMeasurement';
import { decodePlanarFile, encodePlanarFile, PLANAR_FILE_EXTENSION } from '../io/format/planarFile';
import type { FileAccess } from '../io/fs/types';
import {
  DEFAULT_CAMERA,
  orbit,
  pan,
  pointOnTargetPlane,
  setProjection,
  standardView,
  zoom,
  zoomToBounds,
  type Projection,
  type ScreenPoint,
  type StandardView,
  type ViewportSize,
} from './camera/camera';
import { CommandRegistry } from './commands/CommandRegistry';
import { registerDefaultCommands } from './commands/defaultCommands';
import { listComponentDefinitions, type ComponentRow } from './components/componentList';
import { definitionBounds } from './geometry/bounds';
import { PANEL_IDS, type PanelId } from './panels/panels';
import { hasLockedInstance, isInstanceLocked, LOCKED_MESSAGE } from './selection/locking';
import { nextTagColor, uniqueTagName } from './tags/tags';
import { ComponentPlacementTool, PLACE_COMPONENT_TOOL_ID } from './tools/ComponentPlacementTool';
import { pick, type PickHit, type PickRequest } from './picking/picker';
import { createSampleModel, SAMPLE_MODEL_NAME } from './sample/sampleModel';
import { boxSelect, type BoxSelectMode, type ScreenRect } from './selection/boxSelect';
import { allSelectableRefs } from './selection/queries';
import { Selection, type EntityRef } from './selection/Selection';
import { EditorSession, UNTITLED_DOCUMENT_NAME } from './session/EditorSession';
import { chordFromKeyboard, ShortcutMap, type KeyChordInput, type Platform } from './shortcuts/shortcuts';
import { ArcTool } from './tools/ArcTool';
import { AxesTool } from './tools/AxesTool';
import { CircleTool } from './tools/CircleTool';
import { EraserTool } from './tools/EraserTool';
import { FreehandTool } from './tools/FreehandTool';
import { LineTool } from './tools/LineTool';
import { MoveTool } from './tools/MoveTool';
import { createOrbitTool, createPanTool, createZoomTool } from './tools/NavigationTools';
import { ProtractorTool } from './tools/ProtractorTool';
import { PushPullTool } from './tools/PushPullTool';
import { RectangleTool } from './tools/RectangleTool';
import { RotatedRectangleTool } from './tools/RotatedRectangleTool';
import { RotateTool } from './tools/RotateTool';
import { ScaleTool } from './tools/ScaleTool';
import { SelectTool } from './tools/SelectTool';
import { TapeMeasureTool } from './tools/TapeMeasureTool';
import { SELECT_TOOL_ID } from './tools/Tool';
import { ToolManager } from './tools/ToolManager';
import { refsOfResult, scalingAbout, selectionBounds, transformSelectionOf } from './tools/transformSupport';

/** Characters that start typing into the measurements box. Once typing has started, any character continues it. */
const MEASUREMENT_START = /^[0-9.,\-[</]$/;

const FLIP_AXIS_NAMES = { x: 'Red', y: 'Green', z: 'Blue' } as const;

/** Orbit speed for mouse drags. */
export const ORBIT_RADIANS_PER_PIXEL = 0.008;

export type NotificationKind = 'info' | 'error';

export interface EditorNotification {
  readonly id: number;
  readonly kind: NotificationKind;
  readonly message: string;
}

/** Requests for the UI layer to show something (the editor never touches the DOM). */
export type UiRequest = 'command-palette';

export type EditorEvent =
  | { readonly kind: 'notifications' }
  | { readonly kind: 'measurement' }
  | { readonly kind: 'ui-request'; readonly request: UiRequest }
  | { readonly kind: 'panels' };

/** Attributes Entity Info and commands can change on the selection. Each applies to the kinds that have it. */
export interface SelectionAttributePatch {
  /** Instances, faces and edges. */
  readonly tagId?: TagId | null;
  /** Instances, faces and edges. */
  readonly hidden?: boolean;
  /** Instances. */
  readonly locked?: boolean;
  /** Edges. */
  readonly soft?: boolean;
  /** Edges. */
  readonly smooth?: boolean;
}

export type InstanceAttributePatch = Partial<
  Pick<InstanceAttributes, 'name' | 'tagId' | 'hidden' | 'locked'>
>;

/** History label for an attribute change. */
function attributeLabel(patch: SelectionAttributePatch & { readonly name?: string }): string {
  if (patch.name !== undefined) return 'Rename';
  if (patch.tagId !== undefined) return 'Assign Tag';
  if (patch.locked !== undefined) return patch.locked ? 'Lock' : 'Unlock';
  if (patch.hidden !== undefined) return patch.hidden ? 'Hide' : 'Unhide';
  if (patch.soft !== undefined) return patch.soft ? 'Soften' : 'Unsoften';
  if (patch.smooth !== undefined) return patch.smooth ? 'Smooth' : 'Unsmooth';
  return 'Change Attributes';
}

const countOf = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

export interface EditorEnvironment {
  readonly platform: Platform;
  readonly appVersion: string;
  readonly fileAccess?: FileAccess;
  /** Asks the user whether unsaved changes may be discarded. Without it, changes are discarded silently. */
  readonly confirmDiscardChanges?: (documentName: string) => Promise<boolean>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withoutExtension(name: string): string {
  return name.toLowerCase().endsWith(PLANAR_FILE_EXTENSION)
    ? name.slice(0, -PLANAR_FILE_EXTENSION.length)
    : name;
}

/**
 * Composition root of the application layer: one editing session plus commands, shortcuts and tools.
 * It has no DOM or three.js dependencies; the UI and renderer attach to it.
 */
export class Editor {
  readonly platform: Platform;
  readonly appVersion: string;
  readonly session = new EditorSession();
  readonly commands = new CommandRegistry<Editor>();
  readonly shortcuts: ShortcutMap;
  readonly tools: ToolManager;
  readonly units: UnitSettings = METRIC_UNIT_SETTINGS;

  readonly #environment: EditorEnvironment;
  readonly #listeners = new Set<(event: EditorEvent) => void>();
  #viewportSize: ViewportSize = { width: 1, height: 1 };
  #notifications: readonly EditorNotification[] = [];
  #nextNotificationId = 1;
  #measurementText = '';
  readonly #placementTool = new ComponentPlacementTool();
  #openPanels: readonly PanelId[] = PANEL_IDS;

  constructor(environment: EditorEnvironment) {
    this.#environment = environment;
    this.platform = environment.platform;
    this.appVersion = environment.appVersion;
    registerDefaultCommands(this.commands);
    this.shortcuts = ShortcutMap.fromCommands(this.commands.all());
    this.tools = new ToolManager(
      this,
      [
        new SelectTool(),
        createOrbitTool(),
        createPanTool(),
        createZoomTool(),
        new LineTool(),
        new RectangleTool(),
        new CircleTool('circle'),
        new CircleTool('polygon'),
        new EraserTool(),
        new TapeMeasureTool(),
        new PushPullTool(),
        new MoveTool(),
        new RotateTool(),
        new ScaleTool(),
        new ArcTool('center'),
        new ArcTool('two-point'),
        new ArcTool('three-point'),
        new ArcTool('pie'),
        new FreehandTool(),
        new RotatedRectangleTool(),
        new ProtractorTool(),
        new AxesTool(),
        this.#placementTool,
      ],
      SELECT_TOOL_ID,
    );
  }

  activateTool(toolId: string): void {
    this.setMeasurementText('');
    this.tools.activate(toolId);
  }

  // ---------------------------------------------------------------------------------------------- measurements box

  /** What the user has typed into the measurements box and not yet entered. */
  get measurementText(): string {
    return this.#measurementText;
  }

  setMeasurementText(text: string): void {
    if (text === this.#measurementText) return;
    this.#measurementText = text;
    this.#emit({ kind: 'measurement' });
  }

  /** Parses typed text for the active tool and applies it. Returns false (and notifies) when it can't be used. */
  submitMeasurement(text: string = this.#measurementText): boolean {
    this.setMeasurementText('');
    const tool = this.tools.activeTool;
    const field = this.tools.measurement;
    if (!field || !tool.onMeasurement || text.trim() === '') return false;
    const parsed = parseMeasurement(text, field.accepts, this.units);
    if (!parsed.ok) {
      this.notify('error', parsed.error);
      return false;
    }
    try {
      tool.onMeasurement(parsed.value, this);
      return true;
    } catch (error) {
      this.notify('error', errorMessage(error));
      return false;
    } finally {
      this.tools.refresh();
    }
  }

  /** Typing goes to the measurements box while the active tool has one, as in the reference workflow. */
  #handleMeasurementKey(input: KeyChordInput): boolean {
    if (input.ctrlKey || input.metaKey || input.altKey || !this.tools.measurement) return false;
    const text = this.#measurementText;
    if (text !== '') {
      if (input.key === 'Enter') {
        this.submitMeasurement();
        return true;
      }
      if (input.key === 'Backspace') {
        this.setMeasurementText(text.slice(0, -1));
        return true;
      }
      if (input.key === 'Escape') {
        this.setMeasurementText('');
        return true;
      }
    }
    if (input.key.length === 1 && (text !== '' || MEASUREMENT_START.test(input.key))) {
      this.setMeasurementText(text + input.key);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------------------------- events

  subscribe(listener: (event: EditorEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  get notifications(): readonly EditorNotification[] {
    return this.#notifications;
  }

  notify(kind: NotificationKind, message: string): void {
    this.#notifications = [...this.#notifications, { id: this.#nextNotificationId++, kind, message }];
    this.#emit({ kind: 'notifications' });
  }

  dismissNotification(id: number): void {
    this.#notifications = this.#notifications.filter((notification) => notification.id !== id);
    this.#emit({ kind: 'notifications' });
  }

  requestUi(request: UiRequest): void {
    this.#emit({ kind: 'ui-request', request });
  }

  // ---------------------------------------------------------------------------------------------- commands & keys

  /** Runs a command by id. Failures become error notifications instead of uncaught exceptions. */
  async runCommand(commandId: string): Promise<void> {
    try {
      await this.commands.execute(commandId, this);
    } catch (error) {
      this.notify('error', errorMessage(error));
    }
  }

  /** Handles a key press: the active tool sees it first, then the shortcut map. Returns true when consumed. */
  handleKey(input: KeyChordInput): boolean {
    if (this.#handleMeasurementKey(input)) return true;
    const chord = chordFromKeyboard(input, this.platform);
    if (!chord) return false;
    if (this.tools.keyDown(chord)) return true;
    const commandId = this.shortcuts.commandFor(chord);
    if (!commandId) return false;
    void this.runCommand(commandId);
    return true;
  }

  // ---------------------------------------------------------------------------------------------- viewport

  get viewportSize(): ViewportSize {
    return this.#viewportSize;
  }

  setViewportSize(size: ViewportSize): void {
    this.#viewportSize = { width: Math.max(1, size.width), height: Math.max(1, size.height) };
  }

  pickAt(
    screen: ScreenPoint,
    options: Pick<PickRequest, 'edgeTolerancePx' | 'includeSoftEdges'> = {},
  ): PickHit | null {
    const { session } = this;
    return pick(session.doc, session.activeContext, session.activeContextTransform, {
      camera: session.camera,
      size: this.#viewportSize,
      screen: { x: screen.x, y: screen.y },
      ...options,
    });
  }

  boxSelectRefs(rect: ScreenRect, mode: BoxSelectMode): EntityRef[] {
    const { session } = this;
    return boxSelect(
      session.doc,
      session.activeContext,
      session.activeContextTransform,
      session.camera,
      this.#viewportSize,
      rect,
      mode,
    );
  }

  // ---------------------------------------------------------------------------------------------- camera

  orbitBy(dx: number, dy: number): void {
    this.session.setCamera(
      orbit(this.session.camera, -dx * ORBIT_RADIANS_PER_PIXEL, dy * ORBIT_RADIANS_PER_PIXEL),
    );
  }

  panBy(dx: number, dy: number): void {
    this.session.setCamera(pan(this.session.camera, dx, dy, this.#viewportSize));
  }

  /** Zooms toward the view center. */
  zoomBy(factor: number): void {
    this.session.setCamera(zoom(this.session.camera, factor, null));
  }

  /** Zooms toward the geometry under the cursor, or the point on the target plane when nothing is there. */
  zoomAtScreen(screen: ScreenPoint, factor: number): void {
    const focus =
      this.pickAt(screen)?.point ?? pointOnTargetPlane(this.session.camera, screen, this.#viewportSize);
    this.session.setCamera(zoom(this.session.camera, factor, focus));
  }

  zoomExtents(): void {
    const doc = this.session.doc;
    this.session.setCamera(
      zoomToBounds(this.session.camera, definitionBounds(doc, doc.rootDefinitionId), this.#viewportSize),
    );
  }

  setStandardView(view: StandardView): void {
    const doc = this.session.doc;
    this.session.setCamera(
      standardView(
        this.session.camera,
        view,
        definitionBounds(doc, doc.rootDefinitionId),
        this.#viewportSize,
      ),
    );
  }

  setProjection(projection: Projection): void {
    this.session.setCamera(setProjection(this.session.camera, projection));
  }

  // ---------------------------------------------------------------------------------------------- editing

  undo(): void {
    this.tools.cancel();
    this.session.doc.undo();
  }

  redo(): void {
    this.tools.cancel();
    this.session.doc.redo();
  }

  selectAll(): void {
    const { session } = this;
    session.setSelection(
      Selection.of(allSelectableRefs(session.doc.store(session.activeContext), session.doc)),
    );
  }

  clearSelection(): void {
    this.session.setSelection(Selection.EMPTY);
  }

  /** Deletes the selection: instances, faces (keeping their edges), and edges (healing coplanar faces). */
  deleteSelection(): void {
    const { session } = this;
    const selection = session.selection;
    if (selection.isEmpty) return;
    const doc = session.doc;
    const context = session.activeContext;
    if (hasLockedInstance(doc, context, selection.refs())) {
      this.notify('error', LOCKED_MESSAGE);
      return;
    }
    doc.transact('Delete', () => {
      deleteInstances(doc, context, selection.ids('instance') as InstanceId[]);
      deleteFaces(doc, context, selection.ids('face') as FaceId[]);
      eraseEdges(doc, context, selection.ids('edge') as EdgeId[]);
    });
    session.setSelection(Selection.EMPTY);
  }

  /** Mirrors the selection across the plane through its center, perpendicular to an axis of the open context. */
  flipSelection(axis: 'x' | 'y' | 'z'): void {
    const { session } = this;
    if (session.selection.isEmpty) return;
    this.tools.cancel();
    const selection = transformSelectionOf(session.selection);
    const box = selectionBounds(this, selection);
    if (!box) return;
    const center = vec3((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
    const factors = vec3(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1, axis === 'z' ? -1 : 1);
    const doc = session.doc;
    const result = doc.transact(`Flip Along ${FLIP_AXIS_NAMES[axis]}`, () =>
      transformEntities(doc, session.activeContext, selection, scalingAbout(center, factors)),
    );
    session.setSelection(Selection.of(refsOfResult(result)));
  }

  // ---------------------------------------------------------------------------------------------- groups & components

  /** Wraps the selection in a new group (or component) and selects it. */
  groupSelection(kind: 'group' | 'component'): void {
    const { session } = this;
    const selection = session.selection;
    if (selection.isEmpty) return;
    this.tools.cancel();
    const make = kind === 'group' ? makeGroup : makeComponent;
    const doc = session.doc;
    const context = session.activeContext;
    const tagId = session.activeTagId;
    const created = doc.transact(kind === 'group' ? 'Make Group' : 'Make Component', () => {
      const made = make(doc, context, {
        faces: selection.ids('face') as FaceId[],
        edges: selection.ids('edge') as EdgeId[],
        instances: selection.ids('instance') as InstanceId[],
      });
      // New groups and components go on the active tag.
      if (tagId !== null) setInstanceAttributes(doc, context, made.instance, { tagId });
      return made;
    });
    session.setSelection(Selection.of([{ kind: 'instance', id: created.instance }]));
  }

  /** Replaces the selected groups and components with their contents. */
  explodeSelection(): void {
    const { session } = this;
    const instances = session.selection.ids('instance') as InstanceId[];
    if (instances.length === 0) return;
    if (hasLockedInstance(session.doc, session.activeContext, session.selection.refs())) {
      this.notify('error', LOCKED_MESSAGE);
      return;
    }
    this.tools.cancel();
    const doc = session.doc;
    doc.transact('Explode', () => {
      for (const id of instances) explodeInstance(doc, session.activeContext, id);
    });
    session.setSelection(Selection.EMPTY);
  }

  /** Opens a group or component for editing; the rest of the model fades. */
  openGroup(instanceId: InstanceId): void {
    if (isInstanceLocked(this.session.doc, this.session.activeContext, instanceId)) {
      this.notify('error', LOCKED_MESSAGE);
      return;
    }
    this.tools.cancel();
    this.session.enterInstance(instanceId);
  }

  /** Closes the open group or component. Returns false when none is open. */
  closeGroup(): boolean {
    this.tools.cancel();
    return this.session.exitContext();
  }

  /** The selected instance when exactly one component instance (not a group) is selected. */
  selectedComponentInstance(): InstanceId | null {
    const { session } = this;
    const [id] = session.selection.ids('instance');
    if (id === undefined || session.selection.size !== 1) return null;
    const instance = session.doc.store(session.activeContext).instance(id as InstanceId);
    return instance && !session.doc.getDefinition(instance.definitionId).attributes.isGroup
      ? instance.id
      : null;
  }

  /** Gives the selected component instance its own copy of its definition. */
  makeUniqueSelection(): void {
    const id = this.selectedComponentInstance();
    if (id === null) return;
    this.tools.cancel();
    makeUnique(this.session.doc, this.session.activeContext, id);
  }

  // ---------------------------------------------------------------------------------------------- attributes

  /** Changes attributes of the selected entities in one undoable step. Attributes that don't apply are skipped. */
  updateSelectionAttributes(patch: SelectionAttributePatch): void {
    const { session } = this;
    const selection = session.selection;
    if (selection.isEmpty) return;
    const doc = session.doc;
    const context = session.activeContext;
    if (patch.tagId !== undefined && patch.tagId !== null && !doc.tag(patch.tagId)) {
      this.notify('error', 'That tag no longer exists');
      return;
    }
    const common = {
      ...(patch.tagId !== undefined ? { tagId: patch.tagId } : {}),
      ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
    };
    const instancePatch: Partial<InstanceAttributes> = {
      ...common,
      ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
    };
    const edgePatch: Partial<EdgeAttributes> = {
      ...common,
      ...(patch.soft !== undefined ? { soft: patch.soft } : {}),
      ...(patch.smooth !== undefined ? { smooth: patch.smooth } : {}),
    };
    doc.transact(attributeLabel(patch), () => {
      for (const id of selection.ids('instance')) {
        setInstanceAttributes(doc, context, id as InstanceId, instancePatch);
      }
      for (const id of selection.ids('face')) setFaceAttributes(doc, context, id as FaceId, common);
      for (const id of selection.ids('edge')) setEdgeAttributes(doc, context, id as EdgeId, edgePatch);
    });
  }

  /** The definition reached by opening `path` from the model root, or null when the path is no longer valid. */
  contextOfPath(path: readonly InstanceId[]): DefinitionId | null {
    const doc = this.session.doc;
    let context = doc.rootDefinitionId;
    for (const id of path) {
      const instance = doc.store(context).instance(id);
      if (!instance) return null;
      context = instance.definitionId;
    }
    return context;
  }

  /** Changes a group or component anywhere in the hierarchy (the Outliner's rename, eye and lock). */
  updateInstanceAt(
    parentPath: readonly InstanceId[],
    instanceId: InstanceId,
    patch: InstanceAttributePatch,
  ): void {
    const doc = this.session.doc;
    const context = this.contextOfPath(parentPath);
    if (context === null || !doc.store(context).instance(instanceId)) {
      this.notify('error', 'That group or component no longer exists');
      return;
    }
    const applied = patch.name === undefined ? patch : { ...patch, name: patch.name.trim() };
    doc.transact(attributeLabel(patch), () => {
      setInstanceAttributes(doc, context, instanceId, applied);
    });
  }

  /** Renames a component (or group) definition. Returns false when the name is empty. */
  renameDefinition(definitionId: DefinitionId, name: string): boolean {
    const doc = this.session.doc;
    const trimmed = name.trim();
    if (trimmed === '') {
      this.notify('error', 'A definition needs a name');
      return false;
    }
    if (definitionId === doc.rootDefinitionId || !doc.definition(definitionId)) return false;
    doc.transact('Rename Definition', () => {
      setDefinitionAttributes(doc, definitionId, { name: trimmed });
    });
    return true;
  }

  // ---------------------------------------------------------------------------------------------- outliner

  /**
   * Selects a group or component anywhere in the hierarchy, opening the instances that contain it first so the
   * selection is in the active context. A locked container can't be opened, so it is selected instead.
   * Returns false when the path no longer exists.
   */
  selectInstanceAtPath(parentPath: readonly InstanceId[], instanceId: InstanceId): boolean {
    const doc = this.session.doc;
    if (this.contextOfPath([...parentPath, instanceId]) === null) return false;
    let path: readonly InstanceId[] = parentPath;
    let target = instanceId;
    let context = doc.rootDefinitionId;
    for (const [index, id] of parentPath.entries()) {
      const instance = doc.store(context).getInstance(id);
      if (instance.attributes.locked) {
        path = parentPath.slice(0, index);
        target = id;
        break;
      }
      context = instance.definitionId;
    }
    this.tools.cancel();
    this.#setEditPath(path);
    this.session.setSelection(Selection.of([{ kind: 'instance', id: target }]));
    return true;
  }

  /** Opens a group or component anywhere in the hierarchy for editing. */
  openInstanceAtPath(parentPath: readonly InstanceId[], instanceId: InstanceId): void {
    if (!this.selectInstanceAtPath(parentPath, instanceId)) return;
    if (this.session.selection.has({ kind: 'instance', id: instanceId })) this.openGroup(instanceId);
    else this.notify('error', LOCKED_MESSAGE);
  }

  #setEditPath(path: readonly InstanceId[]): void {
    const { session } = this;
    let common = 0;
    while (
      common < path.length &&
      common < session.editPath.length &&
      session.editPath[common] === path[common]
    ) {
      common++;
    }
    while (session.editPath.length > common) session.exitContext();
    for (const id of path.slice(common)) session.enterInstance(id);
  }

  // ---------------------------------------------------------------------------------------------- tags

  /** Adds a visible tag with a fresh color. Without a name, it is called `Tag n`. */
  addTag(name?: string): TagId {
    const doc = this.session.doc;
    const trimmed = name?.trim() ?? '';
    return doc.transact('Add Tag', () =>
      addTagMutation(doc, {
        name: trimmed === '' ? uniqueTagName(doc) : trimmed,
        visible: true,
        color: nextTagColor(doc),
      }),
    );
  }

  /** Returns false (and notifies) when the name is empty. */
  renameTag(tagId: TagId, name: string): boolean {
    const trimmed = name.trim();
    if (trimmed === '') {
      this.notify('error', 'A tag needs a name');
      return false;
    }
    const doc = this.session.doc;
    doc.transact('Rename Tag', () => {
      setTagAttributes(doc, tagId, { name: trimmed });
    });
    return true;
  }

  /** Deletes a tag; everything on it becomes untagged. */
  deleteTag(tagId: TagId): void {
    this.tools.cancel();
    deleteTagOp(this.session.doc, tagId);
  }

  /** Deletes tags that nothing uses. Returns how many were deleted. */
  purgeUnusedTags(): number {
    this.tools.cancel();
    const removed = purgeUnusedTagsOp(this.session.doc).length;
    this.notify(
      'info',
      removed === 0 ? 'There are no unused tags' : `Purged ${countOf(removed, 'unused tag')}`,
    );
    return removed;
  }

  setTagVisible(tagId: TagId, visible: boolean): void {
    this.tools.cancel();
    const doc = this.session.doc;
    doc.transact(visible ? 'Show Tag' : 'Hide Tag', () => {
      setTagAttributes(doc, tagId, { visible });
    });
  }

  setTagColor(tagId: TagId, color: Rgb): void {
    const doc = this.session.doc;
    doc.transact('Change Tag Color', () => {
      setTagAttributes(doc, tagId, { color });
    });
  }

  /** New groups and components go on the active tag. Not undoable. */
  setActiveTag(tagId: TagId | null): void {
    this.session.setActiveTag(tagId);
  }

  assignSelectionToTag(tagId: TagId | null): void {
    this.updateSelectionAttributes({ tagId });
  }

  // ---------------------------------------------------------------------------------------------- components

  componentDefinitions(): ComponentRow[] {
    return listComponentDefinitions(this.session.doc);
  }

  /** The definition the Place Component tool is placing, if it is active. */
  get placementDefinition(): DefinitionId | null {
    return this.#placementTool.definitionId;
  }

  /** Activates the Place Component tool for a component definition. */
  placeComponent(definitionId: DefinitionId): void {
    const doc = this.session.doc;
    const definition = doc.definition(definitionId);
    if (!definition || definition.attributes.isGroup || definitionId === doc.rootDefinitionId) {
      this.notify('error', 'Choose a component to place');
      return;
    }
    this.activateTool(PLACE_COMPONENT_TOOL_ID);
    this.#placementTool.setDefinition(definitionId);
    this.tools.refresh();
  }

  /** Selects every instance of a definition in the active context. Returns how many were selected. */
  selectInstancesOf(definitionId: DefinitionId): number {
    const { session } = this;
    const refs = [...session.doc.store(session.activeContext).instances()]
      .filter((instance) => instance.definitionId === definitionId)
      .map((instance) => ({ kind: 'instance' as const, id: instance.id }));
    session.setSelection(Selection.of(refs));
    if (refs.length === 0) this.notify('info', 'There are no instances of that component here');
    return refs.length;
  }

  /** Deletes component definitions that have no instances. Returns how many were deleted. */
  purgeUnusedComponents(): number {
    this.tools.cancel();
    const removed = purgeUnusedDefinitions(this.session.doc).length;
    this.notify(
      'info',
      removed === 0 ? 'There are no unused components' : `Purged ${countOf(removed, 'unused component')}`,
    );
    return removed;
  }

  // ---------------------------------------------------------------------------------------------- panels

  get openPanels(): readonly PanelId[] {
    return this.#openPanels;
  }

  isPanelOpen(panel: PanelId): boolean {
    return this.#openPanels.includes(panel);
  }

  setPanelOpen(panel: PanelId, open: boolean): void {
    if (this.isPanelOpen(panel) === open) return;
    const current = this.#openPanels;
    this.#openPanels = PANEL_IDS.filter((id) => (id === panel ? open : current.includes(id)));
    this.#emit({ kind: 'panels' });
  }

  togglePanel(panel: PanelId): void {
    this.setPanelOpen(panel, !this.isPanelOpen(panel));
  }

  // ---------------------------------------------------------------------------------------------- files

  get hasFileAccess(): boolean {
    return this.#environment.fileAccess !== undefined;
  }

  async newDocument(): Promise<void> {
    if (!(await this.#confirmDiscard())) return;
    this.tools.cancel();
    this.session.replaceDocument(new ModelDocument(), { name: UNTITLED_DOCUMENT_NAME });
    this.session.setCamera(DEFAULT_CAMERA);
  }

  async openSample(): Promise<void> {
    if (!(await this.#confirmDiscard())) return;
    this.tools.cancel();
    this.session.replaceDocument(createSampleModel(), { name: SAMPLE_MODEL_NAME });
    this.setStandardView('iso');
  }

  async openFile(): Promise<void> {
    const access = this.#environment.fileAccess;
    if (!access || !(await this.#confirmDiscard())) return;
    const file = await access.open();
    if (file) this.loadFile(file.bytes, file.name, file.handle);
  }

  /** Replaces the document with the contents of a .planar file. Returns false (and notifies) when it is invalid. */
  loadFile(
    bytes: Uint8Array,
    fileName: string,
    fileHandle: unknown = null,
    options: { dirty?: boolean } = {},
  ): boolean {
    const result = decodePlanarFile(bytes);
    if (!result.ok) {
      this.notify('error', `Could not open ${fileName}: ${result.error}`);
      return false;
    }
    this.tools.cancel();
    this.session.replaceDocument(result.value.doc, {
      name: withoutExtension(fileName),
      fileHandle,
      dirty: options.dirty === true,
    });
    this.zoomExtents();
    return true;
  }

  /** The current document as .planar file bytes. */
  encodeDocument(): Uint8Array {
    return encodePlanarFile(this.session.doc, { appVersion: this.appVersion, now: new Date() });
  }

  saveFile(): Promise<boolean> {
    return this.#save(false);
  }

  saveFileAs(): Promise<boolean> {
    return this.#save(true);
  }

  async #save(chooseLocation: boolean): Promise<boolean> {
    const access = this.#environment.fileAccess;
    if (!access) return false;
    const { session } = this;
    const result = await access.save(
      this.encodeDocument(),
      `${session.documentName}${PLANAR_FILE_EXTENSION}`,
      chooseLocation ? null : session.fileHandle,
    );
    if (!result) return false;
    session.markSaved(withoutExtension(result.name), result.handle);
    this.notify('info', `Saved ${result.name}`);
    return true;
  }

  async #confirmDiscard(): Promise<boolean> {
    const confirm = this.#environment.confirmDiscardChanges;
    return !this.session.isDirty || !confirm || confirm(this.session.documentName);
  }

  #emit(event: EditorEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}
