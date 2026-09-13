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
  /** An environment image loaded from a local file in this session, used by the `custom` environment. */
  readonly environmentImage?: ViewEnvironmentImage | null;
  subscribe(listener: (change: ViewChange) => void): () => void;
}

/** Radiance HDR bytes and the name of the file they came from. */
export interface ViewEnvironmentImage {
  readonly name: string;
  readonly bytes: Uint8Array;
}
