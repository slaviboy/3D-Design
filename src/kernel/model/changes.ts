import type {
  CurveId,
  DefinitionId,
  EdgeId,
  FaceId,
  GuideId,
  InstanceId,
  MaterialId,
  TagId,
  VertexId,
} from '../ids';
import type { Mat4 } from '../math/mat4';
import type { Vec3 } from '../math/vec3';
import type {
  CurveData,
  CurveParams,
  DefinitionAttributes,
  DefinitionData,
  EdgeAttributes,
  EdgeData,
  FaceAttributes,
  FaceData,
  FaceLoops,
  GuideAttributes,
  GuideData,
  InstanceAttributes,
  InstanceData,
  MaterialAttributes,
  MaterialData,
  TagAttributes,
  TagData,
  VertexData,
} from './types';

/**
 * One atomic, reversible modification of a model document.
 *
 * Every change carries enough data to be inverted: a removal holds the full removed record, and an
 * update holds both the old and the new values. Transactions are ordered lists of changes, undo applies
 * their inverses in reverse order, and redo replays them as recorded.
 */
export type Change =
  | {
      readonly kind: 'vertex.add' | 'vertex.remove';
      readonly context: DefinitionId;
      readonly data: VertexData;
    }
  | {
      readonly kind: 'vertex.move';
      readonly context: DefinitionId;
      readonly id: VertexId;
      readonly from: Vec3;
      readonly to: Vec3;
    }
  | { readonly kind: 'edge.add' | 'edge.remove'; readonly context: DefinitionId; readonly data: EdgeData }
  | {
      readonly kind: 'edge.attributes';
      readonly context: DefinitionId;
      readonly id: EdgeId;
      readonly from: EdgeAttributes;
      readonly to: EdgeAttributes;
    }
  | { readonly kind: 'face.add' | 'face.remove'; readonly context: DefinitionId; readonly data: FaceData }
  | {
      readonly kind: 'face.loops';
      readonly context: DefinitionId;
      readonly id: FaceId;
      readonly from: FaceLoops;
      readonly to: FaceLoops;
    }
  | {
      readonly kind: 'face.attributes';
      readonly context: DefinitionId;
      readonly id: FaceId;
      readonly from: FaceAttributes;
      readonly to: FaceAttributes;
    }
  | { readonly kind: 'curve.add' | 'curve.remove'; readonly context: DefinitionId; readonly data: CurveData }
  | {
      readonly kind: 'curve.params';
      readonly context: DefinitionId;
      readonly id: CurveId;
      readonly from: CurveParams;
      readonly to: CurveParams;
    }
  | {
      readonly kind: 'curve.edges';
      readonly context: DefinitionId;
      readonly id: CurveId;
      readonly from: readonly EdgeId[];
      readonly to: readonly EdgeId[];
    }
  | {
      readonly kind: 'instance.add' | 'instance.remove';
      readonly context: DefinitionId;
      readonly data: InstanceData;
    }
  | {
      readonly kind: 'instance.transform';
      readonly context: DefinitionId;
      readonly id: InstanceId;
      readonly from: Mat4;
      readonly to: Mat4;
    }
  | {
      readonly kind: 'instance.attributes';
      readonly context: DefinitionId;
      readonly id: InstanceId;
      readonly from: InstanceAttributes;
      readonly to: InstanceAttributes;
    }
  | { readonly kind: 'guide.add' | 'guide.remove'; readonly context: DefinitionId; readonly data: GuideData }
  | {
      readonly kind: 'guide.attributes';
      readonly context: DefinitionId;
      readonly id: GuideId;
      readonly from: GuideAttributes;
      readonly to: GuideAttributes;
    }
  | { readonly kind: 'definition.add' | 'definition.remove'; readonly data: DefinitionData }
  | {
      readonly kind: 'definition.attributes';
      readonly id: DefinitionId;
      readonly from: DefinitionAttributes;
      readonly to: DefinitionAttributes;
    }
  | { readonly kind: 'material.add' | 'material.remove'; readonly data: MaterialData }
  | {
      readonly kind: 'material.attributes';
      readonly id: MaterialId;
      readonly from: MaterialAttributes;
      readonly to: MaterialAttributes;
    }
  | { readonly kind: 'tag.add' | 'tag.remove'; readonly data: TagData }
  | {
      readonly kind: 'tag.attributes';
      readonly id: TagId;
      readonly from: TagAttributes;
      readonly to: TagAttributes;
    };

export type ChangeKind = Change['kind'];

/** The change that exactly undoes `change`. */
export function invertChange(change: Change): Change {
  switch (change.kind) {
    case 'vertex.add':
      return { ...change, kind: 'vertex.remove' };
    case 'vertex.remove':
      return { ...change, kind: 'vertex.add' };
    case 'edge.add':
      return { ...change, kind: 'edge.remove' };
    case 'edge.remove':
      return { ...change, kind: 'edge.add' };
    case 'face.add':
      return { ...change, kind: 'face.remove' };
    case 'face.remove':
      return { ...change, kind: 'face.add' };
    case 'curve.add':
      return { ...change, kind: 'curve.remove' };
    case 'curve.remove':
      return { ...change, kind: 'curve.add' };
    case 'instance.add':
      return { ...change, kind: 'instance.remove' };
    case 'instance.remove':
      return { ...change, kind: 'instance.add' };
    case 'guide.add':
      return { ...change, kind: 'guide.remove' };
    case 'guide.remove':
      return { ...change, kind: 'guide.add' };
    case 'definition.add':
      return { ...change, kind: 'definition.remove' };
    case 'definition.remove':
      return { ...change, kind: 'definition.add' };
    case 'material.add':
      return { ...change, kind: 'material.remove' };
    case 'material.remove':
      return { ...change, kind: 'material.add' };
    case 'tag.add':
      return { ...change, kind: 'tag.remove' };
    case 'tag.remove':
      return { ...change, kind: 'tag.add' };
    case 'vertex.move':
    case 'edge.attributes':
    case 'face.loops':
    case 'face.attributes':
    case 'curve.params':
    case 'curve.edges':
    case 'instance.transform':
    case 'instance.attributes':
    case 'guide.attributes':
    case 'definition.attributes':
    case 'material.attributes':
    case 'tag.attributes':
      return { ...change, from: change.to, to: change.from } as Change;
  }
}

/** The definition whose entity store a change touches, or `null` for document-level changes. */
export function changeContext(change: Change): DefinitionId | null {
  return 'context' in change ? change.context : null;
}
