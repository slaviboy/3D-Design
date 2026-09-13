import type { DefinitionId, InstanceId, TagId } from '../../kernel/ids';
import { IDENTITY, multiply, type Mat4 } from '../../kernel/math/mat4';
import { ModelDocument, type DocumentEvent } from '../../kernel/model/ModelDocument';
import { DEFAULT_CAMERA, type CameraState } from '../camera/camera';
import { isRefOnVisibleTag, refExists } from '../selection/queries';
import { Selection } from '../selection/Selection';
import type { ToolPreview } from '../tools/Tool';

export type SessionEventKind =
  'document' | 'model' | 'selection' | 'camera' | 'file' | 'context' | 'preview' | 'active-tag' | 'view';

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
  #preview: ToolPreview | null = null;
  #activeTagId: TagId | null = null;
  #camera: CameraState;
  #showSectionPlanes = true;
  #showSectionCuts = true;
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

  /** What the active tool draws in the view (rubber bands, highlights). Not part of the model. */
  get preview(): ToolPreview | null {
    return this.#preview;
  }

  setPreview(preview: ToolPreview | null): void {
    if (preview === this.#preview) return;
    if (preview === null && this.#preview === null) return;
    this.#preview = preview;
    this.#emit({ kind: 'preview' });
  }

  /** Opens a group or component instance of the active context for editing. */
  enterInstance(instanceId: InstanceId): void {
    const instance = this.#doc.store(this.activeContext).instance(instanceId);
    if (!instance) throw new Error('Only a group or component in the open context can be opened');
    this.#editPath = [...this.#editPath, instanceId];
    this.#selection = Selection.EMPTY;
    this.#emit({ kind: 'context' });
    this.#emit({ kind: 'selection' });
  }

  /** Closes the innermost open group or component, selecting it. Returns false when editing the model root. */
  exitContext(): boolean {
    const closed = this.#editPath.at(-1);
    if (closed === undefined) return false;
    this.#editPath = this.#editPath.slice(0, -1);
    this.#selection = Selection.of([{ kind: 'instance', id: closed }]);
    this.#emit({ kind: 'context' });
    this.#emit({ kind: 'selection' });
    return true;
  }

  setSelection(selection: Selection): void {
    const store = this.#doc.store(this.activeContext);
    const valid = selection.filter((ref) => refExists(store, ref));
    if (valid.equals(this.#selection)) return;
    this.#selection = valid;
    this.#emit({ kind: 'selection' });
  }

  /** The tag new groups and components are put on. Session state, not part of the model or its history. */
  get activeTagId(): TagId | null {
    return this.#activeTagId;
  }

  setActiveTag(tagId: TagId | null): void {
    if (tagId !== null && !this.#doc.tag(tagId)) throw new Error('That tag no longer exists');
    if (tagId === this.#activeTagId) return;
    this.#activeTagId = tagId;
    this.#emit({ kind: 'active-tag' });
  }

  /** Whether section plane rectangles are drawn. View state, not part of the model. */
  get showSectionPlanes(): boolean {
    return this.#showSectionPlanes;
  }

  /** Whether active section planes clip the view and show filled cuts. View state, not part of the model. */
  get showSectionCuts(): boolean {
    return this.#showSectionCuts;
  }

  setSectionDisplay(options: { readonly planes?: boolean; readonly cuts?: boolean }): void {
    const planes = options.planes ?? this.#showSectionPlanes;
    const cuts = options.cuts ?? this.#showSectionCuts;
    if (planes === this.#showSectionPlanes && cuts === this.#showSectionCuts) return;
    this.#showSectionPlanes = planes;
    this.#showSectionCuts = cuts;
    // Hidden section planes can't be picked, so they leave the selection.
    if (!planes) this.#selection = this.#selection.filter((ref) => ref.kind !== 'section');
    this.#emit({ kind: 'view' });
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
    this.#activeTagId = null;
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
      this.#pruneAfterModelChange(modelEvent);
      this.#emit({ kind: 'model', modelEvent });
    });
  }

  #pruneAfterModelChange(modelEvent: DocumentEvent): void {
    if (this.#activeTagId !== null && !this.#doc.tag(this.#activeTagId)) {
      this.#activeTagId = null;
      this.#emit({ kind: 'active-tag' });
    }
    // Hiding a tag deselects what is on it, since hidden entities can't be picked again.
    const tagsChanged = modelEvent.changes.some((change) => change.kind.startsWith('tag.'));
    const validPath: InstanceId[] = [];
    let context = this.#doc.rootDefinitionId;
    for (const instanceId of this.#editPath) {
      const instance = this.#doc.store(context).instance(instanceId);
      if (!instance) break;
      validPath.push(instanceId);
      context = instance.definitionId;
    }
    if (validPath.length !== this.#editPath.length) {
      this.#editPath = validPath;
      this.#emit({ kind: 'context' });
    }
    const store = this.#doc.store(this.activeContext);
    const selection = this.#selection.filter(
      (ref) => refExists(store, ref) && (!tagsChanged || isRefOnVisibleTag(this.#doc, store, ref)),
    );
    if (selection !== this.#selection) {
      this.#selection = selection;
      this.#emit({ kind: 'selection' });
    }
  }

  #emit(event: SessionEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}
