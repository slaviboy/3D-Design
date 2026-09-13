import type { DefinitionId } from '../kernel/ids';
import type { Mat4 } from '../kernel/math/mat4';
import type { Vec3 } from '../kernel/math/vec3';
import type { DocumentEvent, ModelDocument } from '../kernel/model/ModelDocument';

/*
 * What the renderer needs to know about the editing state. The render layer can't import the application layer
 * (see ARCHITECTURE.md), so it declares this small structural contract, which the editor session satisfies.
 */

export interface ViewCamera {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly fovDegrees: number;
  readonly projection: 'perspective' | 'parallel';
  readonly orthoHalfHeight: number;
}

export interface ViewEntityRef {
  readonly kind: 'face' | 'edge' | 'instance' | 'section';
  readonly id: number;
}

export interface ViewSelection {
  refs(): readonly ViewEntityRef[];
}

export type ViewPreviewLineStyle = 'preview' | 'axis-x' | 'axis-y' | 'axis-z' | 'guide';

/** Temporary drawing aids from the active tool. Lines are in world coordinates, highlights in the active context. */
export interface ViewPreview {
  readonly lines: readonly { readonly a: Vec3; readonly b: Vec3; readonly style: ViewPreviewLineStyle }[];
  readonly highlight: readonly ViewEntityRef[];
}

export interface ViewChange {
  readonly kind: string;
  readonly modelEvent?: DocumentEvent;
}

export interface ViewSource {
  readonly doc: ModelDocument;
  readonly camera: ViewCamera;
  readonly selection: ViewSelection;
  readonly activeContext: DefinitionId;
  readonly activeContextTransform: Mat4;
  /** Instance ids of the open groups and components, outermost first. Everything outside is drawn faded. */
  readonly editPath: readonly number[];
  readonly preview: ViewPreview | null;
  /** Draw section plane rectangles. */
  readonly showSectionPlanes: boolean;
  /** Clip at active section planes and fill the cuts. */
  readonly showSectionCuts: boolean;
  subscribe(listener: (change: ViewChange) => void): () => void;
}
