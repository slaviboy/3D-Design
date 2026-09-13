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
