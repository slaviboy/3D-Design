/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ValidationProblem } from '../errors';
import type { DefinitionId, FaceId } from '../ids';
import { dot } from '../math/vec3';
import { faceArea } from '../ops/planar/regions';
import { settleLandedFace } from '../ops/planar/settle';
import { err, ok, type Result } from '../result';
import type { Change } from './changes';
import type { DocumentOptions, ModelDocument } from './ModelDocument';
import {
  createLoadedDocument,
  describeProblems,
  readLoadPlan,
  type LoadPlan,
  type TextureBytesSource,
} from './snapshot';
import { validateDocument } from './validate';

/**
 * Problems that only topology operations could fix (welding, splitting, merging). A file that still has them after
 * repair is refused rather than silently reshaped.
 */
export const UNREPAIRABLE_PROBLEMS: ReadonlySet<string> = new Set([
  'unwelded-vertices',
  't-junction',
  'edges-intersect',
  'overlapping-faces',
  'missing-root',
]);

export interface RepairedDocument {
  readonly doc: ModelDocument;
  /** One sentence per fix, empty when the snapshot was already valid. */
  readonly repairs: readonly string[];
}

const MAX_REPAIR_PASSES = 25;
/** Keys for document settings, which have no entity id. Entity ids are always positive. */
const AXES_KEY = -1;
const SHADOWS_KEY = -2;
const STYLE_KEY = -3;
const STYLES_KEY = -4;
const FOG_KEY = -5;
const ENVIRONMENT_KEY = -6;
/** Document settings reset to their defaults when invalid, by validation problem code. */
const SETTINGS_KEYS: ReadonlyMap<
  string,
  { readonly key: number; readonly change: string; readonly label: string }
> = new Map([
  ['invalid-style', { key: STYLE_KEY, change: 'document.style', label: 'the style settings' }],
  ['invalid-styles', { key: STYLES_KEY, change: 'document.styles', label: 'the in-model styles' }],
  ['invalid-fog', { key: FOG_KEY, change: 'document.fog', label: 'the fog settings' }],
  [
    'invalid-environment',
    { key: ENVIRONMENT_KEY, change: 'document.environment', label: 'the environment settings' },
  ],
]);

/**
 * Restores a snapshot, repairing what can be repaired safely instead of refusing the whole file:
 * - references to missing materials, tags or texture images are cleared;
 * - entities that can't be built (a face whose edges are missing, an edge whose vertex is missing, an instance of a
 *   missing definition) are left out, along with anything that depends on them;
 * - entities the validator reports as invalid are left out, invalid drawing axes and shadow settings return to their
 *   defaults, and only the first active section plane of a context stays active;
 * - two faces in one plane facing opposite ways, left by a Push/Pull that reached the far side of a shape before it
 *   learned to cut through there, are cut through as it now does.
 * Structural problems (unreadable fields, duplicate ids) and the {@link UNREPAIRABLE_PROBLEMS} still refuse the file.
 * The result always passes validation.
 */
export function restoreSnapshotWithRepair(
  input: unknown,
  options: DocumentOptions = {},
  textureBytes: TextureBytesSource = () => undefined,
): Result<RepairedDocument> {
  const planned = readLoadPlan(input, textureBytes);
  if (!planned.ok) return err(planned.error);
  const plan = planned.value;
  const labels = new Map<number, string>();
  for (const change of plan.changes) {
    const key = changeKey(change);
    if (key !== null) labels.set(key, entityLabel(change, key));
  }

  const removed = new Map<number, string>();
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    const built = buildLeniently(plan, options, removed, labels);
    if (!built.ok) return err(built.error);
    const { doc, cleared, failed } = built.value;
    // A change that threw may have been partly applied, so rebuild from scratch without it.
    if (failed) continue;

    const report = validateDocument(doc);
    if (report.ok) {
      const clearedStill = [...cleared].filter(([key]) => !removed.has(key)).map(([, text]) => text);
      return ok({ doc, repairs: [...removed.values(), ...clearedStill] });
    }
    let progressed = false;
    const unrepairable: ValidationProblem[] = [];
    for (const problem of report.problems) {
      const keys = keysToRemove(problem);
      if (keys === null) {
        unrepairable.push(problem);
        continue;
      }
      for (const key of keys) {
        const label = labels.get(key);
        if (label === undefined || removed.has(key)) continue;
        removed.set(key, `${removalVerb(key)} ${label}: ${problem.message}`);
        progressed = true;
      }
    }
    if (!progressed) {
      const cuts = cutThroughOpposingFaces(doc, report.problems);
      const remaining = cuts.length > 0 ? validateDocument(doc) : report;
      if (remaining.ok) {
        const clearedStill = [...cleared].filter(([key]) => !removed.has(key)).map(([, text]) => text);
        return ok({ doc, repairs: [...removed.values(), ...clearedStill, ...cuts] });
      }
      const left = remaining.problems.filter((problem) => keysToRemove(problem) === null);
      return err(
        `Invalid document geometry that can't be repaired: ${describeProblems(left.length > 0 ? left : remaining.problems)}`,
      );
    }
  }
  return err('The document has too many problems to repair');
}

function definitionHolding(doc: ModelDocument, faceId: FaceId): DefinitionId | null {
  for (const definition of doc.definitions()) if (definition.store.face(faceId)) return definition.id;
  return null;
}

/**
 * Where two faces overlap in one plane facing opposite ways, a push reached the far side of the shape and left its
 * face lying there. Cuts through as Push/Pull does now: the smaller face is settled onto the other. Faces overlapping
 * the same way are left for the caller to refuse. Returns one line per cut, or none when the cuts failed.
 */
