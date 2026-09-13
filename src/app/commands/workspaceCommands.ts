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

import type { EdgeId, FaceId, InstanceId, MaterialId, TagId } from '../../kernel/ids';
import type { EntityStore } from '../../kernel/model/EntityStore';
import {
  reverseFace,
  setEdgeAttributes,
  setFaceAttributes,
  setInstanceAttributes,
} from '../../kernel/model/mutations';
import { zoomToBounds } from '../camera/camera';
import { summarizeSelection } from '../contextMenu/contextMenu';
import type { Editor } from '../Editor';
import { transformAabb } from '../geometry/bounds';
import { allSelectableRefs, connectedGeometry, faceWithBoundaryEdges } from '../selection/queries';
import { Selection, type EntityRef } from '../selection/Selection';
import { selectionBounds, transformSelectionOf } from '../tools/transformSupport';
import type { CommandRegistry } from './CommandRegistry';

const count = (editor: Editor, ...kinds: ('face' | 'edge' | 'instance' | 'section')[]): number =>
  kinds.reduce((total, kind) => total + editor.session.selection.count(kind), 0);

const activeStore = (editor: Editor): EntityStore => editor.session.doc.store(editor.session.activeContext);

const refKey = (ref: EntityRef): string => `${ref.kind}:${String(ref.id)}`;

function tagOf(store: EntityStore, ref: EntityRef): TagId | null | undefined {
  switch (ref.kind) {
    case 'face':
      return store.face(ref.id as FaceId)?.attributes.tagId;
    case 'edge':
      return store.edge(ref.id as EdgeId)?.attributes.tagId;
    case 'instance':
      return store.instance(ref.id as InstanceId)?.attributes.tagId;
    case 'section':
      return undefined;
  }
}

/** Hidden faces, edges, groups and components of the open context. */
function hiddenInContext(store: EntityStore): { faces: FaceId[]; edges: EdgeId[]; instances: InstanceId[] } {
  return {
    faces: [...store.faces()].filter((face) => face.attributes.hidden).map((face) => face.id),
    edges: [...store.edges()].filter((edge) => edge.attributes.hidden).map((edge) => edge.id),
    instances: [...store.instances()]
      .filter((instance) => instance.attributes.hidden)
      .map((instance) => instance.id),
  };
}

function hasHiddenInContext(store: EntityStore): boolean {
  for (const instance of store.instances()) if (instance.attributes.hidden) return true;
  for (const face of store.faces()) if (face.attributes.hidden) return true;
  for (const edge of store.edges()) if (edge.attributes.hidden) return true;
  return false;
}

/** Bounds of the selection in world coordinates, or null when it has no geometry. */
function selectionWorldBounds(editor: Editor) {
  const { session } = editor;
  const box = selectionBounds(editor, transformSelectionOf(session.selection));
  return box ? transformAabb(box, session.activeContextTransform) : null;
}

function reverseSelectedFaces(editor: Editor): void {
  const { session } = editor;
  const doc = session.doc;
  const context = session.activeContext;
  const store = doc.store(context);
  const faces = session.selection.ids('face') as FaceId[];
  editor.tools.cancel();
  doc.transact('Reverse Faces', () => {
    for (const id of faces) {
      const face = store.face(id);
      if (!face) continue;
      const attributes = face.attributes;
      reverseFace(doc, context, id);
      // The sides trade places, so each keeps the material and texture placement it showed.
      setFaceAttributes(doc, context, id, {
        frontMaterialId: attributes.backMaterialId,
        backMaterialId: attributes.frontMaterialId,
        frontTexturePlacement: attributes.backTexturePlacement,
        backTexturePlacement: attributes.frontTexturePlacement,
      });
    }
  });
}

