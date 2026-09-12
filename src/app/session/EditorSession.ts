import type { DefinitionId, InstanceId } from '../../kernel/ids';
import { IDENTITY, multiply, type Mat4 } from '../../kernel/math/mat4';
import { ModelDocument, type DocumentEvent } from '../../kernel/model/ModelDocument';
import { DEFAULT_CAMERA, type CameraState } from '../camera/camera';
import { refExists } from '../selection/queries';
import { Selection } from '../selection/Selection';

export type SessionEventKind = 'document' | 'model' | 'selection' | 'camera' | 'file';

export interface SessionEvent {
  readonly kind: SessionEventKind;
  /** The kernel event, for `model` events. */
  readonly modelEvent?: DocumentEvent;
}

export type SessionListener = (event: SessionEvent) => void;

export const UNTITLED_DOCUMENT_NAME = 'Untitled';

export interface ReplaceDocumentOptions {
  readonly name: string;
  readonly fileHandle?: unknown;
  /** Treat the new document as having unsaved changes (for example, recovered work). */
  readonly dirty?: boolean;
}

/**
 * The editing state around one document: the open edit path, selection, camera, and file identity.
 * Emits events so the renderer and UI can refresh without polling.
 */
export class EditorSession {
  #doc: ModelDocument;
  #detach: () => void = () => undefined;
  #editPath: readonly InstanceId[] = [];
  #selection: Selection = Selection.EMPTY;
  #camera: CameraState;
  #revision = 0;
  #savedRevision = 0;
  #documentName = UNTITLED_DOCUMENT_NAME;
  #fileHandle: unknown = null;
  readonly #listeners = new Set<SessionListener>();

  constructor(doc: ModelDocument = new ModelDocument(), camera: CameraState = DEFAULT_CAMERA) {
    this.#doc = doc;
    this.#camera = camera;
    this.#attach(doc);
  }

  get doc(): ModelDocument {
    return this.#doc;
  }

  /** Increases on every document change, undo, redo and document replacement. */
  get revision(): number {
    return this.#revision;
  }

  get isDirty(): boolean {
    return this.#revision !== this.#savedRevision;
  }

  get documentName(): string {
    return this.#documentName;
  }

  get fileHandle(): unknown {
    return this.#fileHandle;
  }

  get selection(): Selection {
    return this.#selection;
  }

  get camera(): CameraState {
    return this.#camera;
  }

  /** Instances opened for editing, outermost first. Empty when editing the model root. */
  get editPath(): readonly InstanceId[] {
    return this.#editPath;
  }

  /** The definition whose geometry tools currently edit. */
  get activeContext(): DefinitionId {
    let context = this.#doc.rootDefinitionId;
    for (const instanceId of this.#editPath) {
      const instance = this.#doc.store(context).instance(instanceId);
      if (!instance) break;
      context = instance.definitionId;
    }
    return context;
  }

  /** Maps coordinates of the active context to world coordinates. */
  get activeContextTransform(): Mat4 {
    let context = this.#doc.rootDefinitionId;
    let transform = IDENTITY;
    for (const instanceId of this.#editPath) {
      const instance = this.#doc.store(context).instance(instanceId);
      if (!instance) break;
      transform = multiply(transform, instance.transform);
      context = instance.definitionId;
    }
    return transform;
  }

  setSelection(selection: Selection): void {
    const store = this.#doc.store(this.activeContext);
    const valid = selection.filter((ref) => refExists(store, ref));
    if (valid.equals(this.#selection)) return;
    this.#selection = valid;
    this.#emit({ kind: 'selection' });
  }

  setCamera(camera: CameraState): void {
    if (camera === this.#camera) return;
    this.#camera = camera;
    this.#emit({ kind: 'camera' });
  }

  replaceDocument(doc: ModelDocument, options: ReplaceDocumentOptions): void {
    this.#detach();
    this.#doc = doc;
    this.#attach(doc);
    this.#editPath = [];
    this.#selection = Selection.EMPTY;
    this.#documentName = options.name;
    this.#fileHandle = options.fileHandle ?? null;
    this.#revision++;
    this.#savedRevision = options.dirty === true ? -1 : this.#revision;
    this.#emit({ kind: 'document' });
  }

  markSaved(name: string, fileHandle: unknown): void {
    this.#savedRevision = this.#revision;
    this.#documentName = name;
    this.#fileHandle = fileHandle;
    this.#emit({ kind: 'file' });
  }

  subscribe(listener: SessionListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #attach(doc: ModelDocument): void {
    this.#detach = doc.subscribe((modelEvent) => {
      this.#revision++;
      this.#pruneAfterModelChange();
      this.#emit({ kind: 'model', modelEvent });
    });
  }

  #pruneAfterModelChange(): void {
    const validPath: InstanceId[] = [];
    let context = this.#doc.rootDefinitionId;
    for (const instanceId of this.#editPath) {
      const instance = this.#doc.store(context).instance(instanceId);
      if (!instance) break;
      validPath.push(instanceId);
      context = instance.definitionId;
    }
    if (validPath.length !== this.#editPath.length) this.#editPath = validPath;
    const store = this.#doc.store(this.activeContext);
    const selection = this.#selection.filter((ref) => refExists(store, ref));
    if (selection !== this.#selection) {
      this.#selection = selection;
      this.#emit({ kind: 'selection' });
    }
  }

  #emit(event: SessionEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}
