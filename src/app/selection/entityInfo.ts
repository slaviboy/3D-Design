import type { DefinitionId, EdgeId, FaceId, InstanceId } from '../../kernel/ids';
import { distance } from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import { faceArea } from '../../kernel/ops/planar/regions';
import { formatArea, formatLength, type UnitSettings } from '../../kernel/units/units';
import type { Selection } from './Selection';

export interface InfoRow {
  readonly label: string;
  readonly value: string;
}

export interface EntityInfo {
  readonly title: string;
  readonly rows: readonly InfoRow[];
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  `${String(count)} ${count === 1 ? singular : pluralForm}`;

/** What the Entity Info panel shows for the current selection (or the whole context when nothing is selected). */
export function describeSelection(
  doc: ModelDocument,
  context: DefinitionId,
  selection: Selection,
  units: UnitSettings,
): EntityInfo {
  const store = doc.store(context);
  const faces = selection.ids('face') as FaceId[];
  const edges = selection.ids('edge') as EdgeId[];
  const instances = selection.ids('instance') as InstanceId[];
  const totalArea = (): number => faces.reduce((sum, id) => sum + faceArea(store, id), 0);
  const totalLength = (): number =>
    edges.reduce((sum, id) => {
      const edge = store.getEdge(id);
      return sum + distance(store.position(edge.v0), store.position(edge.v1));
    }, 0);

  if (selection.isEmpty) {
    return {
      title: doc.getDefinition(context).attributes.name,
      rows: [
        { label: 'Faces', value: String(store.faceCount) },
        { label: 'Edges', value: String(store.edgeCount) },
        { label: 'Groups and components', value: String(store.instanceCount) },
      ],
    };
  }

  if (selection.size === 1) {
    const [faceId] = faces;
    const [edgeId] = edges;
    const [instanceId] = instances;
    if (faceId !== undefined) {
      const face = store.getFace(faceId);
      return {
        title: 'Face',
        rows: [
          { label: 'Area', value: formatArea(totalArea(), units) },
          { label: 'Holes', value: String(face.inners.length) },
        ],
      };
    }
    if (edgeId !== undefined) {
      const edge = store.getEdge(edgeId);
      return {
        title: 'Edge',
        rows: [
          { label: 'Length', value: formatLength(totalLength(), units) },
          { label: 'Faces', value: String(edge.faces.length) },
        ],
      };
    }
    if (instanceId !== undefined) {
      const instance = store.getInstance(instanceId);
      const definition = doc.getDefinition(instance.definitionId);
      const inner = definition.store;
      return {
        title: definition.attributes.isGroup ? 'Group' : 'Component',
        rows: [
          ...(definition.attributes.isGroup
            ? []
            : [{ label: 'Definition', value: definition.attributes.name }]),
          ...(instance.attributes.name ? [{ label: 'Name', value: instance.attributes.name }] : []),
          {
            label: 'Contents',
            value: `${plural(inner.faceCount, 'face')}, ${plural(inner.edgeCount, 'edge')}`,
          },
        ],
      };
    }
  }

  const rows: InfoRow[] = [];
  if (instances.length > 0) rows.push({ label: 'Groups and components', value: String(instances.length) });
  if (faces.length > 0) {
    rows.push({ label: 'Faces', value: String(faces.length) });
    rows.push({ label: 'Total area', value: formatArea(totalArea(), units) });
  }
  if (edges.length > 0) {
    rows.push({ label: 'Edges', value: String(edges.length) });
    rows.push({ label: 'Total length', value: formatLength(totalLength(), units) });
  }
  return { title: plural(selection.size, 'entity', 'entities'), rows };
}
