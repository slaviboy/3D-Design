export type SelectableKind = 'face' | 'edge' | 'instance' | 'section';

/** Reference to a selectable entity in the active editing context. */
export interface EntityRef {
  readonly kind: SelectableKind;
  readonly id: number;
}

const KIND_ORDER: Readonly<Record<SelectableKind, number>> = { instance: 0, face: 1, edge: 2, section: 3 };

function keyOf(ref: EntityRef): string {
  return `${ref.kind}:${String(ref.id)}`;
}

/** Immutable set of selected entities. Every operation returns a new selection. */
export class Selection {
  static readonly EMPTY = new Selection(new Map());

  readonly #items: ReadonlyMap<string, EntityRef>;

  private constructor(items: ReadonlyMap<string, EntityRef>) {
    this.#items = items;
  }

  static of(refs: Iterable<EntityRef>): Selection {
    const items = new Map<string, EntityRef>();
    for (const ref of refs) items.set(keyOf(ref), { kind: ref.kind, id: ref.id });
    return items.size === 0 ? Selection.EMPTY : new Selection(items);
  }

  get size(): number {
    return this.#items.size;
  }

  get isEmpty(): boolean {
    return this.#items.size === 0;
  }

  has(ref: EntityRef): boolean {
    return this.#items.has(keyOf(ref));
  }

  /** Selected entities ordered by kind (instances, faces, edges), then id. */
  refs(): EntityRef[] {
    return [...this.#items.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id - b.id);
  }

  ids(kind: SelectableKind): number[] {
    return this.refs()
      .filter((ref) => ref.kind === kind)
      .map((ref) => ref.id);
  }

  count(kind: SelectableKind): number {
    let total = 0;
    for (const ref of this.#items.values()) if (ref.kind === kind) total++;
    return total;
  }

  union(refs: Iterable<EntityRef>): Selection {
    return Selection.of([...this.#items.values(), ...refs]);
  }

  subtract(refs: Iterable<EntityRef>): Selection {
    const removed = new Set([...refs].map(keyOf));
    return Selection.of([...this.#items.values()].filter((ref) => !removed.has(keyOf(ref))));
  }

  /** Adds entities that aren't selected and removes those that are. */
  toggle(refs: Iterable<EntityRef>): Selection {
    const items = new Map(this.#items);
    for (const ref of refs) {
      const key = keyOf(ref);
      if (items.has(key)) items.delete(key);
      else items.set(key, ref);
    }
    return Selection.of(items.values());
  }

  filter(predicate: (ref: EntityRef) => boolean): Selection {
    const kept = [...this.#items.values()].filter(predicate);
    return kept.length === this.#items.size ? this : Selection.of(kept);
  }

  equals(other: Selection): boolean {
    if (other.size !== this.size) return false;
    for (const key of this.#items.keys()) if (!other.#items.has(key)) return false;
    return true;
  }
}

/** How a new pick or box selection combines with the current selection. */
export type SelectionMode = 'replace' | 'add' | 'toggle' | 'subtract';

export function applySelection(
  current: Selection,
  refs: readonly EntityRef[],
  mode: SelectionMode,
): Selection {
  switch (mode) {
    case 'replace':
      return Selection.of(refs);
    case 'add':
      return current.union(refs);
    case 'toggle':
      return current.toggle(refs);
    case 'subtract':
      return current.subtract(refs);
  }
}
