import { vec3 } from '../../kernel/math/vec3';
import { ModelDocument } from '../../kernel/model/ModelDocument';
import { setInstanceAttributes } from '../../kernel/model/mutations';
import { makeGroup } from '../../kernel/ops/hierarchy';
import { insertSegments } from '../../kernel/ops/insertSegments';
import type { StandardView } from '../camera/camera';
import { createSampleModel } from '../sample/sampleModel';

/** A starting point for a new model. Templates are built from kernel operations; none are loaded from anywhere. */
export interface ModelTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly create: () => ModelDocument;
  /** Standard view that frames the new model, or null for the default camera. */
  readonly view: StandardView | null;
}

/** Side length of the site in the Site Plan template, in meters. */
const SITE_SIZE = 20;

function createSitePlan(): ModelDocument {
  const doc = new ModelDocument();
  const root = doc.rootDefinitionId;
  doc.transact('Build site plan', () => {
    const half = SITE_SIZE / 2;
    const corners = [vec3(-half, -half, 0), vec3(half, -half, 0), vec3(half, half, 0), vec3(-half, half, 0)];
    insertSegments(
      doc,
      root,
      corners.map((a, i) => ({ a, b: corners[(i + 1) % corners.length] ?? a })),
      { autoFace: true },
    );
    const { instance } = makeGroup(doc, root, { faces: [...doc.store(root).faces()].map((face) => face.id) });
    setInstanceAttributes(doc, root, instance, { name: 'Site' });
  });
  doc.clearHistory();
  return doc;
}

function withoutHistory(create: () => ModelDocument): () => ModelDocument {
  return () => {
    const doc = create();
    doc.clearHistory();
    return doc;
  };
}

export const TEMPLATES: readonly ModelTemplate[] = [
  {
    id: 'empty',
    name: 'Empty Model',
    description: 'Start from nothing, with the drawing axes at the origin.',
    create: () => new ModelDocument(),
    view: null,
  },
  {
    id: 'site',
    name: 'Site Plan',
    description: `A ${String(SITE_SIZE)} m × ${String(SITE_SIZE)} m site on the ground, as a group.`,
    create: createSitePlan,
    view: 'iso',
  },
  {
    id: 'sample',
    name: 'Sample House',
    description: 'A small gabled house to explore the tools with.',
    create: withoutHistory(createSampleModel),
    view: 'iso',
  },
];

export function templateById(id: string): ModelTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id);
}
