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
  readonly kind: 'face' | 'edge' | 'instance';
  readonly id: number;
}

export interface ViewSelection {
  refs(): readonly ViewEntityRef[];
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
  subscribe(listener: (change: ViewChange) => void): () => void;
}
