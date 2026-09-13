import type { EdgeId, FaceId, InstanceId } from '../kernel/ids';
import { ModelDocument } from '../kernel/model/ModelDocument';
import { deleteFaces, eraseEdges } from '../kernel/ops/erase';
import { deleteInstances, explodeInstance, makeComponent, makeGroup } from '../kernel/ops/hierarchy';
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
import { definitionBounds } from './geometry/bounds';
import { pick, type PickHit, type PickRequest } from './picking/picker';
import { createSampleModel, SAMPLE_MODEL_NAME } from './sample/sampleModel';
import { boxSelect, type BoxSelectMode, type ScreenRect } from './selection/boxSelect';
import { WorkerBooleanEngine, type BooleanEngine } from './solids/booleanClient';
import { allSelectableRefs } from './selection/queries';
import { Selection, type EntityRef } from './selection/Selection';
import { EditorSession, UNTITLED_DOCUMENT_NAME } from './session/EditorSession';
import { chordFromKeyboard, ShortcutMap, type KeyChordInput, type Platform } from './shortcuts/shortcuts';
import { ArcTool } from './tools/ArcTool';
import { CircleTool } from './tools/CircleTool';
import { EraserTool } from './tools/EraserTool';
import { FollowMeTool } from './tools/FollowMeTool';
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
  | { readonly kind: 'ui-request'; readonly request: UiRequest };

export interface EditorEnvironment {
  readonly platform: Platform;
  readonly appVersion: string;
  readonly fileAccess?: FileAccess;
  /** Asks the user whether unsaved changes may be discarded. Without it, changes are discarded silently. */
  readonly confirmDiscardChanges?: (documentName: string) => Promise<boolean>;
  /** Runs solid-tool booleans. Defaults to the manifold-3d worker, started on first use. */
  readonly booleanEngine?: BooleanEngine;
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
  #booleans: BooleanEngine | null = null;

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
        new FollowMeTool(),
      ],
      SELECT_TOOL_ID,
    );
  }

  /** The engine the solid tools use for booleans. */
  get booleans(): BooleanEngine {
    this.#booleans ??= this.#environment.booleanEngine ?? new WorkerBooleanEngine();
    return this.#booleans;
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
    session.setSelection(Selection.of(allSelectableRefs(session.doc.store(session.activeContext))));
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
    const created = make(session.doc, session.activeContext, {
      faces: selection.ids('face') as FaceId[],
      edges: selection.ids('edge') as EdgeId[],
      instances: selection.ids('instance') as InstanceId[],
    });
    session.setSelection(Selection.of([{ kind: 'instance', id: created.instance }]));
  }

  /** Replaces the selected groups and components with their contents. */
  explodeSelection(): void {
    const { session } = this;
    const instances = session.selection.ids('instance') as InstanceId[];
    if (instances.length === 0) return;
    this.tools.cancel();
    const doc = session.doc;
    doc.transact('Explode', () => {
      for (const id of instances) explodeInstance(doc, session.activeContext, id);
    });
    session.setSelection(Selection.EMPTY);
  }

  /** Opens a group or component for editing; the rest of the model fades. */
  openGroup(instanceId: InstanceId): void {
    this.tools.cancel();
    this.session.enterInstance(instanceId);
  }

  /** Closes the open group or component. Returns false when none is open. */
  closeGroup(): boolean {
    this.tools.cancel();
    return this.session.exitContext();
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
