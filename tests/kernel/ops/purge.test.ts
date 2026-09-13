import { describe, expect, it } from 'vitest';
import { addMaterial, addTag, removeInstance, setFaceAttributes } from '../../../src/kernel/model/mutations';
import { hashDocument } from '../../../src/kernel/model/snapshot';
import { makeComponent } from '../../../src/kernel/ops/hierarchy';
import { purgeAllUnused, purgedCount } from '../../../src/kernel/ops/purge';
import { draw, expectValid, newDocument, rectangle } from '../helpers';

/** A square turned into a component whose face is painted Oak, plus a tag nothing uses. */
function paintedComponent() {
  const doc = newDocument();
  draw(doc, rectangle(0, 0, 1, 1));
  const faceId = [...doc.rootStore.faces()][0]?.id;
  if (faceId === undefined) throw new Error('no face');
  const component = makeComponent(doc, doc.rootDefinitionId, { faces: [faceId] }, 'Tile');
  doc.transact('Decorate', () => {
    const oak = addMaterial(doc, { name: 'Oak', color: { r: 0.5, g: 0.3, b: 0.2 }, opacity: 1 });
    addTag(doc, { name: 'Unused', visible: true, color: { r: 1, g: 0, b: 0 } });
    const inner = [...doc.store(component.definition).faces()][0];
    if (inner) setFaceAttributes(doc, component.definition, inner.id, { frontMaterialId: oak });
  });
  return { doc, component };
}

describe('purge all unused', () => {
  it('keeps what is used, removes the unused tag, and undoes in one step', () => {
    const { doc } = paintedComponent();
    const before = hashDocument(doc);

    const result = purgeAllUnused(doc);
    expect(result.definitions).toEqual([]);
    expect(result.materials).toEqual([]);
    expect(result.tags).toHaveLength(1);
    expect(purgedCount(result)).toBe(1);
    expect(doc.undoLabel).toBe('Purge Unused');
    expectValid(doc);

    doc.undo();
    expect(hashDocument(doc)).toBe(before);
  });

  it('frees materials used only inside the components it removes', () => {
    const { doc, component } = paintedComponent();
    const placement = doc.instancesOf(component.definition)[0];
    if (!placement) throw new Error('no instance');
    doc.transact('Erase instance', () => {
      removeInstance(doc, placement.context, placement.instance.id);
    });

    const result = purgeAllUnused(doc);
    expect(result.definitions).toEqual([component.definition]);
    expect(result.materials).toHaveLength(1);
    expect(result.tags).toHaveLength(1);
    expect([...doc.materials()]).toHaveLength(0);
    expectValid(doc);
  });

  it('does nothing, and records no undo step, when nothing is unused', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 1, 1));
    const undoLabel = doc.undoLabel;
    expect(purgedCount(purgeAllUnused(doc))).toBe(0);
    expect(doc.undoLabel).toBe(undoLabel);
  });
});
