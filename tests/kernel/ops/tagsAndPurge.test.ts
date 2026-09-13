import { describe, expect, it } from 'vitest';
import type { TagId } from '../../../src/kernel/ids';
import { translation } from '../../../src/kernel/math/mat4';
import { vec3 } from '../../../src/kernel/math/vec3';
import {
  addInstance,
  addTag,
  setEdgeAttributes,
  setInstanceAttributes,
} from '../../../src/kernel/model/mutations';
import { createSnapshot, hashDocument, restoreSnapshot } from '../../../src/kernel/model/snapshot';
import { DEFAULT_TAG_COLOR } from '../../../src/kernel/model/types';
import { isTagVisible } from '../../../src/kernel/model/visibility';
import {
  deleteInstances,
  makeComponent,
  makeGroup,
  purgeUnusedDefinitions,
} from '../../../src/kernel/ops/hierarchy';
import { deleteTag, purgeUnusedTags, tagUsage } from '../../../src/kernel/ops/tags';
import { draw, expectValid, faceIds, newDocument, rectangle } from '../helpers';

const RED = { r: 1, g: 0, b: 0 };

describe('tag operations', () => {
  it('deletes a tag, untagging everything on it, and undoes', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const root = doc.rootDefinitionId;
    const { definition, instance } = makeGroup(doc, root, { faces: faceIds(doc.rootStore) });
    const tag = doc.transact('Add', () => addTag(doc, { name: 'Walls', visible: true, color: RED }));
    const [edge] = [...doc.store(definition).edges()];
    if (!edge) throw new Error('expected an edge');
    doc.transact('Tag', () => {
      setInstanceAttributes(doc, root, instance, { tagId: tag });
      setEdgeAttributes(doc, definition, edge.id, { tagId: tag });
    });
    expect(tagUsage(doc).get(tag)).toBe(2);
    const before = hashDocument(doc);

    deleteTag(doc, tag);
    expect(doc.tag(tag)).toBeUndefined();
    expect(doc.rootStore.getInstance(instance).attributes.tagId).toBeNull();
    expect(doc.store(definition).getEdge(edge.id).attributes.tagId).toBeNull();
    expect(doc.undoLabel).toBe('Delete Tag');
    expectValid(doc);

    doc.undo();
    expect(hashDocument(doc)).toBe(before);
    expect(doc.rootStore.getInstance(instance).attributes.tagId).toBe(tag);
  });

  it('purges only unused tags', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const { instance } = makeGroup(doc, doc.rootDefinitionId, { faces: faceIds(doc.rootStore) });
    const [used, unused] = doc.transact('Add', () => [
      addTag(doc, { name: 'Used', visible: true, color: RED }),
      addTag(doc, { name: 'Unused', visible: true, color: RED }),
    ]);
    doc.transact('Tag', () => {
      setInstanceAttributes(doc, doc.rootDefinitionId, instance, { tagId: used });
    });
    expect(purgeUnusedTags(doc)).toEqual([unused]);
    expect([...doc.tags()].map((tag) => tag.name)).toEqual(['Used']);
    expect(purgeUnusedTags(doc)).toEqual([]);
  });

  it('treats untagged entities and hidden tags correctly', () => {
    const doc = newDocument();
    const tag = doc.transact('Add', () => addTag(doc, { name: 'A', visible: false, color: RED }));
    expect(isTagVisible(doc, null)).toBe(true);
    expect(isTagVisible(doc, tag)).toBe(false);
    expect(isTagVisible(doc, 999_999 as TagId)).toBe(true);
  });

  it('round-trips tag colors and reads files without them', () => {
    const doc = newDocument();
    doc.transact('Add', () => addTag(doc, { name: 'A', visible: true, color: { r: 0.25, g: 0.5, b: 1 } }));
    const snapshot = JSON.parse(JSON.stringify(createSnapshot(doc))) as { tags: Record<string, unknown>[] };
    const restored = restoreSnapshot(snapshot);
    if (!restored.ok) throw new Error(restored.error);
    expect([...restored.value.tags()][0]?.color).toEqual({ r: 0.25, g: 0.5, b: 1 });

    for (const tag of snapshot.tags) delete tag.color;
    const legacy = restoreSnapshot(snapshot);
    if (!legacy.ok) throw new Error(legacy.error);
    expect([...legacy.value.tags()][0]?.color).toEqual(DEFAULT_TAG_COLOR);
  });
});

describe('purgeUnusedDefinitions', () => {
  it('removes unused components, including ones left unused by the purge, and undoes', () => {
    const doc = newDocument();
    const root = doc.rootDefinitionId;
    draw(doc, rectangle(0, 0, 1, 1));
    const inner = makeComponent(doc, root, { faces: faceIds(doc.rootStore) }, 'Inner');
    const outer = makeComponent(doc, root, { instances: [inner.instance] }, 'Outer');
    draw(doc, rectangle(3, 0, 4, 1));
    const kept = makeComponent(doc, root, { faces: faceIds(doc.rootStore) }, 'Kept');
    doc.transact('Copy', () => addInstance(doc, root, kept.definition, translation(vec3(5, 0, 0))));
    deleteInstances(doc, root, [outer.instance]);
    expect(doc.definition(outer.definition)).toBeDefined();
    const before = hashDocument(doc);

    const removed = purgeUnusedDefinitions(doc);
    expect(removed).toEqual([outer.definition, inner.definition]);
    expect(doc.definition(kept.definition)).toBeDefined();
    expect(doc.undoLabel).toBe('Purge Unused Components');
    expectValid(doc);

    doc.undo();
    expect(hashDocument(doc)).toBe(before);
    expect(purgeUnusedDefinitions(newDocument())).toEqual([]);
  });
});
