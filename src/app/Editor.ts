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

import { createLogger } from './diagnostics/log';
import type { DefinitionId, EdgeId, FaceId, InstanceId, TagId, CurveId, AnnotationId } from '../kernel/ids';
import { ModelDocument } from '../kernel/model/ModelDocument';
import {
  addTag as addTagMutation,
  setDefinitionAttributes,
  setEdgeAttributes,
  setFaceAttributes,
  setInstanceAttributes,
  setTagAttributes,
  removeInstance,
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
import type { MaterialId } from '../kernel/ids';
import {
  addMaterial as addMaterialMutation,
  addTextureAsset,
  setMaterialAttributes,
} from '../kernel/model/mutations';
import type { MaterialAttributes, TexturePlacement } from '../kernel/model/types';
import {
  deleteMaterial as deleteMaterialOp,
  paintSidePatch,
  purgeUnusedMaterials as purgeUnusedMaterialsOp,
  removeUnusedTextureAssets,
  type FaceSide,
} from '../kernel/ops/materials';
import {
  libraryColor,
  listMaterials,
  uniqueMaterialName,
  type LibraryMaterial,
  type MaterialRow,
} from './materials/materials';
import { PaintBucketTool } from './tools/PaintBucketTool';
import { transformEntities } from '../kernel/ops/transform';
import { vec3 } from '../kernel/math/vec3';
import { type UnitSettings } from '../kernel/units/units';
import { parseMeasurement } from '../kernel/vcb/parseMeasurement';
import {
  decodePlanarFile,
  encodePlanarFile,
  PLANAR_FILE_EXTENSION,
  readPlanarThumbnail,
} from '../io/format/planarFile';
import type { FileAccess } from '../io/fs/types';
import { DEFAULT_RETENTION, recoverySnapshotId, type RecoveryRepository } from '../io/idb/recovery';
import {
  DEFAULT_CAMERA,
  orbit,
  pan,
  setProjection,
  standardView,
  zoom,
  zoomFocusInEmptySpace,
  zoomLimits,
  zoomToBounds,
  type ZoomLimits,
  type Projection,
  type ScreenPoint,
  type StandardView,
  type ViewportSize,
} from './camera/camera';
import { CommandRegistry } from './commands/CommandRegistry';
import { registerDefaultCommands } from './commands/defaultCommands';
import { listComponentDefinitions, type ComponentRow } from './components/componentList';
import { definitionBounds } from './geometry/bounds';
import { PANEL_IDS, type PanelId, DEFAULT_OPEN_PANELS } from './panels/panels';
import { hasLockedInstance, isInstanceLocked, LOCKED_MESSAGE } from './selection/locking';
import { nextTagColor, uniqueTagName } from './tags/tags';
import { ComponentPlacementTool, PLACE_COMPONENT_TOOL_ID } from './tools/ComponentPlacementTool';
import { PasteTool, PASTE_TOOL_ID } from './tools/PasteTool';
import {
  copySelection as captureClipboard,
  describeClipboard,
  insertedRefs,
  pasteFragment,
  pasteWouldNest,
  type Clipboard,
} from './clipboard/clipboard';
import { Text3DTool, TEXT_3D_TOOL_ID } from './tools/Text3DTool';
import type { Text3DOptions } from '../kernel/ops/text3d';
import { parseText3DForm, type Text3DForm } from './text3d/text3dForm';
import { pick, type PickHit, type PickRequest } from './picking/picker';
import { createSampleModel, SAMPLE_MODEL_NAME } from './sample/sampleModel';
import { DEFAULT_PREFERENCES, type Preferences, type PreferenceStorage } from './preferences/preferences';
import { templateById } from './templates/templates';
import { boxSelect, type BoxSelectMode, type ScreenRect } from './selection/boxSelect';
import { WorkerBooleanEngine, type BooleanEngine } from './solids/booleanClient';
import { allSelectableRefs } from './selection/queries';
import { Selection, type EntityRef } from './selection/Selection';
import { EditorSession, UNTITLED_DOCUMENT_NAME } from './session/EditorSession';
import {
  assignShortcut as assignShortcutOverride,
  buildShortcutMap,
  exportShortcuts as exportShortcutsFile,
  importShortcuts as importShortcutsFile,
  removeShortcut as removeShortcutOverride,
  resetShortcut as resetShortcutOverride,
  validateUserChord,
  type ConflictResolution,
  type ShortcutOverrides,
  type ShortcutStorage,
} from './shortcuts/customization';
import {
  chordFromKeyboard,
  type KeyChordInput,
  type Platform,
  type ShortcutMap,
} from './shortcuts/shortcuts';
import { divideEdge, explodeCurve, weldEdges } from '../kernel/ops/curveEdit';
import { softenEdgesByAngle } from '../kernel/ops/soften';
import { ArcTool } from './tools/ArcTool';
import { OffsetTool } from './tools/OffsetTool';
import { DimensionTool } from './tools/DimensionTool';
import { TextTool } from './tools/TextTool';
import { removeAnnotation, updateAnnotation } from '../kernel/model/mutations';
import { AxesTool } from './tools/AxesTool';
import type { SceneId, SectionPlaneId } from '../kernel/ids';
import type { Vec3 } from '../kernel/math/vec3';
import type { SectionPlaneView } from '../kernel/model/EntityStore';
import {
  addScene as addSceneMutation,
  addSectionPlane,
  removeScene as removeSceneMutation,
  removeSectionPlane,
  reorderScenes,
  setShadowSettings,
  updateScene as updateSceneMutation,
  updateSectionPlane,
} from '../kernel/model/mutations';
import {
  DEFAULT_SCENE_SAVES,
  type SceneSaves,
  type SceneState,
  type ShadowSettings,
} from '../kernel/model/types';
import { createGroupFromSlice as createGroupFromSliceOp } from '../kernel/ops/sections';
import {
  applySceneModelState,
  CameraTransition,
  captureSceneState,
  createSystemClock,
  DEFAULT_SCENE_DELAY_SECONDS,
  DEFAULT_SCENE_TRANSITION_SECONDS,
  MAX_SCENE_SECONDS,
  sceneCamera,
  uniqueSceneName,
  type AnimationClock,
} from './scenes/scenes';
import { SectionPlaneTool } from './tools/SectionPlaneTool';
import { joinShadowDateTime, type ShadowDateTimeParts } from './shadows/shadowSettings';
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
import type { ImportLimits } from '../io/mesh/limits';
import type { ImportEngine } from './io/importEngine';
import { ModelExchange } from './io/ModelExchange';
import { purgeAllUnused as purgeAllUnusedOp, purgedCount } from '../kernel/ops/purge';
import type { ViewCapturePort } from './io/viewCapture';
import {
  setEnvironmentSettings,
  setFogSettings,
  setInModelStyles,
  setStyleSettings,
} from '../kernel/model/mutations';
import type { EnvironmentSettings, FogSettings, StyleSettings } from '../kernel/model/types';
import { CUSTOM_ENVIRONMENT_ID, stylePreset, uniqueStyleName } from './styles/stylePresets';
import { HDR_FILTER, isRadianceHeader, MAX_ENVIRONMENT_IMAGE_BYTES } from './styles/environmentImage';
import {
  DEFAULT_DOCK_LAYOUT,
  moveDockPanel,
  moveDockPanelTo,
  withDockWidth,
  withPanelCollapsed,
  type DockLayout,
  type DockLayoutStorage,
  type DropPlacement,
  type PanelFocusRequest,
} from './dock/dockLayout';

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
/** A value the editor needs from the user, shown by the UI as a small dialog. */
export interface InputRequest {
  readonly title: string;
  readonly label: string;
  readonly initial: string;
  readonly confirmLabel: string;
  /** Uses the entered text. Throwing shows the error and closes the dialog. */
  readonly submit: (value: string) => void;
}

/** Keeps the list of recently opened and saved files. */
export interface RecentFilesRecorder {
  /** `thumbnail` is the PNG preview stored in the file, or null when it has none. */
  record(name: string, handle: unknown, thumbnail: Uint8Array | null): void;
}

export type UiRequest = 'command-palette' | 'backups' | 'start' | 'shortcuts' | 'preferences' | 'text3d';

export type EditorEvent =
  | { readonly kind: 'notifications' }
  | { readonly kind: 'measurement' }
  | { readonly kind: 'ui-request'; readonly request: UiRequest }
  | { readonly kind: 'panels' }
  | { readonly kind: 'input-request' }
  | { readonly kind: 'shortcuts' }
  | { readonly kind: 'preferences' }
  | { readonly kind: 'scenes' };

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

const editorLog = createLogger('editor');
const countOf = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

export interface EditorEnvironment {
  readonly platform: Platform;
  readonly appVersion: string;
  readonly fileAccess?: FileAccess;
  /** Asks the user whether unsaved changes may be discarded. Without it, changes are discarded silently. */
  readonly confirmDiscardChanges?: (documentName: string) => Promise<boolean>;
  /** Runs solid-tool booleans. Defaults to the manifold-3d worker, started on first use. */
  readonly booleanEngine?: BooleanEngine;
  /** Time source for scene transitions and animation. Defaults to the system clock. */
  readonly clock?: AnimationClock;
  /** Whether the user asked for reduced motion; scene changes are then instant. Defaults to the media query. */
  readonly prefersReducedMotion?: () => boolean;
  /** Parses imported models. Defaults to the io worker, started on first use. */
  readonly importEngine?: ImportEngine;
  /** Renders the view for Export 2D Graphic. */
  readonly viewCapture?: ViewCapturePort;
  /** Overrides for the import resource limits. */
  readonly importLimits?: Partial<ImportLimits>;
}

function systemPrefersReducedMotion(): boolean {
  const query = (globalThis as { matchMedia?: (query: string) => { matches: boolean } }).matchMedia;
  return query?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** A name like `Section 2` that no section plane in the document uses. */
function uniqueSectionName(doc: ModelDocument): string {
  const names = new Set<string>();
  for (const definition of doc.definitions()) {
    for (const plane of definition.store.sectionPlanes()) names.add(plane.name);
  }
  for (let n = 1; ; n++) {
    const name = `Section ${String(n)}`;
    if (!names.has(name)) return name;
  }
}

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 240;

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
  #shortcuts: ShortcutMap;
  #shortcutOverrides: ShortcutOverrides = {};
  #shortcutStorage: ShortcutStorage | null = null;
  readonly tools: ToolManager;
  /** Import, 3D export and image export. */
  readonly exchange: ModelExchange;
  #preferences: Preferences = DEFAULT_PREFERENCES;
  #preferenceStorage: PreferenceStorage | null = null;

  readonly #environment: EditorEnvironment;
  readonly #listeners = new Set<(event: EditorEvent) => void>();
  #viewportSize: ViewportSize = { width: 1, height: 1 };
  #notifications: readonly EditorNotification[] = [];
  #nextNotificationId = 1;
  #measurementText = '';
  readonly #placementTool = new ComponentPlacementTool();
  readonly #pasteTool = new PasteTool();
  /** What Cut or Copy last captured; kept until the next copy, and only pasteable into its own document. */
  #clipboard: Clipboard | null = null;
  readonly #text3dTool = new Text3DTool();
  #text3dForm: Text3DForm | null = null;
  #openPanels: readonly PanelId[] = DEFAULT_OPEN_PANELS;
  #inputRequest: InputRequest | null = null;
  #backups: { readonly repository: RecoveryRepository; readonly sessionId: string } | null = null;
  /** The bytes last written to or read from the document's file, kept as a backup before it is overwritten. */
  #lastSavedBytes: Uint8Array | null = null;
  #recentFiles: RecentFilesRecorder | null = null;
  #booleans: BooleanEngine | null = null;
  readonly #clock: AnimationClock;
  readonly #cameraTransition: CameraTransition;
  #activeSceneId: SceneId | null = null;
  #animationPlaying = false;
  #animationTimer: number | null = null;
  #sceneTransitionSeconds = DEFAULT_SCENE_TRANSITION_SECONDS;
  #sceneDelaySeconds = DEFAULT_SCENE_DELAY_SECONDS;

  constructor(environment: EditorEnvironment) {
    this.#environment = environment;
    this.platform = environment.platform;
    this.appVersion = environment.appVersion;
    this.exchange = new ModelExchange(this, environment);
    this.#clock = environment.clock ?? createSystemClock();
    this.#cameraTransition = new CameraTransition(this.#clock);
    this.session.subscribe((event) => {
      if (event.kind !== 'document') return;
      this.stopAnimation();
      this.#activeSceneId = null;
      this.#emit({ kind: 'scenes' });
    });
    registerDefaultCommands(this.commands);
    this.#shortcuts = buildShortcutMap(this.commands.all(), {});
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
        new OffsetTool(),
        new DimensionTool(),
        new TextTool(),
        new PaintBucketTool(),
        new SectionPlaneTool(),
        this.#placementTool,
        this.#pasteTool,
        new FollowMeTool(),
        this.#text3dTool,
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
    if (kind === 'error') editorLog.error(message);
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

  /** The pending question for the user, if any. */
  get inputRequest(): InputRequest | null {
    return this.#inputRequest;
  }

  requestInput(request: InputRequest): void {
    this.#inputRequest = request;
    this.#emit({ kind: 'input-request' });
  }

  /** Answers the pending input request with `value`, or cancels it with null. */
  resolveInput(value: string | null): void {
    const request = this.#inputRequest;
    if (!request) return;
    this.#inputRequest = null;
    this.#emit({ kind: 'input-request' });
    if (value === null) return;
    try {
      request.submit(value);
    } catch (error) {
      this.notify('error', errorMessage(error));
    }
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
    if (this.#animationPlaying && input.key === 'Escape') {
      this.stopAnimation();
      return true;
    }
    if (this.#handleMeasurementKey(input)) return true;
    const chord = chordFromKeyboard(input, this.platform);
    if (!chord) return false;
    if (this.tools.keyDown(chord)) return true;
    const commandId = this.shortcuts.commandFor(chord);
    if (!commandId) return false;
    void this.runCommand(commandId);
    return true;
  }

  // ---------------------------------------------------------------------------------------------- preferences

  /** Settings kept on this device: theme, interface size, wheel direction, autosave interval and units. */
  get preferences(): Preferences {
    return this.#preferences;
  }

  get units(): UnitSettings {
    return this.#preferences.units;
  }

  /** Loads preferences from storage, and saves later changes there. */
  setPreferenceStorage(storage: PreferenceStorage): void {
    this.#preferenceStorage = storage;
    this.#applyPreferences(storage.load(), false);
  }

  updatePreferences(patch: Partial<Preferences>): void {
    this.#applyPreferences({ ...this.#preferences, ...patch }, true);
  }

  resetPreferences(): void {
    this.#applyPreferences(DEFAULT_PREFERENCES, true);
  }

  #applyPreferences(preferences: Preferences, persist: boolean): void {
    this.#preferences = preferences;
    if (persist) {
      try {
        this.#preferenceStorage?.save(preferences);
      } catch (error) {
        this.notify('error', `Could not save your preferences: ${errorMessage(error)}`);
      }
    }
    this.#emit({ kind: 'preferences' });
    // Measurements and hints are shown in the units just chosen.
    this.tools.refresh();
  }
  // ---------------------------------------------------------------------------------------------- shortcuts

  get shortcuts(): ShortcutMap {
    return this.#shortcuts;
  }

  /** The user's changes to the default shortcuts. */
  get shortcutOverrides(): ShortcutOverrides {
    return this.#shortcutOverrides;
  }

  /** Loads the user's shortcut changes from storage, and saves later changes there. */
  setShortcutStorage(storage: ShortcutStorage): void {
    this.#shortcutStorage = storage;
    this.#applyShortcutOverrides(storage.load(), false);
  }

  /** Other commands that already use a chord, so the UI can ask whether to replace them. */
  shortcutConflicts(commandId: string, chord: string): string[] {
    return this.#shortcuts.commandsFor(chord).filter((id) => id !== commandId);
  }

  /**
   * Adds a shortcut to a command. Throws for chords that can't be used. With `keep`, nothing changes when another
   * command already uses the chord; returns whether the shortcut was assigned.
   */
  assignShortcut(commandId: string, chordText: string, resolution: ConflictResolution): boolean {
    if (!this.commands.get(commandId)) throw new Error(`Unknown command "${commandId}"`);
    const chord = validateUserChord(chordText);
    if (!chord.ok) throw new Error(chord.error);
    const next = assignShortcutOverride(
      this.#shortcutOverrides,
      this.#shortcuts,
      commandId,
      chord.value,
      resolution,
    );
    if (next === this.#shortcutOverrides) return false;
    this.#applyShortcutOverrides(next, true);
    return true;
  }

  removeShortcut(commandId: string, chord: string): void {
    this.#applyShortcutOverrides(
      removeShortcutOverride(this.#shortcutOverrides, this.#shortcuts, commandId, chord),
      true,
    );
  }

  resetShortcut(commandId: string): void {
    this.#applyShortcutOverrides(resetShortcutOverride(this.#shortcutOverrides, commandId), true);
  }

  resetAllShortcuts(): void {
    this.#applyShortcutOverrides({}, true);
  }

  /** The user's shortcut changes as the contents of a shortcuts file. */
  exportShortcuts(): string {
    return exportShortcutsFile(this.#shortcutOverrides);
  }

  /** Replaces the user's shortcut changes with those from a shortcuts file. Throws when the file is invalid. */
  importShortcuts(text: string): void {
    const result = importShortcutsFile(text, this.commands.all());
    if (!result.ok) throw new Error(result.error);
    this.#applyShortcutOverrides(result.value, true);
  }

  #applyShortcutOverrides(overrides: ShortcutOverrides, persist: boolean): void {
    // Changes for commands that no longer exist are dropped, so stored shortcuts from other versions can't break the map.
    const known = new Set(this.commands.all().map((command) => command.id));
    const valid = Object.fromEntries(Object.entries(overrides).filter(([id]) => known.has(id)));
    try {
      this.#shortcuts = buildShortcutMap(this.commands.all(), valid);
      this.#shortcutOverrides = valid;
    } catch (error) {
      this.#shortcuts = buildShortcutMap(this.commands.all(), {});
      this.#shortcutOverrides = {};
      this.notify(
        'error',
        `Your shortcuts could not be applied, so the defaults are used: ${errorMessage(error)}`,
      );
    }
    if (persist) {
      try {
        this.#shortcutStorage?.save(this.#shortcutOverrides);
      } catch (error) {
        this.notify('error', `Could not save your shortcuts: ${errorMessage(error)}`);
      }
    }
    this.#emit({ kind: 'shortcuts' });
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
    options: Pick<PickRequest, 'edgeTolerancePx' | 'includeSoftEdges' | 'includeSectionPlanes'> = {},
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

  /** How close and how far the wheel may zoom, from the size of the model. */
  #zoomLimits(): ZoomLimits {
    const doc = this.session.doc;
    return zoomLimits(definitionBounds(doc, doc.rootDefinitionId));
  }

  /** Zooms toward the view center. */
  zoomBy(factor: number): void {
    this.session.setCamera(zoom(this.session.camera, factor, null, this.#zoomLimits()));
  }

  /** Zooms toward the geometry under the cursor; with nothing there, toward the model along that direction. */
  zoomAtScreen(screen: ScreenPoint, factor: number): void {
    const doc = this.session.doc;
    const bounds = definitionBounds(doc, doc.rootDefinitionId);
    const camera = this.session.camera;
    const focus =
      this.pickAt(screen)?.point ?? zoomFocusInEmptySpace(camera, screen, this.#viewportSize, bounds);
    this.session.setCamera(zoom(camera, factor, focus, zoomLimits(bounds)));
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
      for (const id of selection.ids('section')) removeSectionPlane(doc, context, id as SectionPlaneId);
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

  // ---------------------------------------------------------------------------------------------- annotations

  /**
   * Asks for new text for a dimension or text label. Clearing a dimension's text shows its measured value again;
   * clearing a text label deletes it.
   */
  editAnnotation(context: DefinitionId, id: AnnotationId): void {
    const { session } = this;
    if (context !== session.activeContext) {
      this.notify('info', 'Open the group or component that contains this label to edit it');
      return;
    }
    const doc = session.doc;
    const annotation = doc.store(context).annotation(id);
    if (!annotation) return;
    const isDimension =
      annotation.geometry.kind === 'linear-dimension' || annotation.geometry.kind === 'radial-dimension';
    this.tools.cancel();
    this.requestInput({
      title: isDimension ? 'Dimension Text' : 'Edit Text',
      label: isDimension
        ? 'Text (leave empty to show the measurement)'
        : 'Text (leave empty to delete the label)',
      initial: annotation.attributes.text ?? '',
      confirmLabel: 'Save',
      submit: (value) => {
        const empty = value.trim() === '';
        doc.transact(isDimension ? 'Edit Dimension' : empty ? 'Delete Text' : 'Edit Text', () => {
          if (empty && !isDimension) removeAnnotation(doc, context, id);
          else updateAnnotation(doc, context, id, { attributes: { text: empty ? null : value } });
        });
      },
    });
  }

  // ---------------------------------------------------------------------------------------------- curves & softening

  #selectedEdgeIds(): EdgeId[] {
    return this.session.selection.ids('edge') as EdgeId[];
  }

  /** Asks how many segments to divide the one selected edge into. */
  divideSelection(): void {
    const edges = this.#selectedEdgeIds();
    const [edgeId] = edges;
    if (edgeId === undefined || edges.length !== 1) {
      this.notify('error', 'Select one edge to divide');
      return;
    }
    this.requestInput({
      title: 'Divide Edge',
      label: 'Number of segments',
      initial: '2',
      confirmLabel: 'Divide',
      submit: (value) => {
        this.divideEdge(edgeId, Number(value.trim()));
      },
    });
  }

  divideEdge(edgeId: EdgeId, segments: number): void {
    const { session } = this;
    this.tools.cancel();
    const edges = divideEdge(session.doc, session.activeContext, edgeId, segments);
    session.setSelection(Selection.of(edges.map((id): EntityRef => ({ kind: 'edge', id }))));
  }

  /** Joins the selected connected edges into one curve. */
  weldSelection(): void {
    const { session } = this;
    const edges = this.#selectedEdgeIds();
    if (edges.length < 2) throw new Error('Select at least two connected edges to weld');
    this.tools.cancel();
    const doc = session.doc;
    doc.transact('Weld Edges', () => weldEdges(doc, session.activeContext, edges));
  }

  /** Turns the curves of the selected edges back into separate edges. Returns how many curves were exploded. */
  explodeCurvesInSelection(): number {
    const { session } = this;
    const doc = session.doc;
    const store = doc.store(session.activeContext);
    const curves = new Set<CurveId>();
    for (const edgeId of this.#selectedEdgeIds()) {
      const curve = store.edge(edgeId)?.curve;
      if (curve !== undefined && curve !== null) curves.add(curve);
    }
    if (curves.size === 0) return 0;
    this.tools.cancel();
    doc.transact('Explode Curve', () => {
      for (const curve of curves) explodeCurve(doc, session.activeContext, curve);
    });
    return curves.size;
  }

  /**
   * Softens the selected edges, and the edges of selected faces, whose faces meet at up to `maxAngleDegrees`.
   * Returns how many edges changed.
   */
  softenSelection(options: {
    readonly maxAngleDegrees: number;
    readonly softenCoplanar: boolean;
    readonly smooth: boolean;
  }): number {
    const { session } = this;
    const doc = session.doc;
    const context = session.activeContext;
    const store = doc.store(context);
    const edges = new Set(this.#selectedEdgeIds());
    for (const faceId of session.selection.ids('face') as FaceId[]) {
      if (store.face(faceId)) for (const edgeId of store.faceEdges(faceId)) edges.add(edgeId);
    }
    if (edges.size === 0) throw new Error('Select edges or faces to soften');
    return doc.transact('Soften Edges', () =>
      softenEdgesByAngle(doc, context, [...edges], {
        maxAngleRadians: (options.maxAngleDegrees * Math.PI) / 180,
        softenCoplanar: options.softenCoplanar,
        smooth: options.smooth,
      }),
    );
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

  // ---------------------------------------------------------------------------------------------- clipboard

  /** What Cut or Copy last captured, if anything. */
  get clipboard(): Clipboard | null {
    return this.#clipboard;
  }

  /**
   * True when the clipboard holds geometry of the open document that may go into the open context. Pasting a group
   * into itself is refused, so Paste is disabled while the copied group is open.
   */
  canPaste(): boolean {
    const clipboard = this.#clipboard;
    const { session } = this;
    if (clipboard?.doc !== session.doc) return false;
    return !pasteWouldNest(session.doc, session.activeContext, clipboard);
  }

  /** Copies the selected faces, edges, groups and components. Returns false when there was nothing to copy. */
  copySelection(): boolean {
    const { session } = this;
    const clipboard = captureClipboard(session.doc, session.activeContext, session.selection.refs());
    if (!clipboard) return false;
    this.#clipboard = clipboard;
    return true;
  }

  /** Copies the selection and removes it. */
  cutSelection(): void {
    const { session } = this;
    const selection = session.selection;
    if (selection.isEmpty) return;
    const doc = session.doc;
    const context = session.activeContext;
    if (hasLockedInstance(doc, context, selection.refs())) {
      this.notify('error', LOCKED_MESSAGE);
      return;
    }
    if (!this.copySelection()) return;
    this.tools.cancel();
    // Unlike Delete, a cut group keeps its definition even while nothing instances it, so Paste can bring it back.
    doc.transact('Cut', () => {
      for (const id of selection.ids('instance')) removeInstance(doc, context, id as InstanceId);
      deleteFaces(doc, context, selection.ids('face') as FaceId[]);
      eraseEdges(doc, context, selection.ids('edge') as EdgeId[]);
      for (const id of selection.ids('section')) removeSectionPlane(doc, context, id as SectionPlaneId);
    });
    session.setSelection(Selection.EMPTY);
  }

  /** Starts a paste: the copied geometry follows the cursor until a click drops it into the open context. */
  pasteFromClipboard(): void {
    if (!this.canPaste()) return;
    this.#pasteTool.setClipboard(this.#clipboard);
    this.activateTool(PASTE_TOOL_ID);
  }

  /** Pastes at the coordinates the copy came from, without waiting for a click. */
  pasteInPlace(): void {
    const clipboard = this.#clipboard;
    if (!clipboard || !this.canPaste()) return;
    this.tools.cancel();
    const { session } = this;
    const inserted = pasteFragment(session.doc, session.activeContext, clipboard, vec3(0, 0, 0));
    session.setSelection(Selection.of(insertedRefs(inserted)));
    this.notify('info', `Pasted ${describeClipboard(clipboard.counts)}`);
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

  // ---------------------------------------------------------------------------------------------- materials

  /** The material the Paint Bucket applies; null is the default material. */
  get activeMaterialId(): MaterialId | null {
    return this.session.activeMaterialId;
  }

  /** Not undoable. */
  setActiveMaterial(materialId: MaterialId | null): void {
    this.session.setActiveMaterial(materialId);
  }

  materialRows(): MaterialRow[] {
    return listMaterials(this.session.doc);
  }

  /** Adds a material and makes it active. Without a name it is called `Material n`. */
  addMaterial(
    options: { readonly name?: string; readonly color?: MaterialAttributes['color'] } = {},
  ): MaterialId {
    const doc = this.session.doc;
    const trimmed = options.name?.trim() ?? '';
    const id = doc.transact('Add Material', () =>
      addMaterialMutation(doc, {
        name: trimmed === '' ? uniqueMaterialName(doc) : trimmed,
        color: options.color ?? { r: 0.8, g: 0.8, b: 0.8 },
      }),
    );
    this.session.setActiveMaterial(id);
    return id;
  }

  /** Copies a bundled library material into the model and makes it active. */
  addLibraryMaterial(entry: LibraryMaterial): MaterialId {
    const doc = this.session.doc;
    const id = doc.transact('Add Material', () =>
      addMaterialMutation(doc, {
        name: uniqueMaterialName(doc, entry.name),
        color: libraryColor(entry),
        ...(entry.opacity !== undefined ? { opacity: entry.opacity } : {}),
        ...(entry.metalness !== undefined ? { metalness: entry.metalness } : {}),
        ...(entry.roughness !== undefined ? { roughness: entry.roughness } : {}),
      }),
    );
    this.session.setActiveMaterial(id);
    return id;
  }

  /** Returns false (and notifies) when the name is empty. */
  renameMaterial(materialId: MaterialId, name: string): boolean {
    const trimmed = name.trim();
    if (trimmed === '') {
      this.notify('error', 'A material needs a name');
      return false;
    }
    return this.#editMaterial('Rename Material', materialId, { name: trimmed });
  }

  /** Changes color, opacity, metalness or roughness in one undoable step. Returns false (and notifies) on failure. */
  updateMaterial(
    materialId: MaterialId,
    patch: Partial<Pick<MaterialAttributes, 'color' | 'opacity' | 'metalness' | 'roughness'>>,
  ): boolean {
    return this.#editMaterial('Edit Material', materialId, patch);
  }

  /**
   * Gives a material a texture image (PNG or JPEG bytes). Without a tile size, the tile is 1 m wide and as tall as
   * the image's aspect ratio makes it. Returns false (and notifies) when the image can't be used.
   */
  importMaterialTexture(
    materialId: MaterialId,
    name: string,
    bytes: Uint8Array,
    tile?: { readonly width: number; readonly height: number },
  ): boolean {
    const doc = this.session.doc;
    try {
      doc.transact('Import Texture', () => {
        const assetId = addTextureAsset(doc, name, bytes);
        const asset = doc.asset(assetId);
        const aspect = asset ? asset.height / asset.width : 1;
        setMaterialAttributes(doc, materialId, {
          texture: { assetId, width: tile?.width ?? 1, height: tile?.height ?? aspect },
        });
        removeUnusedTextureAssets(doc);
      });
      return true;
    } catch (error) {
      this.notify('error', `Could not import ${name}: ${errorMessage(error)}`);
      return false;
    }
  }

  /** Sets the size of one texture tile in meters. Returns false (and notifies) when it isn't valid. */
  setMaterialTextureSize(materialId: MaterialId, width: number, height: number): boolean {
    const texture = this.session.doc.material(materialId)?.texture;
    if (!texture) return false;
    return this.#editMaterial('Resize Texture', materialId, { texture: { ...texture, width, height } });
  }

  /** Removes a material's texture, and its image when no other material uses it. */
  removeMaterialTexture(materialId: MaterialId): void {
    const doc = this.session.doc;
    if (!doc.material(materialId)?.texture) return;
    doc.transact('Remove Texture', () => {
      setMaterialAttributes(doc, materialId, { texture: null });
      removeUnusedTextureAssets(doc);
    });
  }

  /** Deletes a material; whatever used it goes back to the default material. */
  deleteMaterial(materialId: MaterialId): void {
    this.tools.cancel();
    deleteMaterialOp(this.session.doc, materialId);
  }

  /** Deletes materials nothing uses. Returns how many were deleted. */
  purgeUnusedMaterials(): number {
    this.tools.cancel();
    const removed = purgeUnusedMaterialsOp(this.session.doc).length;
    this.notify(
      'info',
      removed === 0 ? 'There are no unused materials' : `Purged ${countOf(removed, 'unused material')}`,
    );
    return removed;
  }

  /** Selects the faces of the open context that use a material on either side. Returns how many. */
  selectFacesWithMaterial(materialId: MaterialId): number {
    const { session } = this;
    const refs = [...session.doc.store(session.activeContext).faces()]
      .filter(
        (face) =>
          face.attributes.frontMaterialId === materialId || face.attributes.backMaterialId === materialId,
      )
      .map((face): EntityRef => ({ kind: 'face', id: face.id }));
    session.setSelection(Selection.of(refs));
    if (refs.length === 0) this.notify('info', 'No faces here use that material');
    return refs.length;
  }

  /**
   * Paints the selection with a material: `front` or `back` sides of selected faces, or the default material of
   * selected groups and components (`instance`). Locked groups and components are refused.
   */
  setSelectionMaterial(target: FaceSide | 'instance', materialId: MaterialId | null): void {
    const { session } = this;
    const selection = session.selection;
    const doc = session.doc;
    const context = session.activeContext;
    if (materialId !== null && !doc.material(materialId)) {
      this.notify('error', 'That material no longer exists');
      return;
    }
    if (target === 'instance' && hasLockedInstance(doc, context, selection.refs())) {
      this.notify('error', LOCKED_MESSAGE);
      return;
    }
    doc.transact('Paint', () => {
      if (target === 'instance') {
        for (const id of selection.ids('instance')) {
          setInstanceAttributes(doc, context, id as InstanceId, { materialId });
        }
      } else {
        for (const id of selection.ids('face')) {
          setFaceAttributes(doc, context, id as FaceId, paintSidePatch(target, materialId));
        }
      }
    });
  }

  /** Paints the selected faces' fronts and the selected groups and components with the active material. */
  paintSelection(): void {
    const { session } = this;
    if (session.selection.isEmpty) return;
    const doc = session.doc;
    doc.transact('Paint', () => {
      if (session.selection.count('instance') > 0)
        this.setSelectionMaterial('instance', session.activeMaterialId);
      if (session.selection.count('face') > 0) this.setSelectionMaterial('front', session.activeMaterialId);
    });
  }

  /** Moves, rotates or scales the texture on one side of a face of the open context; null resets it. */
  setFaceTexturePlacement(faceId: FaceId, side: FaceSide, placement: TexturePlacement | null): boolean {
    const { session } = this;
    const doc = session.doc;
    if (!doc.store(session.activeContext).face(faceId)) return false;
    try {
      doc.transact('Position Texture', () => {
        setFaceAttributes(
          doc,
          session.activeContext,
          faceId,
          side === 'front' ? { frontTexturePlacement: placement } : { backTexturePlacement: placement },
        );
      });
      return true;
    } catch (error) {
      this.notify('error', errorMessage(error));
      return false;
    }
  }

  #editMaterial(label: string, materialId: MaterialId, patch: Partial<MaterialAttributes>): boolean {
    const doc = this.session.doc;
    try {
      doc.transact(label, () => {
        setMaterialAttributes(doc, materialId, patch);
      });
      return true;
    } catch (error) {
      this.notify('error', errorMessage(error));
      return false;
    }
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

  /** The values last placed from the 3D Text dialog in this session, or null before the first placement. */
  get text3DForm(): Text3DForm | null {
    return this.#text3dForm;
  }

  /**
   * Checks the 3D Text dialog's values. When they are usable, remembers them and starts placing the text; otherwise
   * returns the message to show.
   */
  submitText3DForm(form: Text3DForm): string | null {
    const parsed = parseText3DForm(form, this.units);
    if (!parsed.ok) return parsed.error;
    this.#text3dForm = form;
    this.place3DText(parsed.value);
    return null;
  }

  /** Activates the 3D Text tool, which places the given text where the user clicks. */
  place3DText(options: Text3DOptions): void {
    this.activateTool(TEXT_3D_TOOL_ID);
    this.#text3dTool.setOptions(options);
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

  /** Removes unused components, materials, texture images and tags in one undoable step. Returns how many. */
  purgeAllUnused(): number {
    this.tools.cancel();
    const result = purgeAllUnusedOp(this.session.doc);
    const removed = purgedCount(result);
    const parts = [
      result.definitions.length > 0 ? countOf(result.definitions.length, 'component') : null,
      result.materials.length > 0 ? countOf(result.materials.length, 'material') : null,
      result.tags.length > 0 ? countOf(result.tags.length, 'tag') : null,
    ].filter((part): part is string => part !== null);
    this.notify('info', removed === 0 ? 'Nothing in the model is unused' : `Purged ${parts.join(', ')}`);
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

  // ---------------------------------------------------------------------------------------------- section planes

  /** Adds an active section plane to the open context (local coordinates) and selects it. */
  placeSectionPlane(point: Vec3, normal: Vec3): SectionPlaneId {
    const { session } = this;
    const doc = session.doc;
    const context = session.activeContext;
    const id = doc.transact('Place Section Plane', () =>
      addSectionPlane(doc, context, { name: uniqueSectionName(doc), point, normal, active: true }),
    );
    session.setSectionDisplay({ planes: true, cuts: true });
    session.setSelection(Selection.of([{ kind: 'section', id }]));
    return id;
  }

  /** The selected section plane when the selection is exactly one section plane. */
  selectedSectionPlane(): SectionPlaneView | null {
    const { session } = this;
    const [id] = session.selection.ids('section');
    if (id === undefined || session.selection.size !== 1) return null;
    return session.doc.store(session.activeContext).sectionPlane(id as SectionPlaneId) ?? null;
  }

  #sectionPlaneOrSelected(id: SectionPlaneId | undefined): SectionPlaneView | null {
    const { session } = this;
    const plane =
      id === undefined
        ? this.selectedSectionPlane()
        : session.doc.store(session.activeContext).sectionPlane(id);
    if (!plane) this.notify('error', 'Select a section plane first');
    return plane ?? null;
  }

  /** Activates the section plane (deactivating the others in its context), or deactivates it when active. */
  toggleSectionPlaneActive(id?: SectionPlaneId): void {
    const plane = this.#sectionPlaneOrSelected(id);
    if (!plane) return;
    const { session } = this;
    const doc = session.doc;
    doc.transact(plane.active ? 'Deactivate Section Cut' : 'Activate Section Cut', () => {
      updateSectionPlane(doc, session.activeContext, plane.id, { active: !plane.active });
    });
  }

  /** Flips which side of the section plane is cut away. */
  reverseSectionPlane(id?: SectionPlaneId): void {
    const plane = this.#sectionPlaneOrSelected(id);
    if (!plane) return;
    const { session } = this;
    const doc = session.doc;
    const { x, y, z } = plane.normal;
    doc.transact('Reverse Section Plane', () => {
      updateSectionPlane(doc, session.activeContext, plane.id, { normal: { x: -x, y: -y, z: -z } });
    });
  }

  renameSectionPlane(id: SectionPlaneId, name: string): boolean {
    const trimmed = name.trim();
    if (trimmed === '') {
      this.notify('error', 'A section plane needs a name');
      return false;
    }
    const { session } = this;
    const doc = session.doc;
    if (!doc.store(session.activeContext).sectionPlane(id)) return false;
    doc.transact('Rename Section Plane', () => {
      updateSectionPlane(doc, session.activeContext, id, { name: trimmed });
    });
    return true;
  }

  /** Makes a group of the edges where the selected section plane cuts the open context's faces, and selects it. */
  createGroupFromSlice(id?: SectionPlaneId): void {
    const plane = this.#sectionPlaneOrSelected(id);
    if (!plane) return;
    const { session } = this;
    const doc = session.doc;
    const context = session.activeContext;
    const tagId = session.activeTagId;
    this.tools.cancel();
    const created = doc.transact('Create Group from Slice', () => {
      const made = createGroupFromSliceOp(doc, context, plane.id);
      if (tagId !== null) setInstanceAttributes(doc, context, made.instance, { tagId });
      return made;
    });
    session.setSelection(Selection.of([{ kind: 'instance', id: created.instance }]));
  }

  /** Shows or hides section plane rectangles and section cuts. View state; not undoable. */
  setSectionDisplay(options: { readonly planes?: boolean; readonly cuts?: boolean }): void {
    this.session.setSectionDisplay(options);
  }

  // ---------------------------------------------------------------------------------------------- shadows

  get shadowSettings(): ShadowSettings {
    return this.session.doc.shadows;
  }

  /** Changes shadow settings in one undoable step. Returns false (and notifies) when a value is invalid. */
  updateShadowSettings(patch: Partial<ShadowSettings>): boolean {
    const doc = this.session.doc;
    try {
      doc.transact('Shadow Settings', () => {
        setShadowSettings(doc, patch);
      });
      return true;
    } catch (error) {
      this.notify('error', errorMessage(error));
      return false;
    }
  }

  /** Changes the date, the time of day or the UTC offset of the shadow settings, keeping the other parts. */
  setShadowDateTime(patch: Partial<ShadowDateTimeParts>): boolean {
    const dateTime = joinShadowDateTime(this.session.doc.shadows.dateTime, patch);
    if (dateTime === null) {
      this.notify('error', 'Enter a valid date and time');
      return false;
    }
    return this.updateShadowSettings({ dateTime });
  }

  // ---------------------------------------------------------------------------------------------- styles, fog, environment

  get styleSettings(): StyleSettings {
    return this.session.doc.style;
  }

  get fogSettings(): FogSettings {
    return this.session.doc.fog;
  }

  get environmentSettings(): EnvironmentSettings {
    return this.session.doc.environment;
  }

  /** Runs one undoable settings change. Returns false (and notifies) when a value is invalid. */
  #settingsTransaction(label: string, change: (doc: ModelDocument) => void): boolean {
    const doc = this.session.doc;
    try {
      doc.transact(label, () => {
        change(doc);
      });
      return true;
    } catch (error) {
      this.notify('error', errorMessage(error));
      return false;
    }
  }

  /** Changes the style in one undoable step. */
  updateStyleSettings(patch: Partial<StyleSettings>, label = 'Change Style'): boolean {
    return this.#settingsTransaction(label, (doc) => {
      setStyleSettings(doc, patch);
    });
  }

  /** Replaces the style with a built-in preset. */
  applyStylePreset(id: string): boolean {
    const preset = stylePreset(id);
    if (!preset) {
      this.notify('error', 'That style does not exist');
      return false;
    }
    return this.updateStyleSettings(preset.settings, 'Apply Style');
  }

  /** Replaces the style with one saved in the model. */
  applyInModelStyle(name: string): boolean {
    const named = this.session.doc.inModelStyles.find((style) => style.name === name);
    if (!named) {
      this.notify('error', `There is no style named “${name}” in this model`);
      return false;
    }
    return this.updateStyleSettings(named.settings, 'Apply Style');
  }

  /** Saves the current style in the model under a new name. */
  saveInModelStyle(name: string): boolean {
    const trimmed = name.trim();
    const styles = this.session.doc.inModelStyles;
    if (trimmed === '') {
      this.notify('error', 'A style needs a name');
      return false;
    }
    if (styles.some((style) => style.name === trimmed)) {
      this.notify('error', `A style named “${trimmed}” already exists; update it instead`);
      return false;
    }
    return this.#settingsTransaction('Save Style', (doc) => {
      setInModelStyles(doc, [...styles, { name: trimmed, settings: doc.style }]);
    });
  }

  /** Asks for a name, then saves the current style in the model. */
  promptSaveInModelStyle(): void {
    this.requestInput({
      title: 'Save Style',
      label: 'Style name',
      initial: uniqueStyleName(this.session.doc.inModelStyles),
      confirmLabel: 'Save',
      submit: (value) => {
        this.saveInModelStyle(value);
      },
    });
  }

  /** Overwrites an in-model style with the current style. */
  updateInModelStyle(name: string): boolean {
    const styles = this.session.doc.inModelStyles;
    if (!styles.some((style) => style.name === name)) return false;
    return this.#settingsTransaction('Update Style', (doc) => {
      setInModelStyles(
        doc,
        styles.map((style) => (style.name === name ? { name, settings: doc.style } : style)),
      );
    });
  }

  deleteInModelStyle(name: string): boolean {
    const styles = this.session.doc.inModelStyles;
    if (!styles.some((style) => style.name === name)) return false;
    return this.#settingsTransaction('Delete Style', (doc) => {
      setInModelStyles(
        doc,
        styles.filter((style) => style.name !== name),
      );
    });
  }

  updateFogSettings(patch: Partial<FogSettings>): boolean {
    return this.#settingsTransaction('Fog Settings', (doc) => {
      setFogSettings(doc, patch);
    });
  }

  updateEnvironmentSettings(patch: Partial<EnvironmentSettings>): boolean {
    return this.#settingsTransaction('Environment Settings', (doc) => {
      setEnvironmentSettings(doc, patch);
    });
  }

  /** Name of the environment image loaded in this session, or null. */
  get environmentImageName(): string | null {
    return this.session.environmentImage?.name ?? null;
  }

  /**
   * Lets the user pick a local Radiance `.hdr` file and uses it as the environment. The image stays in memory for
   * this session only; the model saves just the choice of a custom environment. Nothing is uploaded.
   */
  async loadEnvironmentImage(): Promise<boolean> {
    const access = this.#environment.fileAccess;
    if (!access?.openFiles) {
      this.notify('error', 'Opening files is not available in this browser');
      return false;
    }
    const picked = await access.openFiles(HDR_FILTER);
    const file = picked?.[0];
    if (!file) return false;
    return this.useEnvironmentImage(file.name, file.bytes);
  }

  /** Uses HDR bytes as the custom environment for this session. Returns false (and notifies) for unusable bytes. */
  useEnvironmentImage(name: string, bytes: Uint8Array): boolean {
    if (bytes.byteLength > MAX_ENVIRONMENT_IMAGE_BYTES) {
      this.notify('error', `${name} is too large; environment images can be at most 64 MB`);
      return false;
    }
    if (!isRadianceHeader(bytes)) {
      this.notify('error', `${name} is not a Radiance HDR image`);
      return false;
    }
    this.session.setEnvironmentImage({ name, bytes: bytes.slice() });
    const ok = this.updateEnvironmentSettings({ enabled: true, environmentId: CUSTOM_ENVIRONMENT_ID });
    if (ok)
      this.notify(
        'info',
        `Using ${name} as the environment for this session; the image is not saved in the model`,
      );
    return ok;
  }

  // ---------------------------------------------------------------------------------------------- scenes

  /** The scene applied or added most recently; the scene tabs highlight it. */
  get activeSceneId(): SceneId | null {
    return this.#activeSceneId !== null && this.session.doc.scene(this.#activeSceneId)
      ? this.#activeSceneId
      : null;
  }

  get isAnimationPlaying(): boolean {
    return this.#animationPlaying;
  }

  get sceneTransitionSeconds(): number {
    return this.#sceneTransitionSeconds;
  }

  get sceneDelaySeconds(): number {
    return this.#sceneDelaySeconds;
  }

  /** Scene transition and animation delay, in seconds (0 to 60). Editor settings, not saved in the model. */
  setSceneTiming(timing: { readonly transitionSeconds?: number; readonly delaySeconds?: number }): void {
    const clamp = (value: number | undefined, fallback: number): number =>
      value === undefined || !Number.isFinite(value)
        ? fallback
        : Math.min(MAX_SCENE_SECONDS, Math.max(0, value));
    this.#sceneTransitionSeconds = clamp(timing.transitionSeconds, this.#sceneTransitionSeconds);
    this.#sceneDelaySeconds = clamp(timing.delaySeconds, this.#sceneDelaySeconds);
    this.#emit({ kind: 'scenes' });
  }

  /** Adds a scene that saves the current view and model state, after the other scenes. */
  addScene(name?: string): SceneId {
    const { session } = this;
    const doc = session.doc;
    const trimmed = name?.trim() ?? '';
    const state = captureSceneState(doc, session.camera, {
      name: trimmed === '' ? uniqueSceneName(doc) : trimmed,
      description: '',
      includeInAnimation: true,
      saves: DEFAULT_SCENE_SAVES,
    });
    const id = doc.transact('Add Scene', () => addSceneMutation(doc, state));
    this.#activeSceneId = id;
    this.#emit({ kind: 'scenes' });
    return id;
  }

  /** Saves the current view and model state into a scene, for the properties it saves. */
  updateSceneFromView(id: SceneId | null = this.activeSceneId): void {
    const { session } = this;
    const doc = session.doc;
    const scene = id === null ? undefined : doc.scene(id);
    if (!scene) {
      this.notify('error', 'Choose a scene to update');
      return;
    }
    const captured = captureSceneState(doc, session.camera, scene);
    doc.transact('Update Scene', () => {
      updateSceneMutation(doc, scene.id, captured);
    });
  }

  /** Changes which properties a scene saves. Newly saved properties take their current values. */
  setSceneSaves(id: SceneId, patch: Partial<SceneSaves>): void {
    const { session } = this;
    const doc = session.doc;
    const scene = doc.scene(id);
    if (!scene) return;
    const saves: SceneSaves = { ...scene.saves, ...patch };
    const captured = captureSceneState(doc, session.camera, { ...scene, saves });
    const keep = <K extends keyof SceneState>(key: K, flag: keyof SceneSaves): SceneState[K] =>
      scene.saves[flag] && saves[flag] ? scene[key] : captured[key];
    doc.transact('Scene Properties', () => {
      updateSceneMutation(doc, id, {
        saves,
        camera: keep('camera', 'camera'),
        hiddenTags: keep('hiddenTags', 'visibleTags'),
        sections: keep('sections', 'activeSections'),
        shadows: keep('shadows', 'shadows'),
        axes: keep('axes', 'axes'),
        style: keep('style', 'style'),
        fog: keep('fog', 'fog'),
      });
    });
  }

  /** Renames a scene, or changes its description or whether it plays in the animation. */
  updateSceneDetails(
    id: SceneId,
    patch: { readonly name?: string; readonly description?: string; readonly includeInAnimation?: boolean },
  ): boolean {
    const doc = this.session.doc;
    if (!doc.scene(id)) return false;
    const name = patch.name?.trim();
    if (name === '') {
      this.notify('error', 'A scene needs a name');
      return false;
    }
    doc.transact(name !== undefined ? 'Rename Scene' : 'Scene Properties', () => {
      updateSceneMutation(doc, id, {
        ...(name !== undefined ? { name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.includeInAnimation !== undefined ? { includeInAnimation: patch.includeInAnimation } : {}),
      });
    });
    return true;
  }

  removeScene(id: SceneId | null = this.activeSceneId): void {
    const doc = this.session.doc;
    if (id === null || !doc.scene(id)) return;
    doc.transact('Delete Scene', () => {
      removeSceneMutation(doc, id);
    });
    if (this.#activeSceneId === id) this.#activeSceneId = null;
    this.#emit({ kind: 'scenes' });
  }

  /** Moves a scene earlier (−1) or later (+1) in the list. */
  moveScene(id: SceneId, offset: -1 | 1): void {
    const doc = this.session.doc;
    const order = doc.scenes.map((scene) => scene.id);
    const index = order.indexOf(id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= order.length) return;
    order.splice(index, 1);
    order.splice(target, 0, id);
    doc.transact('Move Scene', () => {
      reorderScenes(doc, order);
    });
  }

  /**
   * Shows a scene: tag visibility, section planes, shadows and axes change in one undoable step, and the camera
   * moves there over the transition time (instantly with reduced motion). Camera moves are not undoable.
   */
  applyScene(id: SceneId): void {
    if (this.#animationPlaying) this.stopAnimation();
    this.#showScene(id, () => undefined);
  }

  /** Applies the next (or previous) scene after the active one. */
  applyAdjacentScene(offset: -1 | 1): void {
    const scenes = this.session.doc.scenes;
    if (scenes.length === 0) return;
    const index = scenes.findIndex((scene) => scene.id === this.activeSceneId);
    const next = scenes[(index + offset + scenes.length) % scenes.length] ?? scenes[0];
    if (next) this.applyScene(next.id);
  }

  /** Cycles through the scenes included in the animation until stopped (Escape stops it). */
  playAnimation(): void {
    const included = this.session.doc.scenes.filter((scene) => scene.includeInAnimation);
    if (included.length === 0) {
      this.notify('info', 'Add scenes and include them in the animation first');
      return;
    }
    this.stopAnimation();
    this.tools.cancel();
    this.#animationPlaying = true;
    this.#emit({ kind: 'scenes' });
    const step = (): void => {
      if (!this.#animationPlaying) return;
      const scenes = this.session.doc.scenes.filter((scene) => scene.includeInAnimation);
      if (scenes.length === 0) {
        this.stopAnimation();
        return;
      }
      const current = scenes.findIndex((scene) => scene.id === this.#activeSceneId);
      const next = scenes[(current + 1) % scenes.length] ?? scenes[0];
      if (!next) return;
      this.#showScene(next.id, () => {
        if (!this.#animationPlaying) return;
        this.#animationTimer = this.#clock.setTimer(() => {
          this.#animationTimer = null;
          step();
        }, this.#sceneDelaySeconds * 1000);
      });
    };
    step();
  }

  stopAnimation(): void {
    const wasPlaying = this.#animationPlaying;
    this.#animationPlaying = false;
    this.#cameraTransition.cancel();
    if (this.#animationTimer !== null) this.#clock.clearTimer(this.#animationTimer);
    this.#animationTimer = null;
    if (wasPlaying) this.#emit({ kind: 'scenes' });
  }

  #showScene(id: SceneId, onArrived: () => void): void {
    const { session } = this;
    const doc = session.doc;
    const scene = doc.scene(id);
    if (!scene) return;
    this.#activeSceneId = id;
    this.#emit({ kind: 'scenes' });
    try {
      doc.transact(`Show Scene ${scene.name}`, () => {
        applySceneModelState(doc, scene);
      });
    } catch (error) {
      this.notify('error', errorMessage(error));
    }
    const camera = sceneCamera(scene);
    if (!camera) {
      onArrived();
      return;
    }
    const reduced = (this.#environment.prefersReducedMotion ?? systemPrefersReducedMotion)();
    const duration = reduced ? 0 : this.#sceneTransitionSeconds * 1000;
    this.#cameraTransition.start(
      session.camera,
      camera,
      duration,
      (next) => {
        session.setCamera(next);
      },
      onArrived,
    );
  }

  // ---------------------------------------------------------------------------------------------- files

  get hasFileAccess(): boolean {
    return this.#environment.fileAccess !== undefined;
  }

  /** Where the previous version of a file is kept before saving over it. Without one, no backups are made. */
  setBackupRepository(repository: RecoveryRepository, sessionId: string): void {
    this.#backups = { repository, sessionId };
  }

  get hasBackups(): boolean {
    return this.#backups !== null;
  }

  setRecentFiles(recorder: RecentFilesRecorder): void {
    this.#recentFiles = recorder;
  }

  /** Replaces the model with a new one from a template. Resolves to false when the user keeps unsaved changes. */
  async newFromTemplate(templateId: string): Promise<boolean> {
    const template = templateById(templateId);
    if (!template) throw new Error(`Unknown template "${templateId}"`);
    if (!(await this.#confirmDiscard())) return false;
    this.tools.cancel();
    this.session.replaceDocument(template.create(), { name: UNTITLED_DOCUMENT_NAME });
    this.#lastSavedBytes = null;
    if (template.view) this.setStandardView(template.view);
    else this.session.setCamera(DEFAULT_CAMERA);
    return true;
  }

  /** Opens a recently used file again through its saved handle. */
  async openRecent(name: string, handle: unknown): Promise<boolean> {
    const access = this.#environment.fileAccess;
    if (!access?.openHandle) {
      this.notify('info', `Open ${name} again with File > Open`);
      return false;
    }
    if (!(await this.#confirmDiscard())) return false;
    const file = await access.openHandle(handle);
    if (!file) {
      this.notify('error', `${name} could not be opened. It may have been moved or deleted.`);
      return false;
    }
    const loaded = this.loadFile(file.bytes, file.name, file.handle);
    if (loaded) this.#recentFiles?.record(file.name, file.handle, readPlanarThumbnail(file.bytes));
    return loaded;
  }

  async newDocument(): Promise<void> {
    if (!(await this.#confirmDiscard())) return;
    this.tools.cancel();
    this.session.replaceDocument(new ModelDocument(), { name: UNTITLED_DOCUMENT_NAME });
    this.#lastSavedBytes = null;
    this.session.setCamera(DEFAULT_CAMERA);
  }

  async openSample(): Promise<void> {
    if (!(await this.#confirmDiscard())) return;
    this.tools.cancel();
    this.session.replaceDocument(createSampleModel(), { name: SAMPLE_MODEL_NAME });
    this.#lastSavedBytes = null;
    this.setStandardView('iso');
  }

  async openFile(): Promise<void> {
    const access = this.#environment.fileAccess;
    if (!access || !(await this.#confirmDiscard())) return;
    const file = await access.open();
    if (file && this.loadFile(file.bytes, file.name, file.handle))
      this.#recentFiles?.record(file.name, file.handle, readPlanarThumbnail(file.bytes));
  }

  /**
   * Replaces the document with the contents of a .planar file. A model with problems that can be fixed safely is
   * repaired and opens with unsaved changes, so the file itself is only rewritten when the user saves. Returns false
   * (and notifies) when the file can't be opened.
   */
  loadFile(
    bytes: Uint8Array,
    fileName: string,
    fileHandle: unknown = null,
    options: { dirty?: boolean } = {},
  ): boolean {
    const result = decodePlanarFile(bytes, {}, { repair: true });
    if (!result.ok) {
      this.notify('error', `Could not open ${fileName}: ${result.error}`);
      return false;
    }
    const { doc, repairs } = result.value;
    this.tools.cancel();
    this.session.replaceDocument(doc, {
      name: withoutExtension(fileName),
      fileHandle,
      dirty: options.dirty === true || repairs.length > 0,
    });
    // After a repair the original bytes stay the last save, so saving in place first backs them up.
    this.#lastSavedBytes = options.dirty === true ? null : bytes;
    this.zoomExtents();
    if (repairs.length > 0) {
      const count = `${String(repairs.length)} ${repairs.length === 1 ? 'problem' : 'problems'}`;
      this.notify(
        'info',
        `Repaired ${count} in ${fileName}: ${repairs.slice(0, 3).join('; ')}${repairs.length > 3 ? '; …' : ''}. Save to keep the repaired model.`,
      );
    }
    return true;
  }

  /** The current document as .planar file bytes, with an optional PNG preview. */
  encodeDocument(thumbnail?: Uint8Array): Uint8Array {
    return encodePlanarFile(this.session.doc, {
      appVersion: this.appVersion,
      now: new Date(),
      ...(thumbnail ? { thumbnail } : {}),
    });
  }

  /** A small PNG of the current view for the saved file, or undefined when no view is attached or capture fails. */
  async #captureThumbnail(): Promise<Uint8Array | undefined> {
    const capture = this.exchange.viewCapture;
    if (!capture?.available) return undefined;
    try {
      const blob = await capture.capture({
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        transparentBackground: false,
      });
      return new Uint8Array(await blob.arrayBuffer());
    } catch {
      // A preview is optional; the model is saved without one.
      return undefined;
    }
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
    const bytes = this.encodeDocument(await this.#captureThumbnail());
    if (!chooseLocation && session.fileHandle !== null) await this.#backUpLastSave();
    const result = await access.save(
      bytes,
      `${session.documentName}${PLANAR_FILE_EXTENSION}`,
      chooseLocation ? null : session.fileHandle,
    );
    if (!result) return false;
    this.#lastSavedBytes = bytes;
    session.markSaved(withoutExtension(result.name), result.handle);
    this.#recentFiles?.record(result.name, result.handle, readPlanarThumbnail(bytes));
    this.notify('info', `Saved ${result.name}`);
    return true;
  }

  /** Keeps the previously saved version of the file as a local backup before it is overwritten. */
  async #backUpLastSave(): Promise<void> {
    const backups = this.#backups;
    const previous = this.#lastSavedBytes;
    if (!backups || !previous) return;
    const savedAt = Date.now();
    try {
      await backups.repository.put({
        id: recoverySnapshotId(backups.sessionId, 'backup', savedAt),
        sessionId: backups.sessionId,
        kind: 'backup',
        documentName: this.session.documentName,
        savedAt,
        bytes: previous,
      });
      await backups.repository.prune(DEFAULT_RETENTION);
    } catch (error) {
      this.notify('error', `Could not keep a backup of the previous save: ${errorMessage(error)}`);
    }
  }

  async #confirmDiscard(): Promise<boolean> {
    const confirm = this.#environment.confirmDiscardChanges;
    return !this.session.isDirty || !confirm || confirm(this.session.documentName);
  }

  // ---------------------------------------------------------------------------------------------- dock layout

  #dockLayout: DockLayout = DEFAULT_DOCK_LAYOUT;
  #dockLayoutStorage: DockLayoutStorage | null = null;
  #panelFocusRequest: PanelFocusRequest | null = null;

  /** Width of the dock, the order of its panels and which are collapsed. Kept on this device. */
  get dockLayout(): DockLayout {
    return this.#dockLayout;
  }

  /** Loads the dock layout from storage, and saves later changes there. */
  setDockLayoutStorage(storage: DockLayoutStorage): void {
    this.#dockLayoutStorage = storage;
    this.#applyDockLayout(storage.load(), false);
  }

  /** Sets the dock width before the interface scale is applied, in CSS pixels; null restores the default. */
  setDockWidth(width: number | null): void {
    this.#applyDockLayout(withDockWidth(this.#dockLayout, width), true);
  }

  /** Moves a panel above (−1) or below (+1) the nearest shown panel. */
  movePanel(panel: PanelId, offset: -1 | 1): void {
    this.#applyDockLayout(moveDockPanel(this.#dockLayout, panel, offset, this.#openPanels), true);
  }

  /** Puts a panel just before or after another one (dropping a dragged panel). */
  movePanelTo(panel: PanelId, target: PanelId, placement: DropPlacement): void {
    this.#applyDockLayout(moveDockPanelTo(this.#dockLayout, panel, target, placement), true);
  }

  isPanelCollapsed(panel: PanelId): boolean {
    return this.#dockLayout.collapsed.includes(panel);
  }

  setPanelCollapsed(panel: PanelId, collapsed: boolean): void {
    this.#applyDockLayout(withPanelCollapsed(this.#dockLayout, panel, collapsed), true);
  }

  /** The latest request to bring a panel into view. */
  get panelFocusRequest(): PanelFocusRequest | null {
    return this.#panelFocusRequest;
  }

  /** Shows and expands a panel, and asks the UI to scroll it into view and focus it. */
  focusPanel(panel: PanelId): void {
    this.setPanelOpen(panel, true);
    if (this.isPanelCollapsed(panel)) this.setPanelCollapsed(panel, false);
    this.#panelFocusRequest = { panel, serial: (this.#panelFocusRequest?.serial ?? 0) + 1 };
    this.#emit({ kind: 'panels' });
  }

  /** Shows the default panels in their default order, expanded, at the default dock width. */
  resetDockLayout(): void {
    this.#openPanels = DEFAULT_OPEN_PANELS;
    this.#applyDockLayout(DEFAULT_DOCK_LAYOUT, true);
  }

  #applyDockLayout(layout: DockLayout, persist: boolean): void {
    this.#dockLayout = layout;
    if (persist) {
      try {
        this.#dockLayoutStorage?.save(layout);
      } catch (error) {
        this.notify('error', `Could not save the panel layout: ${errorMessage(error)}`);
      }
    }
    this.#emit({ kind: 'panels' });
  }

  #emit(event: EditorEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}
