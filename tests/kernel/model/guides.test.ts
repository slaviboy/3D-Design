import { describe, expect, it } from 'vitest';
import { vec3 } from '../../../src/kernel/math/vec3';
import {
  addDefinition,
  addGuideLine,
  addGuidePoint,
  addTag,
  removeDefinition,
  removeGuide,
  setGuideAttributes,
} from '../../../src/kernel/model/mutations';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { expectValid, newDocument } from '../helpers';

describe('guides', () => {
  it('adds guide lines and points with a normalized direction, and undo and redo restore the hash', () => {
    const doc = newDocument();
    const root = doc.rootDefinitionId;
    const empty = hashDocument(doc);
    const { line, point } = doc.transact('Guides', () => ({
      line: addGuideLine(doc, root, vec3(1, 2, 3), vec3(0, 3, 4)),
      point: addGuidePoint(doc, root, vec3(-1, 0, 0)),
    }));
    const added = hashDocument(doc);
    expect(doc.rootStore.guideCount).toBe(2);
    const geometry = doc.rootStore.getGuide(line).geometry;
    if (geometry.kind !== 'line') throw new Error('expected a guide line');
    expect(geometry.point).toEqual(vec3(1, 2, 3));
    expect(geometry.direction.x).toBe(0);
    expect(geometry.direction.y).toBeCloseTo(0.6, 12);
    expect(geometry.direction.z).toBeCloseTo(0.8, 12);
    expect(doc.rootStore.guide(point)?.geometry).toEqual({ kind: 'point', point: vec3(-1, 0, 0) });
    expectValid(doc);

    doc.undo();
    expect(hashDocument(doc)).toBe(empty);
    expect(doc.rootStore.guideCount).toBe(0);
    doc.redo();
    expect(hashDocument(doc)).toBe(added);
  });

  it('hides and removes guides undoably, and ignores attribute patches that change nothing', () => {
    const doc = newDocument();
    const root = doc.rootDefinitionId;
    const guide = doc.transact('Guide', () => addGuideLine(doc, root, vec3(0, 0, 0), vec3(1, 0, 0)));
    const visible = hashDocument(doc);

    doc.transact('No-op', () => {
      setGuideAttributes(doc, root, guide, { hidden: false });
    });
    expect(doc.undoDepth).toBe(1);

    const tag = doc.transact('Hide', () => {
      const created = addTag(doc, { name: 'Construction', visible: true });
      setGuideAttributes(doc, root, guide, { hidden: true, tagId: created });
      return created;
    });
    expect(doc.rootStore.getGuide(guide).attributes).toEqual({ hidden: true, tagId: tag });
    const hidden = hashDocument(doc);
    doc.undo();
    expect(hashDocument(doc)).toBe(visible);
    doc.redo();
    expect(hashDocument(doc)).toBe(hidden);

    doc.transact('Erase', () => {
      removeGuide(doc, root, guide);
    });
    expect(doc.rootStore.guide(guide)).toBeUndefined();
    doc.undo();
    expect(hashDocument(doc)).toBe(hidden);
  });

  it('rejects zero-length and non-finite directions and non-finite points', () => {
    const doc = newDocument();
    const root = doc.rootDefinitionId;
    expect(() => doc.transact('Zero', () => addGuideLine(doc, root, vec3(0, 0, 0), vec3(0, 0, 0)))).toThrow(
      expect.objectContaining({ code: 'invalid-geometry' }),
    );
    expect(() =>
      doc.transact('NaN', () => addGuideLine(doc, root, vec3(0, 0, 0), vec3(Number.NaN, 1, 0))),
    ).toThrow(expect.objectContaining({ code: 'invalid-geometry' }));
    expect(() =>
      doc.transact('Infinite', () => addGuidePoint(doc, root, vec3(Number.POSITIVE_INFINITY, 0, 0))),
    ).toThrow(expect.objectContaining({ code: 'invalid-geometry' }));
    expect(doc.rootStore.guideCount).toBe(0);
    expect(doc.undoDepth).toBe(0);
  });

  it('lives in its definition, which is not empty while it holds guides', () => {
    const doc = newDocument();
    const definition = doc.transact('Define', () => addDefinition(doc, { name: 'Part', isGroup: false }));
    const guide = doc.transact('Guide', () => addGuidePoint(doc, definition, vec3(0, 0, 0)));
    expect(doc.store(definition).isEmpty).toBe(false);
    expect(doc.rootStore.guideCount).toBe(0);
    expect([...doc.store(definition).guides()].map((g) => g.id)).toEqual([guide]);
    expect(() => {
      doc.transact('Remove', () => {
        removeDefinition(doc, definition);
      });
    }).toThrow(expect.objectContaining({ code: 'invalid-operation' }));
    doc.transact('Erase', () => {
      removeGuide(doc, definition, guide);
    });
    expect(doc.store(definition).isEmpty).toBe(true);
  });
});
