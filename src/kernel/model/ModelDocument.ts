import { KernelError, KernelInvariantError } from '../errors';
import { IdAllocator, type DefinitionId, type MaterialId, type TagId } from '../ids';
import { changeContext, invertChange, type Change } from './changes';
import { EntityStore, type InstanceView } from './EntityStore';
import {
  DEFAULT_MODEL_AXES,
  type DefinitionAttributes,
  type MaterialData,
  type ModelAxes,
  type TagData,
} from './types';
import { validateDocument } from './validate';

export const DEFAULT_HISTORY_LIMIT = 500;
export const ROOT_DEFINITION_NAME = 'Model';

export interface DocumentOptions {
  /** Validate every touched definition when a transaction commits, and roll back on failure. Meant for development and tests. */
  readonly validateOnCommit?: boolean;
  /** Maximum number of undoable transactions to keep. */
  readonly historyLimit?: number;
}

export interface DocumentInit {
  readonly rootDefinitionId?: DefinitionId;
  readonly nextId?: number;
}

export interface TransactionRecord {
  readonly id: number;
  readonly label: string;
  readonly changes: readonly Change[];
}

export type DocumentEventKind = 'commit' | 'undo' | 'redo' | 'rollback';

export interface DocumentEvent {
  readonly kind: DocumentEventKind;
  readonly label: string;
  /** The changes as they were applied, in order. For undo and rollback these are the inverted changes. */
  readonly changes: readonly Change[];
}

export type DocumentListener = (event: DocumentEvent) => void;

export interface DefinitionView {
  readonly id: DefinitionId;
  readonly attributes: DefinitionAttributes;
  readonly store: EntityStore;
}

interface DefinitionRecord extends DefinitionView {
  attributes: DefinitionAttributes;
}

interface ActiveTransaction {
  readonly label: string;
  readonly changes: Change[];
}

/**
 * A complete model: component definitions (the root definition included), materials and tags, plus undo history.
 *
 * All modifications happen inside {@link transact}. Each is a {@link Change} applied through {@link apply},
 * so it is recorded, can be undone and redone, and is reported to subscribers.
 */
export class ModelDocument {
  readonly ids: IdAllocator;
  readonly rootDefinitionId: DefinitionId;

  readonly #validateOnCommit: boolean;
  readonly #historyLimit: number;
  readonly #definitions = new Map<DefinitionId, DefinitionRecord>();
  readonly #materials = new Map<MaterialId, MaterialData>();
  readonly #tags = new Map<TagId, TagData>();
  readonly #undoStack: TransactionRecord[] = [];
  readonly #redoStack: TransactionRecord[] = [];
  readonly #listeners = new Set<DocumentListener>();
  #active: ActiveTransaction | null = null;
  #nextTransactionId = 1;
  #axes: ModelAxes = DEFAULT_MODEL_AXES;

