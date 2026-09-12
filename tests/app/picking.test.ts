import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA } from '../../src/app/camera/camera';
import { pick } from '../../src/app/picking/picker';
import { boxSelect, rectFromCorners } from '../../src/app/selection/boxSelect';
import type { FaceId } from '../../src/kernel/ids';
import { IDENTITY, translation } from '../../src/kernel/math/mat4';
import { length, vec3 } from '../../src/kernel/math/vec3';
import type { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { setInstanceAttributes, setInstanceTransform } from '../../src/kernel/model/mutations';
import { makeGroup } from '../../src/kernel/ops/hierarchy';
import { draw, newDocument, rectangle } from '../kernel/helpers';
import { screenOf, TOP_CAMERA, VIEW_SIZE } from './fixtures';

function pickAt(doc: ModelDocument, x: number, y: number, camera = TOP_CAMERA) {
  return pick(doc, doc.rootDefinitionId, IDENTITY, { camera, size: VIEW_SIZE, screen: screenOf(x, y) });
}

describe('picking', () => {
  it('hits the face under the cursor and misses empty space', () => {
    const doc = newDocument();
    draw(doc, rectangle(-2, -2, 2, 2));
    const [face] = [...doc.rootStore.faces()];
    expect(pickAt(doc, 0.3, -0.4)?.ref).toEqual({ kind: 'face', id: face?.id });
    expect(pickAt(doc, 4.5, 0)).toBeNull();
  });

  it('prefers an edge within the pixel tolerance over the face behind it', () => {
    const doc = newDocument();
    draw(doc, rectangle(-2, -2, 2, 2));
    // 0.1 m is 2 px from the edge at x = 2 with this camera.
    const hit = pickAt(doc, 1.9, 0);
    expect(hit?.ref.kind).toBe('edge');
    expect(hit?.point.x).toBeCloseTo(2);
    expect(pickAt(doc, 1.5, 0)?.ref.kind).toBe('face');
  });

  it('reports the nearest surface in perspective', () => {
    const doc = newDocument();
    draw(doc, rectangle(-2, -2, 2, 2, 0));
    draw(doc, rectangle(-1, -1, 1, 1, 1));
    const camera = { ...DEFAULT_CAMERA, eye: vec3(0, -6, 6), target: vec3(0, 0, 1) };
    const hit = pick(doc, doc.rootDefinitionId, IDENTITY, {
      camera,
      size: VIEW_SIZE,
      screen: { x: 100, y: 100 },
    });
    expect(hit?.point.z).toBeCloseTo(1);
    expect(hit?.distance).toBeCloseTo(length(vec3(0, 6, 5)));
  });

  it('picks geometry inside a transformed group as the group instance, and skips hidden instances', () => {
    const doc = newDocument();
    draw(doc, rectangle(-1, -1, 1, 1));
    const { instance } = makeGroup(doc, doc.rootDefinitionId, {
      faces: [...doc.rootStore.faces()].map((f) => f.id),
    });
    doc.transact('Move', () => {
      setInstanceTransform(doc, doc.rootDefinitionId, instance, translation(vec3(3, 0, 0)));
    });
    expect(pickAt(doc, 3, 0)?.ref).toEqual({ kind: 'instance', id: instance });
    expect(pickAt(doc, 0, 0)).toBeNull();
    doc.transact('Hide', () => {
      setInstanceAttributes(doc, doc.rootDefinitionId, instance, { hidden: true });
    });
    expect(pickAt(doc, 3, 0)).toBeNull();
  });
});

describe('box selection', () => {
  function twoRectangles(): { doc: ModelDocument; left: FaceId; right: FaceId } {
    const doc = newDocument();
    draw(doc, rectangle(-4, -1, -2, 1));
    draw(doc, rectangle(2, -1, 4, 1));
    const faces = [...doc.rootStore.faces()].sort(
      (a, b) => doc.rootStore.faceBounds(a.id).minX - doc.rootStore.faceBounds(b.id).minX,
    );
    return { doc, left: faces[0]?.id as FaceId, right: faces[1]?.id as FaceId };
  }

  const select = (
    doc: ModelDocument,
    from: { x: number; y: number },
    to: { x: number; y: number },
    mode: 'window' | 'crossing',
  ) => boxSelect(doc, doc.rootDefinitionId, IDENTITY, TOP_CAMERA, VIEW_SIZE, rectFromCorners(from, to), mode);

  it('window selection takes only what is fully inside', () => {
    const { doc, left } = twoRectangles();
    const refs = select(doc, screenOf(-4.5, 1.5), screenOf(-1.5, -1.5), 'window');
    expect(refs.filter((ref) => ref.kind === 'face')).toEqual([{ kind: 'face', id: left }]);
    expect(refs.filter((ref) => ref.kind === 'edge')).toHaveLength(4);
  });

  it('crossing selection takes anything the rectangle touches', () => {
    const { doc, left } = twoRectangles();
    const from = screenOf(-2.5, 1.5);
    const to = screenOf(-1.5, -1.5);
    const crossing = select(doc, from, to, 'crossing');
    expect(crossing.filter((ref) => ref.kind === 'face')).toEqual([{ kind: 'face', id: left }]);
    // The right edge (inside) plus the top and bottom edges (crossed); the far left edge is untouched.
    expect(crossing.filter((ref) => ref.kind === 'edge')).toHaveLength(3);
    const window = select(doc, from, to, 'window');
    expect(window).toHaveLength(1);
    expect(window[0]?.kind).toBe('edge');
  });

  it('selects a face when the rectangle lies entirely inside it', () => {
    const doc = newDocument();
    draw(doc, rectangle(-4, -4, 4, 4));
    const refs = select(doc, screenOf(-0.5, 0.5), screenOf(0.5, -0.5), 'crossing');
    expect(refs).toEqual([{ kind: 'face', id: [...doc.rootStore.faces()][0]?.id }]);
  });

  it('selects instances by their bounds', () => {
    const doc = newDocument();
    draw(doc, rectangle(-1, -1, 1, 1));
    const { instance } = makeGroup(doc, doc.rootDefinitionId, {
      faces: [...doc.rootStore.faces()].map((f) => f.id),
    });
    expect(select(doc, screenOf(-2, 2), screenOf(2, -2), 'window')).toEqual([
      { kind: 'instance', id: instance },
    ]);
    expect(select(doc, screenOf(0.5, 2), screenOf(2, -2), 'window')).toEqual([]);
    expect(select(doc, screenOf(0.5, 2), screenOf(2, -2), 'crossing')).toEqual([
      { kind: 'instance', id: instance },
    ]);
  });
});
