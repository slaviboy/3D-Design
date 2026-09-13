import type { DefinitionId, EdgeId, FaceId, InstanceId, SectionPlaneId, TagId } from '../../kernel/ids';
import { distance } from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import type { CurveKind } from '../../kernel/model/types';
import { faceArea } from '../../kernel/ops/planar/regions';
import { formatArea, formatLength, type UnitSettings } from '../../kernel/units/units';
import type { Selection } from './Selection';

export interface InfoRow {
  readonly label: string;
  readonly value: string;
}

/** A boolean attribute over a selection: the common value, or `mixed` when entities disagree. */
export type Tristate = boolean | 'mixed';

/** The editable attributes Entity Info shows. A field is present only when it applies to the whole selection. */
export interface EntityInfoFields {
  /** Every selected entity has a tag. */
  readonly tag?: TagId | null | 'mixed';
  readonly hidden?: Tristate;
  /** Only groups and components are selected. */
  readonly locked?: Tristate;
  /** Only edges are selected. */
  readonly soft?: Tristate;
  readonly smooth?: Tristate;
  /** Exactly one group or component is selected. */
  readonly name?: string;
  /** Exactly one component instance is selected. */
  readonly definition?: { readonly id: DefinitionId; readonly name: string };
  /** Exactly one section plane is selected. */
  readonly section?: { readonly id: SectionPlaneId; readonly name: string; readonly active: boolean };
}

export interface EntityInfo {
  readonly title: string;
  /** Read-only details. */
  readonly rows: readonly InfoRow[];
  readonly fields: EntityInfoFields;
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  `${String(count)} ${count === 1 ? singular : pluralForm}`;

const CURVE_LABELS: Readonly<Record<CurveKind, string>> = {
  circle: 'Circle',
  arc: 'Arc',
  polygon: 'Polygon',
  polyline: 'Polyline',
};

function combine<T>(values: readonly T[]): T | 'mixed' {
  const first = values[0] as T;
  return values.every((value) => value === first) ? first : 'mixed';
}

/** What the Entity Info panel shows for the current selection (or the whole context when nothing is selected). */
export function describeSelection(
  doc: ModelDocument,
  context: DefinitionId,
  selection: Selection,
  units: UnitSettings,
): EntityInfo {
  return { ...summarize(doc, context, selection, units), fields: selectionFields(doc, context, selection) };
}

/** The editable attributes common to the selection. */
export function selectionFields(
  doc: ModelDocument,
  context: DefinitionId,
  selection: Selection,
): EntityInfoFields {
  if (selection.isEmpty) return {};
  const store = doc.store(context);
  const [sectionId] = selection.ids('section');
  if (sectionId !== undefined && selection.size === 1) {
    const plane = store.getSectionPlane(sectionId as SectionPlaneId);
    return { section: { id: plane.id, name: plane.name, active: plane.active } };
  }
  const instances = (selection.ids('instance') as InstanceId[]).map((id) => store.getInstance(id));
  const faces = (selection.ids('face') as FaceId[]).map((id) => store.getFace(id));
  const edges = (selection.ids('edge') as EdgeId[]).map((id) => store.getEdge(id));
  const attributes = [
    ...instances.map((instance) => instance.attributes),
    ...faces.map((face) => face.attributes),
    ...edges.map((edge) => edge.attributes),
  ];
  const single = selection.size === 1 ? instances[0] : undefined;
  const definition = single ? doc.getDefinition(single.definitionId) : undefined;
  return {
    tag: combine(attributes.map((a) => a.tagId)),
    hidden: combine(attributes.map((a) => a.hidden)),
    ...(faces.length === 0 && edges.length === 0
      ? { locked: combine(instances.map((instance) => instance.attributes.locked)) }
      : {}),
    ...(instances.length === 0 && faces.length === 0
      ? {
          soft: combine(edges.map((edge) => edge.attributes.soft)),
          smooth: combine(edges.map((edge) => edge.attributes.smooth)),
        }
      : {}),
    ...(single ? { name: single.attributes.name } : {}),
    ...(definition && !definition.attributes.isGroup
      ? { definition: { id: definition.id, name: definition.attributes.name } }
      : {}),
  };
}

function summarize(
  doc: ModelDocument,
  context: DefinitionId,
  selection: Selection,
  units: UnitSettings,
): Omit<EntityInfo, 'fields'> {
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

  const sections = selection.ids('section') as SectionPlaneId[];
  if (selection.size === 1 && sections[0] !== undefined) {
    const plane = store.getSectionPlane(sections[0]);
    return {
      title: 'Section Plane',
      rows: [{ label: 'Cut', value: plane.active ? 'Active' : 'Inactive' }],
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
      const rows: InfoRow[] = [
        { label: 'Length', value: formatLength(totalLength(), units) },
        { label: 'Faces', value: String(edge.faces.length) },
      ];
      if (edge.curve !== null) {
        const params = store.getCurve(edge.curve).params;
        rows.push({ label: 'Curve', value: CURVE_LABELS[params.kind] });
        if (params.kind !== 'polyline') {
          rows.push({ label: 'Radius', value: formatLength(params.radius, units) });
          rows.push(
            params.kind === 'polygon'
              ? { label: 'Sides', value: String(params.sides) }
              : { label: 'Segments', value: String(params.segments) },
          );
        }
      }
      return { title: 'Edge', rows };
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
            : [
                { label: 'Definition', value: definition.attributes.name },
                { label: 'Instances', value: String(doc.instancesOf(definition.id).length) },
              ]),
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
  if (sections.length > 0) rows.push({ label: 'Section planes', value: String(sections.length) });
  return { title: plural(selection.size, 'entity', 'entities'), rows };
}
