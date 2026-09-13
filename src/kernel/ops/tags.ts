import type { TagId } from '../ids';
import type { ModelDocument } from '../model/ModelDocument';
import {
  removeTag,
  setEdgeAttributes,
  setFaceAttributes,
  setGuideAttributes,
  setInstanceAttributes,
} from '../model/mutations';

/** How many edges, faces, instances and guides use each tag, across every definition. */
export function tagUsage(doc: ModelDocument): Map<TagId, number> {
  const usage = new Map<TagId, number>();
  const count = (tagId: TagId | null): void => {
    if (tagId !== null) usage.set(tagId, (usage.get(tagId) ?? 0) + 1);
  };
  for (const definition of doc.definitions()) {
    const { store } = definition;
    for (const edge of store.edges()) count(edge.attributes.tagId);
    for (const face of store.faces()) count(face.attributes.tagId);
    for (const instance of store.instances()) count(instance.attributes.tagId);
    for (const guide of store.guides()) count(guide.attributes.tagId);
  }
  return usage;
}

/** Deletes a tag. Everything that used it becomes untagged. */
export function deleteTag(doc: ModelDocument, tagId: TagId): void {
  doc.transact('Delete Tag', () => {
    for (const definition of doc.definitions()) {
      const { id: context, store } = definition;
      for (const edge of store.edges()) {
        if (edge.attributes.tagId === tagId) setEdgeAttributes(doc, context, edge.id, { tagId: null });
      }
      for (const face of store.faces()) {
        if (face.attributes.tagId === tagId) setFaceAttributes(doc, context, face.id, { tagId: null });
      }
      for (const instance of store.instances()) {
        if (instance.attributes.tagId === tagId) {
          setInstanceAttributes(doc, context, instance.id, { tagId: null });
        }
      }
      for (const guide of store.guides()) {
        if (guide.attributes.tagId === tagId) setGuideAttributes(doc, context, guide.id, { tagId: null });
      }
    }
    removeTag(doc, tagId);
  });
}

/** Deletes every tag that nothing uses. Returns the deleted ids. */
export function purgeUnusedTags(doc: ModelDocument): TagId[] {
  return doc.transact('Purge Unused Tags', () => {
    const usage = tagUsage(doc);
    const unused = [...doc.tags()].map((tag) => tag.id).filter((id) => !usage.has(id));
    for (const id of unused) removeTag(doc, id);
    return unused;
  });
}
