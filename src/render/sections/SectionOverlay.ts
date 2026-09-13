import * as THREE from 'three';
import type { DefinitionId } from '../../kernel/ids';
import type { Aabb } from '../../kernel/math/aabb';
import type { SectionPlaneView } from '../../kernel/model/EntityStore';
import {
  contextContentBounds,
  sectionCut,
  sectionRectangle,
  type SectionCut,
} from '../../kernel/ops/sections';
import type { ViewChange, ViewSource } from '../ViewSource';
import { ClippingMaterials } from './clipping';

/** Colors of section planes and cuts. */
export const SECTION_COLORS = Object.freeze({
  plane: 0x7a8fa8,
  outline: 0x44556b,
  activeOutline: 0xd4702b,
  selected: 0x1f66d6,
  fill: 0x3a4250,
});
const PLANE_OPACITY = 0.12;
/** Drawn after the model so the translucent rectangles blend over it. */
const SECTION_RENDER_ORDER = 5;

interface CachedCut {
  readonly plane: SectionPlaneView;
  readonly cut: SectionCut;
}

/**
 * Section planes in the view: clipping of the geometry in each context with an active plane (and everything nested
 * inside it), the filled cut outlines, and the plane rectangles. It works on the model renderer's tree after each
 * rebuild, reading `userData.definitionId` of the per-instance groups, so the model renderer needs no section code.
 */
export class SectionOverlay {
  /** World-space rectangles and fills, added to the scene next to the model. */
  readonly group = new THREE.Group();

  readonly #clipping = new ClippingMaterials();
  readonly #cuts = new Map<DefinitionId, CachedCut>();
  readonly #planeMaterial = new THREE.MeshBasicMaterial({
    color: SECTION_COLORS.plane,
    transparent: true,
    opacity: PLANE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  readonly #outlineMaterial = new THREE.LineBasicMaterial({ color: SECTION_COLORS.outline });
  readonly #activeOutlineMaterial = new THREE.LineBasicMaterial({ color: SECTION_COLORS.activeOutline });
  readonly #selectedOutlineMaterial = new THREE.LineBasicMaterial({ color: SECTION_COLORS.selected });
  readonly #fillMaterial = new THREE.MeshBasicMaterial({
    color: SECTION_COLORS.fill,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  constructor() {
    this.group.matrixAutoUpdate = false;
  }

  handleChange(change: ViewChange): void {
    if (change.kind === 'document' || change.kind === 'model') this.#cuts.clear();
  }

  /** Rebuilds rectangles and fills and re-applies clipping to the model tree. */
  update(source: ViewSource, modelRoot: THREE.Object3D): void {
    this.#clear();
    const doc = source.doc;
    modelRoot.updateMatrixWorld(true);
    const bounds = new Map<DefinitionId, Aabb>();
    const selected = new Set(
      source.selection
        .refs()
        .filter((ref) => ref.kind === 'section')
        .map((ref) => ref.id),
    );
    this.#clipping.begin();

    const visit = (node: THREE.Object3D, inherited: readonly THREE.Plane[]): void => {
      const definitionId = (node.userData as { definitionId?: DefinitionId }).definitionId;
      let planes = inherited;
      if (definitionId !== undefined && doc.definition(definitionId)) {
        const store = doc.store(definitionId);
        const active = source.showSectionCuts ? store.activeSectionPlane() : undefined;
        if (active) {
          const worldPlane = new THREE.Plane()
            .setFromNormalAndCoplanarPoint(
              new THREE.Vector3(-active.normal.x, -active.normal.y, -active.normal.z),
              new THREE.Vector3(active.point.x, active.point.y, active.point.z),
            )
            .applyMatrix4(node.matrixWorld);
          planes = [...inherited, worldPlane];
          this.#addFill(doc, definitionId, active, node.matrixWorld, inherited);
        }
        if (source.showSectionPlanes && store.sectionPlaneCount > 0) {
          const box = contextContentBounds(doc, definitionId, bounds);
          const isActiveContext = definitionId === source.activeContext;
          for (const plane of store.sectionPlanes()) {
            const outline =
              isActiveContext && selected.has(plane.id)
                ? this.#selectedOutlineMaterial
                : plane.active
                  ? this.#activeOutlineMaterial
                  : this.#outlineMaterial;
            this.#addRectangle(plane, box, node.matrixWorld, outline);
          }
        }
      }
      for (const child of node.children) {
        if ((child.userData as { definitionId?: DefinitionId }).definitionId !== undefined)
          visit(child, planes);
        else if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments)
          this.#clipping.apply(child, planes);
        else visit(child, planes);
      }
    };
    visit(modelRoot, []);
    this.#clipping.end();
  }

  dispose(): void {
    this.#clear();
    this.#clipping.dispose();
    for (const material of [
      this.#planeMaterial,
      this.#outlineMaterial,
      this.#activeOutlineMaterial,
      this.#selectedOutlineMaterial,
      this.#fillMaterial,
    ]) {
      material.dispose();
    }
  }

  #clear(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineLoop) {
        (object.geometry as THREE.BufferGeometry).dispose();
      }
    });
    this.group.clear();
  }

  #addRectangle(
    plane: SectionPlaneView,
    box: Aabb,
    world: THREE.Matrix4,
    outline: THREE.LineBasicMaterial,
  ): void {
    const corners = sectionRectangle(plane, box);
    const positions = corners.flatMap((corner) => [corner.x, corner.y, corner.z]);
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const surface = new THREE.Mesh(quad, this.#planeMaterial);
    surface.renderOrder = SECTION_RENDER_ORDER;
    const border = new THREE.BufferGeometry();
    border.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const loop = new THREE.LineLoop(border, outline);
    for (const object of [surface, loop]) {
      object.matrixAutoUpdate = false;
      object.matrix.copy(world);
      object.matrixWorldNeedsUpdate = true;
      this.group.add(object);
    }
  }

  #addFill(
    doc: ViewSource['doc'],
    definitionId: DefinitionId,
    plane: SectionPlaneView,
    world: THREE.Matrix4,
    clip: readonly THREE.Plane[],
  ): void {
    let cached = this.#cuts.get(definitionId);
    if (cached?.plane !== plane) {
      cached = { plane, cut: sectionCut(doc, definitionId, plane) };
      this.#cuts.set(definitionId, cached);
    }
    if (cached.cut.triangles.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(cached.cut.triangles, 3));
    const fill = new THREE.Mesh(geometry, this.#fillMaterial);
    fill.matrixAutoUpdate = false;
    fill.matrix.copy(world);
    fill.matrixWorldNeedsUpdate = true;
    this.#clipping.apply(fill, clip);
    this.group.add(fill);
  }
}
