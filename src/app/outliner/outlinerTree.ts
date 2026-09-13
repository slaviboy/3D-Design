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
import type { InstanceView } from '../../kernel/model/EntityStore';
import type { ModelDocument } from '../../kernel/model/ModelDocument';

export type OutlinerKind = 'group' | 'component';

/** One group or component instance in the Outliner. */
export interface OutlinerNode {
  /** Unique within the tree: the instance ids from the root down to this one, joined with `/`. */
  readonly key: string;
  readonly id: InstanceId;
  /** Instances that contain this one, outermost first. Opening them makes this instance selectable. */
  readonly parentPath: readonly InstanceId[];
  readonly definitionId: DefinitionId;
  readonly label: string;
  /** The instance's own name, possibly empty. */
  readonly name: string;
  readonly kind: OutlinerKind;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly children: readonly OutlinerNode[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Groups show their name (or their definition's name); components show `name <Definition>`. */
export function outlinerLabel(doc: ModelDocument, instance: InstanceView): string {
  const definition = doc.getDefinition(instance.definitionId).attributes;
  const name = instance.attributes.name.trim();
  if (definition.isGroup) return name || definition.name;
  return name ? `${name} <${definition.name}>` : `<${definition.name}>`;
}

/**
 * The model's hierarchy of groups and components, sorted by label. With `filterText`, only nodes whose label contains
 * it (ignoring case) are kept, together with the ancestors that lead to them.
 */
export function buildOutlinerTree(doc: ModelDocument, filterText = ''): OutlinerNode[] {
  const needle = filterText.trim().toLocaleLowerCase();
  const build = (
    context: DefinitionId,
    parentPath: readonly InstanceId[],
    ancestors: ReadonlySet<DefinitionId>,
  ): OutlinerNode[] => {
    if (ancestors.has(context)) return [];
    const nested = new Set(ancestors).add(context);
    const nodes: OutlinerNode[] = [];
    for (const instance of doc.store(context).instances()) {
      const path = [...parentPath, instance.id];
      const children = build(instance.definitionId, path, nested);
      const label = outlinerLabel(doc, instance);
      if (needle !== '' && children.length === 0 && !label.toLocaleLowerCase().includes(needle)) continue;
      nodes.push({
        key: path.join('/'),
        id: instance.id,
        parentPath,
        definitionId: instance.definitionId,
        label,
        name: instance.attributes.name,
        kind: doc.getDefinition(instance.definitionId).attributes.isGroup ? 'group' : 'component',
        hidden: instance.attributes.hidden,
        locked: instance.attributes.locked,
        children,
      });
    }
    return nodes.sort((a, b) => collator.compare(a.label, b.label) || a.id - b.id);
  };
  return build(doc.rootDefinitionId, [], new Set());
}

/** A node as a row of the flattened tree view. */
export interface OutlinerRow {
  readonly node: OutlinerNode;
  /** 1 for top-level nodes. */
  readonly level: number;
  readonly setSize: number;
  /** 1-based position among its siblings. */
  readonly posInSet: number;
  /** The row of the parent node, or -1 for top-level nodes. */
  readonly parentIndex: number;
}

/** The rows a tree view shows: every node whose ancestors are all expanded, in display order. */
export function flattenOutliner(
  nodes: readonly OutlinerNode[],
  isExpanded: (node: OutlinerNode) => boolean,
): OutlinerRow[] {
  const rows: OutlinerRow[] = [];
  const visit = (siblings: readonly OutlinerNode[], level: number, parentIndex: number): void => {
    siblings.forEach((node, index) => {
      const rowIndex = rows.length;
      rows.push({ node, level, setSize: siblings.length, posInSet: index + 1, parentIndex });
      if (node.children.length > 0 && isExpanded(node)) visit(node.children, level + 1, rowIndex);
    });
  };
  visit(nodes, 1, -1);
  return rows;
}
