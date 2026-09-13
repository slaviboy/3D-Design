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

import type { DefinitionId } from '../../kernel/ids';
import type { ModelDocument } from '../../kernel/model/ModelDocument';

/** One component definition in the Components panel. */
export interface ComponentRow {
  readonly id: DefinitionId;
  readonly name: string;
  /** Instances anywhere in the model. */
  readonly instanceCount: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Reusable component definitions in the model (groups and the model root are not listed), sorted by name. */
export function listComponentDefinitions(doc: ModelDocument): ComponentRow[] {
  const counts = new Map<DefinitionId, number>();
  for (const definition of doc.definitions()) {
    for (const instance of definition.store.instances()) {
      counts.set(instance.definitionId, (counts.get(instance.definitionId) ?? 0) + 1);
    }
  }
  return [...doc.definitions()]
    .filter((definition) => definition.id !== doc.rootDefinitionId && !definition.attributes.isGroup)
    .map((definition) => ({
      id: definition.id,
      name: definition.attributes.name,
      instanceCount: counts.get(definition.id) ?? 0,
    }))
    .sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);
}
