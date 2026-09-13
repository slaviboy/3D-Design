import type { DefinitionId } from '../../kernel/ids';
import { aabbIsEmpty } from '../../kernel/math/aabb';
import { transformPoint, translation } from '../../kernel/math/mat4';
import { add, sub, vec3, type Vec3 } from '../../kernel/math/vec3';
import { addInstance } from '../../kernel/model/mutations';
import { DEFAULT_INSTANCE_ATTRIBUTES } from '../../kernel/model/types';
import type { Editor } from '../Editor';
import { aabbCorners, definitionBounds } from '../geometry/bounds';
import type { Inference } from '../inference/inference';
import { Selection } from '../selection/Selection';
import {
  PRIMARY_BUTTON,
  SELECT_TOOL_ID,
  type PointerInput,
  type PreviewLine,
  type Tool,
  type ToolPreview,
} from './Tool';
import { inferAt, markerFor, toLocalPoint } from './toolSupport';

export const PLACE_COMPONENT_TOOL_ID = 'tool.placeComponent';

/** Corner index pairs of a box from `aabbCorners` (index bits: x·4 + y·2 + z). */
const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

const EMPTY_PREVIEW: ToolPreview = { lines: [], highlight: [], marker: null };

/**
 * Places a new instance of a component definition. The definition's bounding box follows the inferred cursor point
 * (translation only, with the box's minimum corner at the cursor); a click adds the instance to the active context.
 * Esc cancels and returns to the Select tool.
 */
export class ComponentPlacementTool implements Tool {
  readonly id = PLACE_COMPONENT_TOOL_ID;
  readonly label = 'Place Component';
  readonly cursor = 'copy';

  #definition: DefinitionId | null = null;
  #inference: Inference | null = null;

  /** The definition the next click places, if any. */
  get definitionId(): DefinitionId | null {
    return this.#definition;
  }

  setDefinition(definitionId: DefinitionId | null): void {
    this.#definition = definitionId;
    this.#inference = null;
  }

  deactivate(): void {
    this.setDefinition(null);
  }

  cancel(): void {
    this.#inference = null;
  }

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#inference = this.#definition === null ? null : inferAt(editor, input);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const { session } = editor;
    const doc = session.doc;
    const definitionId = this.#definition;
    if (definitionId === null || !doc.definition(definitionId)) {
      throw new Error('Choose a component to place in the Components panel');
    }
    const offset = this.#offset(editor, definitionId, inferAt(editor, input).point);
    const context = session.activeContext;
    const attributes = { ...DEFAULT_INSTANCE_ATTRIBUTES, tagId: session.activeTagId };
    const instance = doc.transact('Place Component', () =>
      addInstance(doc, context, definitionId, translation(offset), attributes),
    );
    session.setSelection(Selection.of([{ kind: 'instance', id: instance }]));
    editor.activateTool(SELECT_TOOL_ID);
  }

  keyDown(chord: string, editor: Editor): boolean {
    if (chord !== 'Escape') return false;
    editor.activateTool(SELECT_TOOL_ID);
    return true;
  }

  preview(editor: Editor): ToolPreview {
    const definitionId = this.#definition;
    const inference = this.#inference;
    const doc = editor.session.doc;
    if (definitionId === null || !inference || !doc.definition(definitionId)) return EMPTY_PREVIEW;
    const marker = markerFor(inference);
    const bounds = definitionBounds(doc, definitionId);
    if (aabbIsEmpty(bounds)) return { lines: [], highlight: [], marker };
    const offset = this.#offset(editor, definitionId, inference.point);
    const toWorld = editor.session.activeContextTransform;
    const corners = aabbCorners(bounds).map((corner) => transformPoint(toWorld, add(corner, offset)));
    const lines: PreviewLine[] = [];
    for (const [a, b] of BOX_EDGES) {
      const start = corners[a];
      const end = corners[b];
      if (start && end) lines.push({ a: start, b: end, style: 'preview' });
    }
    return { lines, highlight: [], marker };
  }

  statusHint(editor: Editor): string {
    const definition =
      this.#definition === null ? undefined : editor.session.doc.definition(this.#definition);
    return definition
      ? `Click to place ${definition.attributes.name}. Esc cancels.`
      : 'Choose a component in the Components panel, then click to place it.';
  }

  /** Translation (in active-context coordinates) that puts the definition's minimum corner at the world point. */
  #offset(editor: Editor, definitionId: DefinitionId, worldPoint: Vec3): Vec3 {
    const local = toLocalPoint(editor, worldPoint);
    const bounds = definitionBounds(editor.session.doc, definitionId);
    return aabbIsEmpty(bounds) ? local : sub(local, vec3(bounds.minX, bounds.minY, bounds.minZ));
  }
}