  constructor(options: DocumentOptions = {}, init: DocumentInit = {}) {
    this.#validateOnCommit = options.validateOnCommit ?? false;
    this.#historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    if (!Number.isSafeInteger(this.#historyLimit) || this.#historyLimit < 0) {
      throw new KernelError('invalid-operation', 'historyLimit must be a non-negative integer');
    }
    this.ids = new IdAllocator(init.nextId ?? 1);
    const rootId = init.rootDefinitionId ?? (this.ids.allocate() as DefinitionId);
    this.ids.reserveThrough(rootId);
    this.rootDefinitionId = rootId;
    this.#definitions.set(rootId, {
      id: rootId,
      attributes: { name: ROOT_DEFINITION_NAME, isGroup: false },
      store: new EntityStore(rootId),
    });
  }

  // ---------------------------------------------------------------------------------------------- reading

  get rootStore(): EntityStore {
    return this.store(this.rootDefinitionId);
  }

  definition(id: DefinitionId): DefinitionView | undefined {
    return this.#definitions.get(id);
  }

  getDefinition(id: DefinitionId): DefinitionView {
    const definition = this.#definitions.get(id);
    if (!definition) throw new KernelError('missing-entity', `Definition ${String(id)} does not exist`);
    return definition;
  }

  store(id: DefinitionId): EntityStore {
    return this.getDefinition(id).store;
  }

  definitions(): IterableIterator<DefinitionView> {
    return this.#definitions.values();
  }

  material(id: MaterialId): MaterialData | undefined {
    return this.#materials.get(id);
  }

  materials(): IterableIterator<MaterialData> {
    return this.#materials.values();
  }

  tag(id: TagId): TagData | undefined {
    return this.#tags.get(id);
  }

  tags(): IterableIterator<TagData> {
    return this.#tags.values();
  }

  /** The drawing axes that inference, drawing planes and typed coordinates use. */
  get axes(): ModelAxes {
    return this.#axes;
  }

  /** Every instance of `definitionId`, together with the definition that contains it. */
  instancesOf(definitionId: DefinitionId): { context: DefinitionId; instance: InstanceView }[] {
    const result: { context: DefinitionId; instance: InstanceView }[] = [];
    for (const definition of this.#definitions.values()) {
      for (const instance of definition.store.instances()) {
        if (instance.definitionId === definitionId) result.push({ context: definition.id, instance });
      }
    }
    return result;
  }

  /** True when `target` is `ancestor` itself or is instanced somewhere inside it, at any depth. */
  definitionContains(ancestor: DefinitionId, target: DefinitionId): boolean {
    const visited = new Set<DefinitionId>();
    const stack = [ancestor];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      if (current === target) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const definition = this.#definitions.get(current);
      if (!definition) continue;
      for (const instance of definition.store.instances()) stack.push(instance.definitionId);
    }
    return false;
  }

  // ---------------------------------------------------------------------------------------------- transactions

  get isInTransaction(): boolean {
    return this.#active !== null;
  }

  /**
   * Runs `fn` as one undoable transaction.
   *
   * If `fn` throws, or validation is enabled and fails, every change is rolled back and the error is rethrown.
   * Nested calls join the enclosing transaction. A transaction that changes nothing creates no history entry.
   */
  transact<T>(label: string, fn: () => T): T {
    if (this.#active) return fn();
    const transaction: ActiveTransaction = { label, changes: [] };
    this.#active = transaction;
    let result: T;
    try {
      result = fn();
      if (this.#validateOnCommit && transaction.changes.length > 0) {
        const report = validateDocument(this, { definitions: touchedDefinitions(transaction.changes) });
        if (!report.ok) throw new KernelInvariantError(label, report.problems);
      }
    } catch (error) {
      this.#revert(transaction.changes);
      this.#active = null;
      throw error;
    }
    this.#active = null;
    if (transaction.changes.length > 0) {
      const record: TransactionRecord = {
        id: this.#nextTransactionId++,
        label,
        changes: transaction.changes,
      };
      this.#undoStack.push(record);
      if (this.#undoStack.length > this.#historyLimit) {
        this.#undoStack.splice(0, this.#undoStack.length - this.#historyLimit);
      }
      this.#redoStack.length = 0;
      this.#emit({ kind: 'commit', label, changes: record.changes });
    }
    return result;
  }

  /** Applies one change and records it in the active transaction. */
  apply(change: Change): void {
    const transaction = this.#active;
    if (!transaction) {
      throw new KernelError(
        'transaction-required',
        `Change "${change.kind}" must be applied inside a transaction`,
      );
    }
    this.#applyRaw(change);
    transaction.changes.push(change);
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.#undoStack.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.#redoStack.at(-1)?.label;
  }

  get undoDepth(): number {
    return this.#undoStack.length;
  }

  get redoDepth(): number {
    return this.#redoStack.length;
  }

  /** The most recent undoable transaction, if any. */
  get lastTransaction(): TransactionRecord | undefined {
    return this.#undoStack.at(-1);
  }

  undo(): boolean {
    this.#assertNoTransaction('undo');
    const record = this.#undoStack.pop();
    if (!record) return false;
    const applied = this.#revert(record.changes);
    this.#redoStack.push(record);
    this.#emit({ kind: 'undo', label: record.label, changes: applied });
    return true;
  }

  redo(): boolean {
    this.#assertNoTransaction('redo');
    const record = this.#redoStack.pop();
    if (!record) return false;
    for (const change of record.changes) this.#applyRaw(change);
    this.#undoStack.push(record);
    this.#emit({ kind: 'redo', label: record.label, changes: record.changes });
    return true;
  }

  /**
   * Reverts the most recent transaction without making it redoable. Used when a typed measurement replaces the
   * operation that was just committed.
   */
  rollbackLastTransaction(): TransactionRecord | undefined {
    this.#assertNoTransaction('rollback');
    const record = this.#undoStack.pop();
    if (!record) return undefined;
    const applied = this.#revert(record.changes);
    this.#emit({ kind: 'rollback', label: record.label, changes: applied });
    return record;
  }

  clearHistory(): void {
    this.#undoStack.length = 0;
    this.#redoStack.length = 0;
  }

  subscribe(listener: DocumentListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Applies changes directly, with no history entry and no notification. Only for building a document from
   * trusted, already validated data (for example, when loading a snapshot).
   */
  applyWithoutHistory(changes: Iterable<Change>): void {
    this.#assertNoTransaction('load');
    for (const change of changes) this.#applyRaw(change);
  }

  // ---------------------------------------------------------------------------------------------- internals

  #assertNoTransaction(action: string): void {
    if (this.#active) {
      throw new KernelError('transaction-active', `Cannot ${action} while a transaction is in progress`);
    }
  }

  /** Applies the inverses of `changes` in reverse order and returns the inverted changes as applied. */
  #revert(changes: readonly Change[]): Change[] {
    const applied: Change[] = [];
    for (let i = changes.length - 1; i >= 0; i--) {
      const change = changes[i];
      if (!change) continue;
      const inverse = invertChange(change);
      this.#applyRaw(inverse);
      applied.push(inverse);
    }
    return applied;
  }

  #emit(event: DocumentEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }

  #applyRaw(change: Change): void {
    switch (change.kind) {
      case 'vertex.add':
        this.store(change.context).applyAddVertex(change.data);
        return;
      case 'vertex.remove':
        this.store(change.context).applyRemoveVertex(change.data.id);
        return;
      case 'vertex.move':
        this.store(change.context).applyMoveVertex(change.id, change.to);
        return;
      case 'edge.add':
        this.store(change.context).applyAddEdge(change.data);
        return;
      case 'edge.remove':
        this.store(change.context).applyRemoveEdge(change.data.id);
        return;
      case 'edge.attributes':
        this.store(change.context).applySetEdgeAttributes(change.id, change.to);
        return;
      case 'face.add':
        this.store(change.context).applyAddFace(change.data);
        return;
      case 'face.remove':
        this.store(change.context).applyRemoveFace(change.data.id);
        return;
      case 'face.loops':
        this.store(change.context).applySetFaceLoops(change.id, change.to);
        return;
      case 'face.attributes':
        this.store(change.context).applySetFaceAttributes(change.id, change.to);
        return;
      case 'curve.add':
        this.store(change.context).applyAddCurve(change.data);
        return;
      case 'curve.remove':
        this.store(change.context).applyRemoveCurve(change.data.id);
        return;
      case 'curve.params':
        this.store(change.context).applySetCurveParams(change.id, change.to);
        return;
      case 'curve.edges':
        this.store(change.context).applySetCurveEdges(change.id, change.to);
        return;
      case 'instance.add':
        this.#applyAddInstance(change.context, change.data.definitionId);
        this.store(change.context).applyAddInstance(change.data);
        return;
      case 'instance.remove':
        this.store(change.context).applyRemoveInstance(change.data.id);
        return;
      case 'instance.transform':
        this.store(change.context).applySetInstanceTransform(change.id, change.to);
        return;
      case 'instance.attributes':
        this.store(change.context).applySetInstanceAttributes(change.id, change.to);
        return;
      case 'guide.add':
        this.store(change.context).applyAddGuide(change.data);
        return;
      case 'guide.remove':
        this.store(change.context).applyRemoveGuide(change.data.id);
        return;
      case 'guide.attributes':
        this.store(change.context).applySetGuideAttributes(change.id, change.to);
        return;
      case 'definition.add':
        if (this.#definitions.has(change.data.id)) {
          throw new KernelError('duplicate-entity', `Definition ${String(change.data.id)} already exists`);
        }
        this.ids.reserveThrough(change.data.id);
        this.#definitions.set(change.data.id, {
          id: change.data.id,
          attributes: { name: change.data.name, isGroup: change.data.isGroup },
          store: new EntityStore(change.data.id),
        });
        return;
      case 'definition.remove':
        this.#applyRemoveDefinition(change.data.id);
        return;
      case 'definition.attributes':
        this.#getDefinitionRecord(change.id).attributes = change.to;
        return;
      case 'material.add':
        if (this.#materials.has(change.data.id)) {
          throw new KernelError('duplicate-entity', `Material ${String(change.data.id)} already exists`);
        }
        this.#materials.set(change.data.id, change.data);
        return;
      case 'material.remove':
        if (!this.#materials.delete(change.data.id)) {
          throw new KernelError('missing-entity', `Material ${String(change.data.id)} does not exist`);
        }
        return;
      case 'material.attributes': {
        const existing = this.#materials.get(change.id);
        if (!existing)
          throw new KernelError('missing-entity', `Material ${String(change.id)} does not exist`);
        this.#materials.set(change.id, { ...change.to, id: change.id });
        return;
      }
      case 'tag.add':
        if (this.#tags.has(change.data.id)) {
          throw new KernelError('duplicate-entity', `Tag ${String(change.data.id)} already exists`);
        }
        this.#tags.set(change.data.id, change.data);
        return;
      case 'tag.remove':
        if (!this.#tags.delete(change.data.id)) {
          throw new KernelError('missing-entity', `Tag ${String(change.data.id)} does not exist`);
        }
        return;
      case 'tag.attributes': {
        const existing = this.#tags.get(change.id);
        if (!existing) throw new KernelError('missing-entity', `Tag ${String(change.id)} does not exist`);
        this.#tags.set(change.id, { ...change.to, id: change.id });
        return;
      }
      case 'document.axes':
        this.#axes = change.to;
        return;
    }
  }

  #applyAddInstance(context: DefinitionId, definitionId: DefinitionId): void {
    this.getDefinition(definitionId);
    if (definitionId === this.rootDefinitionId) {
      throw new KernelError('invalid-operation', 'The root definition cannot be instanced');
    }
    if (this.definitionContains(definitionId, context)) {
      throw new KernelError(
        'invalid-operation',
        `Placing definition ${String(definitionId)} inside ${String(context)} would create a cycle`,
      );
    }
  }

  #applyRemoveDefinition(id: DefinitionId): void {
    const record = this.#getDefinitionRecord(id);
    if (id === this.rootDefinitionId) {
      throw new KernelError('invalid-operation', 'The root definition cannot be removed');
    }
    if (!record.store.isEmpty) {
      throw new KernelError('invalid-operation', `Definition ${String(id)} still contains entities`);
    }
    if (this.instancesOf(id).length > 0) {
      throw new KernelError('invalid-operation', `Definition ${String(id)} still has instances`);
    }
    this.#definitions.delete(id);
  }

  #getDefinitionRecord(id: DefinitionId): DefinitionRecord {
    const record = this.#definitions.get(id);
    if (!record) throw new KernelError('missing-entity', `Definition ${String(id)} does not exist`);
    return record;
  }
}

function touchedDefinitions(changes: readonly Change[]): Set<DefinitionId> {
  const touched = new Set<DefinitionId>();
  for (const change of changes) {
    const context = changeContext(change);
    if (context !== null) touched.add(context);
  }
  return touched;
}
