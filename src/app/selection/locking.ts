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

import type { DefinitionId, InstanceId } from '../../kernel/ids';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import type { EntityRef } from './Selection';

/** Shown whenever an edit is refused because it would change a locked group or component. */
export const LOCKED_MESSAGE = "Locked groups and components can't be changed";

export function isInstanceLocked(doc: ModelDocument, context: DefinitionId, id: InstanceId): boolean {
  return doc.store(context).instance(id)?.attributes.locked === true;
}

/** True when any of `refs` is a locked instance of `context`. */
export function hasLockedInstance(
  doc: ModelDocument,
  context: DefinitionId,
  refs: readonly EntityRef[],
): boolean {
  return refs.some((ref) => ref.kind === 'instance' && isInstanceLocked(doc, context, ref.id as InstanceId));
}

/** The part of the editor the lock guard needs, so tools and the editor can share it. */
export interface LockGuardHost {
  readonly session: { readonly doc: ModelDocument; readonly activeContext: DefinitionId };
  notify(kind: 'error', message: string): void;
}

/**
 * Refuses an edit that touches a locked instance of the active context: shows the error notification and returns
 * true. Commands and tools call this before changing anything.
 */
export function refuseLocked(host: LockGuardHost, refs: readonly EntityRef[]): boolean {
  if (!hasLockedInstance(host.session.doc, host.session.activeContext, refs)) return false;
  host.notify('error', LOCKED_MESSAGE);
  return true;
}
