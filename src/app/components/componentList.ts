import type { DefinitionId } from '../../kernel/ids';
import type { ModelDocument } from '../../kernel/model/ModelDocument';

/** One component definition in the Components panel. */
export interface ComponentRow {
  readonly id: DefinitionId;
  readonly name: string;
  /** Instances anywhere in the model. */
  readonly instanceCount: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Reusable component definitions in the model (groups and the model root are not listed), sorted by name. */
export function listComponentDefinitions(doc: ModelDocument): ComponentRow[] {
  const counts = new Map<DefinitionId, number>();
  for (const definition of doc.definitions()) {
    for (const instance of definition.store.instances()) {
      counts.set(instance.definitionId, (counts.get(instance.definitionId) ?? 0) + 1);
    }
  }
  return [...doc.definitions()]
    .filter((definition) => definition.id !== doc.rootDefinitionId && !definition.attributes.isGroup)
    .map((definition) => ({
      id: definition.id,
      name: definition.attributes.name,
      instanceCount: counts.get(definition.id) ?? 0,
    }))
    .sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);
}