function cutThroughOpposingFaces(doc: ModelDocument, problems: readonly ValidationProblem[]): string[] {
  const overlaps = problems.filter((problem) => problem.code === 'overlapping-faces');
  if (overlaps.length === 0) return [];
  const cuts: string[] = [];
  try {
    doc.transact('Repair', () => {
      for (const { ids } of overlaps) {
        const [a, b] = ids as readonly FaceId[];
        if (a === undefined || b === undefined) continue;
        const context = definitionHolding(doc, a);
        if (context === null) continue;
        const store = doc.store(context);
        const first = store.face(a)?.plane;
        const second = store.face(b)?.plane;
        // Gone already (cut with an earlier pair), or facing the same way.
        if (!first || !second || dot(first.normal, second.normal) >= 0) continue;
        const [smaller, larger] = faceArea(store, a) <= faceArea(store, b) ? [a, b] : [b, a];
        settleLandedFace(doc, context, smaller);
        cuts.push(
          `Cut a hole where face ${String(smaller)} lay on face ${String(larger)}, which faces the other way (a push that reached the far side)`,
        );
      }
    });
  } catch {
    return [];
  }
  doc.clearHistory();
  return cuts;
}

function buildLeniently(
  plan: LoadPlan,
  options: DocumentOptions,
  removed: Map<number, string>,
  labels: ReadonlyMap<number, string>,
): Result<{ doc: ModelDocument; cleared: Map<number, string>; failed: boolean }> {
  const doc = createLoadedDocument(plan, options);
  const present = new Set<number>();
  const cleared = new Map<number, string>();
  let failed = false;
  for (const original of plan.changes) {
    const key = changeKey(original);
    if (key !== null && removed.has(key)) continue;
    const change = withoutMissingReferences(original, present);
    if (change !== original && key !== null) {
      cleared.set(
        key,
        `Cleared references to missing materials, tags or images on ${labels.get(key) ?? 'an entity'}`,
      );
    }
    try {
      doc.applyWithoutHistory([change]);
      if (key !== null) present.add(key);
    } catch (error) {
      if (key === null) return err(`Invalid document: ${errorText(error)}`);
      removed.set(key, `Removed ${labels.get(key) ?? 'an entity'}: ${errorText(error)}`);
      failed = true;
    }
  }
  return ok({ doc, cleared, failed });
}

function keysToRemove(problem: ValidationProblem): readonly number[] | null {
  if (UNREPAIRABLE_PROBLEMS.has(problem.code)) return null;
  const setting = SETTINGS_KEYS.get(problem.code);
  if (setting) return [setting.key];
  switch (problem.code) {
    case 'invalid-axes':
      return [AXES_KEY];
    case 'invalid-shadows':
      return [SHADOWS_KEY];
    case 'multiple-active-sections':
      // Keep the first active plane; the others are removed rather than deactivated, since the change is immutable.
      return problem.ids.slice(1);
    default:
      return problem.ids.length > 0 ? problem.ids : null;
  }
}

function changeKey(change: Change): number | null {
  if (change.kind === 'document.axes') return AXES_KEY;
  if (change.kind === 'document.shadows') return SHADOWS_KEY;
  for (const setting of SETTINGS_KEYS.values()) if (setting.change === change.kind) return setting.key;
  const data = (change as { readonly data?: { readonly id?: unknown } }).data;
  return typeof data?.id === 'number' ? data.id : null;
}

function entityLabel(change: Change, key: number): string {
  if (key === AXES_KEY) return 'the drawing axes';
  if (key === SHADOWS_KEY) return 'the shadow settings';
  for (const setting of SETTINGS_KEYS.values()) if (setting.key === key) return setting.label;
  const kind = change.kind.split('.')[0] ?? 'entity';
  const names: Record<string, string> = { section: 'section plane', asset: 'texture image' };
  return `${names[kind] ?? kind} ${String(key)}`;
}

function removalVerb(key: number): string {
  return key < 0 ? 'Reset' : 'Removed';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Copies `attributes` with the listed id fields set to null where the id isn't present; null when nothing changes. */
function clearMissing<A extends object>(
  attributes: A,
  keys: readonly (keyof A)[],
  present: ReadonlySet<number>,
): A | null {
  let next: A | null = null;
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'number' && !present.has(value)) {
      next ??= { ...attributes };
      (next as Record<keyof A, unknown>)[key] = null;
    }
  }
  return next;
}

function withoutMissingReferences(change: Change, present: ReadonlySet<number>): Change {
  switch (change.kind) {
    case 'material.add': {
      const texture = change.data.texture;
      return texture && !present.has(texture.assetId)
        ? { ...change, data: { ...change.data, texture: null } }
        : change;
    }
    case 'edge.add': {
      const attributes = clearMissing(change.data.attributes, ['materialId', 'tagId'], present);
      return attributes ? { ...change, data: { ...change.data, attributes } } : change;
    }
    case 'face.add': {
      const attributes = clearMissing(
        change.data.attributes,
        ['frontMaterialId', 'backMaterialId', 'tagId'],
        present,
      );
      return attributes ? { ...change, data: { ...change.data, attributes } } : change;
    }
    case 'instance.add': {
      const attributes = clearMissing(change.data.attributes, ['materialId', 'tagId'], present);
      return attributes ? { ...change, data: { ...change.data, attributes } } : change;
    }
    default:
      return change;
  }
}
