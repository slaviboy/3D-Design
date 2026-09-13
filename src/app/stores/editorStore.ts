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

import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AnnotationId, DefinitionId } from '../../kernel/ids';
import type { AnnotationKind, SceneData, ShadowSettings } from '../../kernel/model/types';
import type { EnvironmentSettings, FogSettings, NamedStyle, StyleSettings } from '../../kernel/model/types';
import type { UnitSettings } from '../../kernel/units/units';
import type { Preferences } from '../preferences/preferences';
import { collectAnnotationLabels, type AnnotationLabel } from '../annotations/annotationLabels';
import { projectToScreen, type Projection } from '../camera/camera';
import type { Editor, EditorNotification, InputRequest } from '../Editor';
import type { ExchangeRequest } from '../io/ModelExchange';
import type { InferenceKind } from '../inference/inference';
import type { PanelId } from '../panels/panels';
import type { ToolOverlay } from '../tools/Tool';
import type { DockLayout, PanelFocusRequest } from '../dock/dockLayout';

/** A dimension or text label in viewport pixels. */
export interface ScreenAnnotationLabel {
  readonly key: string;
  readonly context: DefinitionId;
  readonly id: AnnotationId;
  readonly kind: AnnotationKind;
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

/** The inference marker in viewport pixels. */
export interface ScreenMarker {
  readonly x: number;
  readonly y: number;
  readonly kind: InferenceKind;
  readonly label: string;
}

/** Flat, UI-facing snapshot of editor state. Components subscribe to individual fields. */
export interface EditorViewState {
  readonly revision: number;
  readonly documentName: string;
  readonly isDirty: boolean;
  readonly canUndo: boolean;
  readonly undoLabel: string | undefined;
  readonly canRedo: boolean;
  readonly redoLabel: string | undefined;
  readonly selectionTotal: number;
  readonly selectionFaces: number;
  readonly selectionEdges: number;
  readonly selectionInstances: number;
  readonly selectionVersion: number;
  readonly activeToolId: string;
  readonly statusHint: string;
  readonly overlay: ToolOverlay | null;
  readonly marker: ScreenMarker | null;
  /** Label of the active tool's measurements box, or null when the tool has none. */
  readonly measurementLabel: string | null;
  readonly measurementValue: string;
  /** Text typed but not yet entered; shown instead of the value while non-empty. */
  readonly measurementText: string;
  /** Number of open groups and components. */
  readonly editDepth: number;
  readonly projection: Projection;
  readonly notifications: readonly EditorNotification[];
  /** Increments each time something asks for the command palette. */
  readonly commandPaletteRequests: number;
  /** Increments each time something asks for the backups list. */
  readonly backupRequests: number;
  /** Increments each time something asks for the start screen. */
  readonly startScreenRequests: number;
  /** Increments each time something asks for the Keyboard Shortcuts dialog. */
  readonly shortcutsDialogRequests: number;
  /** Increments whenever shortcuts change, so labels that show them refresh. */
  readonly shortcutsVersion: number;
  /** Increments each time something asks for the Preferences dialog. */
  readonly preferencesDialogRequests: number;
  readonly preferences: Preferences;
  /** The tag new groups and components go on; null for untagged. */
  readonly activeTagId: number | null;
  /** Instance ids of the open groups and components, outermost first. */
  readonly editPath: readonly number[];
  /** Panels shown in the dock. */
  readonly openPanels: readonly PanelId[];
  /** A question the editor is waiting for the user to answer. */
  readonly inputRequest: InputRequest | null;
  /** Dimension and text labels in viewport pixels. */
  readonly annotationLabels: readonly ScreenAnnotationLabel[];
  /** An import or export dialog, or import progress. */
  readonly exchangeRequest: ExchangeRequest | null;
  /** The material the Paint Bucket applies; null for the default material. */
  readonly activeMaterialId: number | null;
  /** Selected section planes. */
  readonly selectionSections: number;
  /** Scenes in display order (replaced whenever a scene changes). */
  readonly scenes: readonly SceneData[];
  readonly activeSceneId: number | null;
  readonly animationPlaying: boolean;
  readonly sceneTransitionSeconds: number;
  readonly sceneDelaySeconds: number;
  readonly shadows: ShadowSettings;
  readonly showSectionPlanes: boolean;
  readonly showSectionCuts: boolean;
  readonly style: StyleSettings;
  /** Styles saved in the model (replaced whenever they change). */
  readonly inModelStyles: readonly NamedStyle[];
  readonly fog: FogSettings;
  readonly environment: EnvironmentSettings;
  /** Name of the environment image loaded in this session, or null. */
  readonly environmentImageName: string | null;
  /** Width of the dock, the order of its panels and which are collapsed. */
  readonly dockLayout: DockLayout;
  /** The latest request to bring a panel into view. */
  readonly panelFocusRequest: PanelFocusRequest | null;
  /** Increments each time something asks for the 3D Text dialog. */
  readonly text3dDialogRequests: number;
}

export interface EditorStore extends StoreApi<EditorViewState> {
  dispose(): void;
}

/** Keeps a zustand store in sync with the editor's session, tools and notifications. */
export function createEditorStore(editor: Editor): EditorStore {
  let selectionVersion = 0;
  let commandPaletteRequests = 0;
  let backupRequests = 0;
  let startScreenRequests = 0;
  let shortcutsDialogRequests = 0;
  let shortcutsVersion = 0;
  let preferencesDialogRequests = 0;
  let text3dDialogRequests = 0;
  let labelsUnits: UnitSettings | null = null;
  let labelsRevision = -1;
  let worldLabels: readonly AnnotationLabel[] = [];
  // Labels are collected when the model changes and projected on every refresh, since the camera moves often.
  const screenLabels = (): ScreenAnnotationLabel[] => {
    const { session } = editor;
    if (session.revision !== labelsRevision || editor.units !== labelsUnits) {
      worldLabels = collectAnnotationLabels(session.doc, editor.units);
      labelsRevision = session.revision;
      labelsUnits = editor.units;
    }
    const size = editor.viewportSize;
    const result: ScreenAnnotationLabel[] = [];
    for (const label of worldLabels) {
      const position = label.screen
        ? { x: label.screen.x * size.width, y: label.screen.y * size.height }
        : label.world
          ? projectToScreen(session.camera, label.world, size)
          : null;
      if (!position) continue;
      result.push({
        key: label.key,
        context: label.context,
        id: label.id,
        kind: label.kind,
        text: label.text,
        x: position.x,
        y: position.y,
      });
    }
    return result;
  };
  const snapshot = (): EditorViewState => {
    const { session, tools } = editor;
    const { doc, selection } = session;
    const measurement = tools.measurement;
    const previewMarker = session.preview?.marker ?? null;
    const projected = previewMarker
      ? projectToScreen(session.camera, previewMarker.point, editor.viewportSize)
      : null;
    return {
      revision: session.revision,
      documentName: session.documentName,
      isDirty: session.isDirty,
      canUndo: doc.canUndo,
      undoLabel: doc.undoLabel,
      canRedo: doc.canRedo,
      redoLabel: doc.redoLabel,
      selectionTotal: selection.size,
      selectionFaces: selection.count('face'),
      selectionEdges: selection.count('edge'),
      selectionInstances: selection.count('instance'),
      selectionVersion,
      activeToolId: tools.activeToolId,
      statusHint: tools.statusHint,
      overlay: tools.overlay,
      marker:
        previewMarker && projected
          ? { x: projected.x, y: projected.y, kind: previewMarker.kind, label: previewMarker.label }
          : null,
      measurementLabel: measurement?.label ?? null,
      measurementValue: measurement?.value ?? '',
      measurementText: editor.measurementText,
      editDepth: session.editPath.length,
      projection: session.camera.projection,
      notifications: editor.notifications,
      commandPaletteRequests,
      backupRequests,
      startScreenRequests,
      shortcutsDialogRequests,
      shortcutsVersion,
      preferencesDialogRequests,
      preferences: editor.preferences,
      activeTagId: session.activeTagId,
      editPath: session.editPath,
      openPanels: editor.openPanels,
      inputRequest: editor.inputRequest,
      annotationLabels: screenLabels(),
      exchangeRequest: editor.exchange.request,
      activeMaterialId: session.activeMaterialId,
      selectionSections: selection.count('section'),
      scenes: doc.scenes,
      activeSceneId: editor.activeSceneId,
      animationPlaying: editor.isAnimationPlaying,
      sceneTransitionSeconds: editor.sceneTransitionSeconds,
      sceneDelaySeconds: editor.sceneDelaySeconds,
      shadows: doc.shadows,
      showSectionPlanes: session.showSectionPlanes,
      showSectionCuts: session.showSectionCuts,
      style: doc.style,
      inModelStyles: doc.inModelStyles,
      fog: doc.fog,
      environment: doc.environment,
      environmentImageName: session.environmentImage?.name ?? null,
      dockLayout: editor.dockLayout,
      panelFocusRequest: editor.panelFocusRequest,
      text3dDialogRequests,
    };
  };
  const store = createStore<EditorViewState>(snapshot);
  const refresh = (): void => {
    store.setState(snapshot());
  };
  const unsubscribers = [
    editor.session.subscribe((event) => {
      if (event.kind === 'selection' || event.kind === 'document') selectionVersion++;
      refresh();
    }),
    editor.tools.subscribe(refresh),
    editor.subscribe((event) => {
      if (event.kind === 'shortcuts') shortcutsVersion++;
      if (event.kind === 'ui-request') {
        if (event.request === 'backups') backupRequests++;
        else if (event.request === 'start') startScreenRequests++;
        else if (event.request === 'shortcuts') shortcutsDialogRequests++;
        else if (event.request === 'preferences') preferencesDialogRequests++;
        else if (event.request === 'text3d') text3dDialogRequests++;
        else commandPaletteRequests++;
      }
      refresh();
    }),
    editor.exchange.subscribe(refresh),
  ];
  return Object.assign(store, {
    dispose: () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    },
  });
}
