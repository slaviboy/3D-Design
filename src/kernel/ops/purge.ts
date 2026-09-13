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

import type { DefinitionId, MaterialId, TagId } from '../ids';
import type { ModelDocument } from '../model/ModelDocument';
import { purgeUnusedDefinitions } from './hierarchy';
import { purgeUnusedMaterials } from './materials';
import { purgeUnusedTags } from './tags';

export interface PurgeResult {
  readonly definitions: readonly DefinitionId[];
  readonly materials: readonly MaterialId[];
  readonly tags: readonly TagId[];
}

export function purgedCount(result: PurgeResult): number {
  return result.definitions.length + result.materials.length + result.tags.length;
}

/**
 * Removes unused components, then materials and texture images, then tags, as one undoable step. Components go first
 * because removing them can leave materials and tags that only they used.
 */
export function purgeAllUnused(doc: ModelDocument): PurgeResult {
  return doc.transact('Purge Unused', () => {
    const definitions = purgeUnusedDefinitions(doc);
    const materials = purgeUnusedMaterials(doc);
    const tags = purgeUnusedTags(doc);
    return { definitions, materials, tags };
  });
}
