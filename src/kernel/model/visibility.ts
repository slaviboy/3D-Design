import type { TagId } from '../ids';
import type { ModelDocument } from './ModelDocument';

/**
 * Whether entities on `tagId` are shown. Untagged entities (and references to tags that no longer exist) are always
 * visible. Rendering, picking, box selection and inference all use this, so a hidden tag hides consistently.
 */
export function isTagVisible(doc: ModelDocument, tagId: TagId | null): boolean {
  return tagId === null || (doc.tag(tagId)?.visible ?? true);
}