/** Commands behind the context menus and the dock: selection helpers, visibility, faces, and panel layout. */
export function registerWorkspaceCommands(registry: CommandRegistry<Editor>): void {
  registry.register(
    {
      id: 'edit.entityInfo',
      label: 'Entity Info',
      category: 'Window',
      description: 'Show the Entity Info panel for the selection',
      aliases: ['properties', 'inspector'],
      run: (editor) => {
        editor.focusPanel('entityInfo');
      },
    },
    {
      id: 'edit.hide',
      label: 'Hide',
      category: 'Edit',
      description: 'Hide the selected faces, edges, groups and components',
      aliases: ['hide selection', 'conceal'],
      isEnabled: (editor) => {
        const summary = summarizeSelection(editor);
        return count(editor, 'face', 'edge', 'instance') > summary.hidden;
      },
      run: (editor) => {
        editor.updateSelectionAttributes({ hidden: true });
        editor.clearSelection();
      },
    },
    {
      id: 'edit.unhide',
      label: 'Unhide',
      category: 'Edit',
      description: 'Show the selected hidden entities again',
      aliases: ['show selection'],
      isEnabled: (editor) => summarizeSelection(editor).hidden > 0,
      run: (editor) => {
        editor.updateSelectionAttributes({ hidden: false });
      },
    },
    {
      id: 'edit.unhideAll',
      label: 'Unhide All',
      category: 'Edit',
      description: 'Show every hidden face, edge, group and component in the open context',
      aliases: ['show all', 'show hidden'],
      isEnabled: (editor) => hasHiddenInContext(activeStore(editor)),
      run: (editor) => {
        const { session } = editor;
        const doc = session.doc;
        const context = session.activeContext;
        const hidden = hiddenInContext(doc.store(context));
        doc.transact('Unhide All', () => {
          for (const id of hidden.instances) setInstanceAttributes(doc, context, id, { hidden: false });
          for (const id of hidden.faces) setFaceAttributes(doc, context, id, { hidden: false });
          for (const id of hidden.edges) setEdgeAttributes(doc, context, id, { hidden: false });
        });
      },
    },
    {
      id: 'select.connected',
      label: 'Select All Connected',
      category: 'Edit',
      description: 'Add every face and edge connected to the selected geometry',
      aliases: ['connected geometry', 'grow selection'],
      isEnabled: (editor) => count(editor, 'face', 'edge') > 0,
      run: (editor) => {
        const { session } = editor;
        const store = activeStore(editor);
        const result = new Map<string, EntityRef>();
        for (const ref of session.selection.refs()) {
          if (result.has(refKey(ref))) continue;
          const refs = ref.kind === 'face' || ref.kind === 'edge' ? connectedGeometry(store, ref) : [ref];
          for (const connected of refs) result.set(refKey(connected), connected);
        }
        session.setSelection(Selection.of(result.values()));
      },
    },
    {
      id: 'select.boundingEdges',
      label: 'Select Bounding Edges',
      category: 'Edit',
      description: 'Add the edges around the selected faces',
      aliases: ['face edges', 'outline'],
      isEnabled: (editor) => count(editor, 'face') > 0,
      run: (editor) => {
        const { session } = editor;
        const store = activeStore(editor);
        const edges = (session.selection.ids('face') as FaceId[]).flatMap((id) =>
          store.face(id) ? faceWithBoundaryEdges(store, id) : [],
        );
        session.setSelection(session.selection.union(edges));
      },
    },
    {
      id: 'select.sameTag',
      label: 'Select All on Same Tag',
      category: 'Edit',
      description: 'Select everything here that is on the same tags as the selection',
      aliases: ['same layer', 'select by tag'],
      isEnabled: (editor) => count(editor, 'face', 'edge', 'instance') > 0,
      run: (editor) => {
        const { session } = editor;
        const store = activeStore(editor);
        const tags = new Set<TagId | null>();
        for (const ref of session.selection.refs()) {
          const tag = tagOf(store, ref);
          if (tag !== undefined) tags.add(tag);
        }
        const refs = allSelectableRefs(store, session.doc).filter((ref) => {
          const tag = tagOf(store, ref);
          return tag !== undefined && tags.has(tag);
        });
        session.setSelection(Selection.of(refs));
      },
    },
    {
      id: 'select.sameMaterial',
      label: 'Select All with Same Material',
      category: 'Edit',
      description: 'Select the faces, groups and components here that use the same material as the selection',
      aliases: ['same color', 'select by material'],
      isEnabled: (editor) => count(editor, 'face', 'instance') > 0,
      run: (editor) => {
        const { session } = editor;
        const store = activeStore(editor);
        const materials = new Set<MaterialId | null>();
        for (const id of session.selection.ids('face')) {
          const face = store.face(id as FaceId);
          if (face) materials.add(face.attributes.frontMaterialId);
        }
        for (const id of session.selection.ids('instance')) {
          const instance = store.instance(id as InstanceId);
          if (instance) materials.add(instance.attributes.materialId);
        }
        const refs = allSelectableRefs(store, session.doc).filter((ref) => {
          if (ref.kind === 'face') {
            const face = store.face(ref.id as FaceId);
            return face !== undefined && materials.has(face.attributes.frontMaterialId);
          }
          if (ref.kind === 'instance') {
            const instance = store.instance(ref.id as InstanceId);
            return instance !== undefined && materials.has(instance.attributes.materialId);
          }
          return false;
        });
        session.setSelection(Selection.of(refs));
      },
    },
    {
      id: 'select.invert',
      label: 'Invert Selection',
      category: 'Edit',
      description: 'Select everything here that is not selected, and deselect the rest',
      aliases: ['select inverse', 'swap selection'],
      run: (editor) => {
        const { session } = editor;
        const all = allSelectableRefs(activeStore(editor), session.doc);
        session.setSelection(Selection.of(all.filter((ref) => !session.selection.has(ref))));
      },
    },
    {
      id: 'edit.soften',
      label: 'Soften and Smooth Edges',
      category: 'Edit',
      description: 'Hide the selected edges and shade the faces on either side as one smooth surface',
      aliases: ['soften', 'smooth', 'hide edges'],
      isEnabled: (editor) => count(editor, 'edge') > 0,
      run: (editor) => {
        editor.updateSelectionAttributes({ soft: true, smooth: true });
      },
    },
    {
      id: 'edit.unsoften',
      label: 'Unsoften Edges',
      category: 'Edit',
      description: 'Show the selected soft edges again and stop smoothing across them',
      aliases: ['harden edges', 'unsmooth'],
      isEnabled: (editor) => summarizeSelection(editor).softEdges > 0,
      run: (editor) => {
        editor.updateSelectionAttributes({ soft: false, smooth: false });
      },
    },
    {
      id: 'edit.reverseFaces',
      label: 'Reverse Faces',
      category: 'Edit',
      description: 'Swap the front and back of the selected faces',
      aliases: ['flip faces', 'face orientation', 'normals'],
      isEnabled: (editor) => count(editor, 'face') > 0,
      run: reverseSelectedFaces,
    },
    {
      id: 'camera.zoomSelection',
      label: 'Zoom Selection',
      category: 'Camera',
      description: 'Fit the selection in the view',
      aliases: ['frame selection', 'focus'],
      isEnabled: (editor) => count(editor, 'face', 'edge', 'instance') > 0,
      run: (editor) => {
        const bounds = selectionWorldBounds(editor);
        if (!bounds) return;
        const { session } = editor;
        session.setCamera(zoomToBounds(session.camera, bounds, editor.viewportSize));
      },
    },
    {
      id: 'materials.sample',
      label: 'Sample Material',
      category: 'Edit',
      description: 'Make the material of the selected face, group or component the active material',
      aliases: ['eyedropper', 'pick material', 'sample paint'],
      isEnabled: (editor) => editor.session.selection.size === 1 && count(editor, 'face', 'instance') === 1,
      run: (editor) => {
        const store = activeStore(editor);
        const [faceId] = editor.session.selection.ids('face');
        const [instanceId] = editor.session.selection.ids('instance');
        const material =
          faceId !== undefined
            ? store.face(faceId as FaceId)?.attributes.frontMaterialId
            : instanceId !== undefined
              ? store.instance(instanceId as InstanceId)?.attributes.materialId
              : undefined;
        if (material !== undefined) editor.setActiveMaterial(material);
      },
    },
    {
      id: 'window.resetPanels',
      label: 'Reset Panels',
      category: 'Window',
      description: 'Restore the default panels, their order, and the width of the dock',
      aliases: ['reset dock', 'default layout', 'restore panels', 'tray'],
      run: (editor) => {
        editor.resetDockLayout();
      },
    },
  );
}
