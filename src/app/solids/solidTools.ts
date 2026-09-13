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

import type { DefinitionId, InstanceId } from '../../kernel/ids';
import { IDENTITY } from '../../kernel/math/mat4';
import { addDefinition, addInstance } from '../../kernel/model/mutations';
import type { InstanceAttributes } from '../../kernel/model/types';
import { deleteInstances } from '../../kernel/ops/hierarchy';
import {
  faceProvenance,
  insertTriangleMesh,
  meshVolume,
  rekeyMeshes,
  reverseMesh,
  toTriangleMesh,
  type TriangleMesh,
} from '../../kernel/ops/solids/mesh';
import { isSolid } from '../../kernel/ops/solids/solid';
import type { BooleanOperation } from '../../workers/booleanProtocol';
import type { Editor } from '../Editor';
import { Selection } from '../selection/Selection';

export type SolidToolKind = 'outerShell' | 'union' | 'subtract' | 'trim' | 'intersect' | 'split';

interface SolidToolSpec {
  readonly label: string;
  /** Exactly two inputs, in selection order, or two or more. */
  readonly inputs: 'pair' | 'many';
}

export const SOLID_TOOLS: Readonly<Record<SolidToolKind, SolidToolSpec>> = {
  outerShell: { label: 'Outer Shell', inputs: 'many' },
  union: { label: 'Union', inputs: 'many' },
  subtract: { label: 'Subtract', inputs: 'pair' },
  trim: { label: 'Trim', inputs: 'pair' },
  intersect: { label: 'Intersect', inputs: 'many' },
  split: { label: 'Split', inputs: 'pair' },
};

/** Whether the selection has the right number of groups and components for the tool (solidity is checked on run). */
export function hasSolidToolInputs(editor: Editor, kind: SolidToolKind): boolean {
  const count = editor.session.selection.count('instance');
  return SOLID_TOOLS[kind].inputs === 'pair' ? count === 2 : count >= 2;
}

interface Plan {
  readonly operation: BooleanOperation;
  /** Indices into the inputs, in the order the boolean uses them. */
  readonly order: readonly number[];
  /** Inputs removed from the model. */
  readonly remove: readonly number[];
  /** The input whose instance attributes (name, tag, material) the results take. */
  readonly target: number;
}

function planFor(kind: SolidToolKind, count: number): Plan {
  const all = Array.from({ length: count }, (_, i) => i);
  switch (kind) {
    case 'outerShell':
    case 'union':
      return { operation: 'union', order: all, remove: all, target: 0 };
    case 'intersect':
      return { operation: 'intersection', order: all, remove: all, target: 0 };
    // The first selected object cuts the second.
    case 'subtract':
      return { operation: 'difference', order: [1, 0], remove: [0, 1], target: 1 };
    case 'trim':
      return { operation: 'difference', order: [1, 0], remove: [1], target: 1 };
    case 'split':
      return { operation: 'split', order: [0, 1], remove: [0, 1], target: 0 };
  }
}

/**
 * Runs a solid tool on the selected groups and components. The first selected object is the one with the lowest
 * id (created first). The inputs must be solids; the result replaces them with new groups in one undoable step, and
 * becomes the selection. Throws an Error with a user-facing message when the tool can't run.
 */
export async function runSolidTool(editor: Editor, kind: SolidToolKind): Promise<InstanceId[]> {
  const spec = SOLID_TOOLS[kind];
  const { session } = editor;
  editor.tools.cancel();
  const doc = session.doc;
  const context = session.activeContext;
  const store = doc.store(context);
  const instanceIds = session.selection.ids('instance') as InstanceId[];
  if (!hasSolidToolInputs(editor, kind)) {
    throw new Error(
      spec.inputs === 'pair'
        ? `${spec.label} needs exactly two selected groups or components.`
        : `${spec.label} needs at least two selected groups or components.`,
    );
  }

  const inputs = instanceIds.map((id) => {
    const instance = store.getInstance(id);
    const definition = doc.getDefinition(instance.definitionId);
    if (!isSolid(definition.store)) {
      const kindName = definition.attributes.isGroup ? 'group' : 'component';
      const name = instance.attributes.name || definition.attributes.name;
      throw new Error(
        `${spec.label} works only on solids. The ${kindName} "${name}" is not closed: every edge must join exactly two faces, with nothing nested inside.`,
      );
    }
    let mesh = toTriangleMesh(definition.store, instance.transform);
    if (meshVolume(mesh) < 0) mesh = reverseMesh(mesh);
    return {
      id,
      mesh,
      provenance: faceProvenance(definition.store, instance.transform),
      attributes: instance.attributes,
    };
  });

  const plan = planFor(kind, inputs.length);
  const { meshes, provenance } = rekeyMeshes(inputs);
  const revision = session.revision;
  const results = await editor.booleans.run(
    plan.operation,
    plan.order.map((index) => meshes[index]).filter((mesh): mesh is TriangleMesh => mesh !== undefined),
  );
  if (session.doc !== doc || session.revision !== revision) {
    throw new Error(`The model changed while ${spec.label} was running. Try again.`);
  }
  const parts = results.filter((mesh) => mesh.indices.length > 0);
  if (parts.length === 0 && (kind === 'intersect' || kind === 'union' || kind === 'outerShell')) {
    throw new Error(`${spec.label} found no shared volume between the selected solids.`);
  }

  const attributes: InstanceAttributes | undefined = inputs[plan.target]?.attributes;
  const created = doc.transact(spec.label, () => {
    deleteInstances(
      doc,
      context,
      plan.remove.map((index) => inputs[index]?.id).filter((id): id is InstanceId => id !== undefined),
    );
    const instances: InstanceId[] = [];
    for (const part of parts) {
      const definition: DefinitionId = addDefinition(doc, { name: 'Group', isGroup: true });
      insertTriangleMesh(doc, definition, part, provenance);
      if (doc.store(definition).faceCount === 0) {
        // Throwing rolls the whole operation back, so no half-built group is left behind.
        throw new Error(`${spec.label} could not rebuild faces from the result. The model was not changed.`);
      }
      instances.push(addInstance(doc, context, definition, IDENTITY, attributes));
    }
    return instances;
  });
  session.setSelection(Selection.of(created.map((id) => ({ kind: 'instance' as const, id }))));
  return created;
}
