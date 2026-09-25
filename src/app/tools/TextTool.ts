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

import type { EdgeId, FaceId, InstanceId, VertexId } from '../../kernel/ids';
import { planeFromPointNormal } from '../../kernel/math/plane';
import { distance, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import { addAnnotation } from '../../kernel/model/mutations';
import { faceArea } from '../../kernel/ops/planar/regions';
import { EPS_LEN } from '../../kernel/tolerance';
import { formatArea, formatLength } from '../../kernel/units/units';
import { cameraBasis } from '../camera/camera';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import { PRIMARY_BUTTON, type PointerInput, type Tool, type ToolPreview } from './Tool';
import { inferAt, markerFor, toLocalDirection, toLocalPoint } from './toolSupport';

export const TEXT_TOOL_ID = 'tool.text';

interface Target {
  readonly point: Vec3;
  readonly vertex: VertexId | null;
  readonly defaultText: string;
}

/** The text a leader starts with: a face's area, an edge's length, a group's name, or the point's coordinates. */
export function defaultLeaderText(editor: Editor, inference: Inference): string {
  const { session, units } = editor;
  const store = session.doc.store(session.activeContext);
  const entity = inference.entity;
  if (entity?.kind === 'face' && store.face(entity.id as FaceId)) {
    return formatArea(faceArea(store, entity.id as FaceId), units);
  }
  if (entity?.kind === 'edge') {
    const edge = store.edge(entity.id as EdgeId);
    if (edge) return formatLength(distance(store.position(edge.v0), store.position(edge.v1)), units);
  }
  if (entity?.kind === 'instance') {
    const instance = store.instance(entity.id as InstanceId);
    if (instance) {
      return instance.attributes.name || session.doc.getDefinition(instance.definitionId).attributes.name;
    }
  }
  const { x, y, z } = inference.point;
  return [x, y, z].map((value) => formatLength(value, units)).join(', ');
}

/**
 * Places text. Click an entity, move and click again to place leader text (it starts as the entity's area, length or
 * name); click empty space to place screen text, which stays put when the view changes.
 */
export class TextTool implements Tool {
  readonly id = TEXT_TOOL_ID;
  readonly label = 'Text';
  readonly cursor = 'text';

  #target: Target | null = null;
  #current: Inference | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#current = this.#infer(input, editor);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const target = this.#target;
    const inference = this.#infer(input, editor);
    this.#current = inference;
    if (!target) {
      if (inference.kind === 'free') {
        this.#placeScreenText(editor, input);
        return;
      }
      const [vertex] = inference.inGroup
        ? []
        : editor.session.doc
            .store(editor.session.activeContext)
            .verticesWithin(toLocalPoint(editor, inference.point), EPS_LEN);
      this.#target = {
        point: inference.point,
        vertex: vertex ?? null,
        defaultText: defaultLeaderText(editor, inference),
      };
      return;
    }
    this.#target = null;
    const offset = sub(inference.point, target.point);
    const { session } = editor;
    const context = session.activeContext;
    editor.requestInput({
      title: 'Leader Text',
      label: 'Text',
      initial: target.defaultText,
      confirmLabel: 'Place',
      submit: (value) => {
        if (value.trim() === '') throw new Error('Type some text for the label');
        const doc = session.doc;
        doc.transact('Text', () =>
          addAnnotation(
            doc,
            context,
            {
              kind: 'leader-text',
              target: { point: toLocalPoint(editor, target.point), vertex: target.vertex },
              offset: toLocalDirection(editor, offset),
            },
            { text: value, hidden: false, tagId: null },
          ),
        );
      },
    });
  }

  busy(): boolean {
    return this.#target !== null;
  }

  aims(): boolean {
    return true;
  }

  cancel(): void {
    this.#target = null;
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#target) {
      this.cancel();
      return true;
    }
    return false;
  }

  preview(): ToolPreview {
    const target = this.#target;
    const current = this.#current;
    return {
      lines: target && current ? [{ a: target.point, b: current.point, style: 'preview' }] : [],
      highlight: [],
      marker: markerFor(current),
    };
  }

  statusHint(): string {
    return this.#target
      ? 'Click to place the label.'
      : 'Click an entity for leader text, or empty space for screen text.';
  }

  #infer(input: PointerInput, editor: Editor): Inference {
    const target = this.#target;
    if (!target) return inferAt(editor, input);
    const facing = scale(cameraBasis(editor.session.camera).forward, -1);
    return inferAt(editor, input, { fallbackPlane: planeFromPointNormal(target.point, facing) });
  }

  #placeScreenText(editor: Editor, input: PointerInput): void {
    const { width, height } = editor.viewportSize;
    const x = Math.min(1, Math.max(0, input.x / width));
    const y = Math.min(1, Math.max(0, input.y / height));
    const { session } = editor;
    const context = session.doc.rootDefinitionId;
    editor.requestInput({
      title: 'Screen Text',
      label: 'Text',
      initial: '',
      confirmLabel: 'Place',
      submit: (value) => {
        if (value.trim() === '') throw new Error('Type some text for the label');
        const doc = session.doc;
        doc.transact('Text', () =>
          addAnnotation(
            doc,
            context,
            { kind: 'screen-text', x, y },
            { text: value, hidden: false, tagId: null },
          ),
        );
      },
    });
  }
}
