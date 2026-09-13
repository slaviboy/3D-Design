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

import type { AssetId, DefinitionId, FaceId, MaterialId } from '../ids';
import { IDENTITY, multiply, transformDirection, type Mat4 } from '../math/mat4';
import { planeBasis } from '../math/plane';
import { AXIS_X, AXIS_Y, AXIS_Z, cross, dot, length, normalize, type Vec3 } from '../math/vec3';
import type { EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import {
  removeMaterial,
  removeTextureAsset,
  setEdgeAttributes,
  setFaceAttributes,
  setInstanceAttributes,
} from '../model/mutations';
import type { FaceAttributes, MaterialTexture, TexturePlacement } from '../model/types';
import { isParallelBySine } from '../tolerance';
import { faceArea } from './planar/regions';

export type FaceSide = 'front' | 'back';

/** The material painted on one side of a face. */
export function sideMaterial(attributes: FaceAttributes, side: FaceSide): MaterialId | null {
  return side === 'front' ? attributes.frontMaterialId : attributes.backMaterialId;
}

/** The texture placement of one side of a face. */
export function sidePlacement(attributes: FaceAttributes, side: FaceSide): TexturePlacement | null {
  return side === 'front' ? attributes.frontTexturePlacement : attributes.backTexturePlacement;
}

/** A face attribute patch that paints one side. */
export function paintSidePatch(side: FaceSide, materialId: MaterialId | null): Partial<FaceAttributes> {
  return side === 'front' ? { frontMaterialId: materialId } : { backMaterialId: materialId };
}

// -------------------------------------------------------------------------------------------------- projection

export interface TextureAxes {
  /** Unit direction of the texture's horizontal axis in the face plane. */
  readonly u: Vec3;
  /** Unit direction of the texture's vertical axis in the face plane. */
  readonly v: Vec3;
}

/**
 * The default planar projection axes for a face normal. Horizontal faces use the red and green axes, so textures
 * line up with the model. Other faces use a horizontal `u` and a `v` that points up the slope, so images on walls
 * stand upright.
 */
export function textureAxes(normal: Vec3): TextureAxes {
  if (isParallelBySine(length(cross(normal, AXIS_Z)))) return { u: AXIS_X, v: AXIS_Y };
  const u = normalize(cross(AXIS_Z, normal));
  if (!u) return planeBasis(normal);
  return { u, v: cross(normal, u) };
}

/**
 * Texture-space coordinates of a point on a face, in meters: projected onto the texture axes, then moved, rotated
 * and scaled by the placement.
 */
export function textureCoordinates(
  point: Vec3,
  axes: TextureAxes,
  placement: TexturePlacement | null,
): { readonly x: number; readonly y: number } {
  const x0 = dot(point, axes.u);
  const y0 = dot(point, axes.v);
  if (!placement) return { x: x0, y: y0 };
  const x1 = x0 - placement.offsetX;
  const y1 = y0 - placement.offsetY;
  const cos = Math.cos(placement.rotation);
  const sin = Math.sin(placement.rotation);
  return { x: (cos * x1 + sin * y1) / placement.scaleX, y: (-sin * x1 + cos * y1) / placement.scaleY };
}

/** Texture UV of a point: texture coordinates divided by the tile size, so one tile spans 0 to 1. */
export function textureUv(
  point: Vec3,
  axes: TextureAxes,
  texture: Pick<MaterialTexture, 'width' | 'height'>,
  placement: TexturePlacement | null,
): { readonly u: number; readonly v: number } {
  const { x, y } = textureCoordinates(point, axes, placement);
  return { u: x / texture.width, v: y / texture.height };
}

// -------------------------------------------------------------------------------------------------- usage

/** How many face sides, edges and instances use each material, across every definition. */
export function materialUsage(doc: ModelDocument): Map<MaterialId, number> {
  const usage = new Map<MaterialId, number>();
  const count = (id: MaterialId | null): void => {
    if (id !== null) usage.set(id, (usage.get(id) ?? 0) + 1);
  };
  for (const { store } of doc.definitions()) {
    for (const face of store.faces()) {
      count(face.attributes.frontMaterialId);
      count(face.attributes.backMaterialId);
    }
    for (const edge of store.edges()) count(edge.attributes.materialId);
    for (const instance of store.instances()) count(instance.attributes.materialId);
  }
  return usage;
}

/** Removes texture assets that no material uses. Must run inside a transaction. Returns the removed ids. */
export function removeUnusedTextureAssets(doc: ModelDocument): AssetId[] {
  const used = new Set<AssetId>();
  for (const material of doc.materials()) if (material.texture) used.add(material.texture.assetId);
  const unused = [...doc.assets()].map((asset) => asset.id).filter((id) => !used.has(id));
  for (const id of unused) removeTextureAsset(doc, id);
  return unused;
}

/**
 * Deletes a material. Faces, edges, groups and components that used it go back to the default material, and its
 * texture image is removed when no other material shares it.
 */
export function deleteMaterial(doc: ModelDocument, materialId: MaterialId): void {
  doc.transact('Delete Material', () => {
    for (const { id: context, store } of doc.definitions()) {
      for (const face of store.faces()) {
        const patch: Partial<FaceAttributes> = {
          ...(face.attributes.frontMaterialId === materialId ? { frontMaterialId: null } : {}),
          ...(face.attributes.backMaterialId === materialId ? { backMaterialId: null } : {}),
        };
        if (Object.keys(patch).length > 0) setFaceAttributes(doc, context, face.id, patch);
      }
      for (const edge of store.edges()) {
        if (edge.attributes.materialId === materialId) {
          setEdgeAttributes(doc, context, edge.id, { materialId: null });
        }
      }
      for (const instance of store.instances()) {
        if (instance.attributes.materialId === materialId) {
          setInstanceAttributes(doc, context, instance.id, { materialId: null });
        }
      }
    }
    removeMaterial(doc, materialId);
    removeUnusedTextureAssets(doc);
  });
}

/** Deletes every material nothing uses, and texture images no material uses. Returns the deleted material ids. */
export function purgeUnusedMaterials(doc: ModelDocument): MaterialId[] {
  return doc.transact('Purge Unused Materials', () => {
    const usage = materialUsage(doc);
    const unused = [...doc.materials()].map((material) => material.id).filter((id) => !usage.has(id));
    for (const id of unused) removeMaterial(doc, id);
    removeUnusedTextureAssets(doc);
    return unused;
  });
}

// -------------------------------------------------------------------------------------------------- area

interface Placement {
  readonly toWorld: Mat4;
  /** Material of the innermost painted instance around this placement, which default faces show. */
  readonly inherited: MaterialId | null;
}

/** Every placement of every definition in the model, found by walking the instance tree from the root. */
function definitionPlacements(doc: ModelDocument): Map<DefinitionId, Placement[]> {
  const placements = new Map<DefinitionId, Placement[]>();
  const walk = (definitionId: DefinitionId, placement: Placement, ancestors: Set<DefinitionId>): void => {
    if (ancestors.has(definitionId) || !doc.definition(definitionId)) return;
    let list = placements.get(definitionId);
    if (!list) placements.set(definitionId, (list = []));
    list.push(placement);
    const nested = new Set(ancestors).add(definitionId);
    for (const instance of doc.store(definitionId).instances()) {
      walk(
        instance.definitionId,
        {
          toWorld: multiply(placement.toWorld, instance.transform),
          inherited: instance.attributes.materialId ?? placement.inherited,
        },
        nested,
      );
    }
  };
  walk(doc.rootDefinitionId, { toWorld: IDENTITY, inherited: null }, new Set());
  return placements;
}

/** Factor by which a transform scales areas in the plane with this unit normal. */
function areaScale(store: EntityStore, faceId: FaceId, toWorld: Mat4): number {
  if (toWorld === IDENTITY) return 1;
  const plane = store.getFace(faceId).plane;
  if (!plane) return 0;
  const { u, v } = planeBasis(plane.normal);
  return length(cross(transformDirection(toWorld, u), transformDirection(toWorld, v)));
}

/**
 * Total world-space area painted with each material, in square meters. A face counts once per placement of its
 * definition (so a component placed three times counts three times), scaled by that placement's transform. A face
 * counts once for each distinct material on its sides; faces with no material count toward the material of the
 * innermost painted group or component around them, which is what they show.
 */
export function materialAreas(doc: ModelDocument): Map<MaterialId, number> {
  const areas = new Map<MaterialId, number>();
  for (const [definitionId, placements] of definitionPlacements(doc)) {
    const store = doc.store(definitionId);
    for (const face of store.faces()) {
      const { frontMaterialId, backMaterialId } = face.attributes;
      const own = new Set([frontMaterialId, backMaterialId]);
      const hasDefaultSide = own.has(null);
      own.delete(null);
      if (own.size === 0 && placements.every((placement) => placement.inherited === null)) continue;
      const local = faceArea(store, face.id);
      for (const placement of placements) {
        const materials = new Set(own);
        if (hasDefaultSide && placement.inherited !== null) materials.add(placement.inherited);
        if (materials.size === 0) continue;
        const area = local * areaScale(store, face.id, placement.toWorld);
        for (const id of materials) if (id !== null) areas.set(id, (areas.get(id) ?? 0) + area);
      }
    }
  }
  return areas;
}

// -------------------------------------------------------------------------------------------------- neighbours

/**
 * Faces reachable from `start` by crossing shared edges, including `start`, visiting only faces that pass
 * `include`. Sorted by id.
 */
export function connectedFaces(
  store: EntityStore,
  start: FaceId,
  include: (faceId: FaceId) => boolean = () => true,
): FaceId[] {
  if (!store.face(start) || !include(start)) return [];
  const seen = new Set<FaceId>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const faceId = stack.pop();
    if (faceId === undefined) break;
    for (const edgeId of store.faceEdges(faceId)) {
      for (const neighbour of store.getEdge(edgeId).faces) {
        if (seen.has(neighbour) || !include(neighbour)) continue;
        seen.add(neighbour);
        stack.push(neighbour);
      }
    }
  }
  return [...seen].sort((a, b) => a - b);
}
