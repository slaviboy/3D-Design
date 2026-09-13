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

import type { TagId } from '../ids';
import type { ModelDocument } from './ModelDocument';

/**
 * Whether entities on `tagId` are shown. Untagged entities (and references to tags that no longer exist) are always
 * visible. Rendering, picking, box selection and inference all use this, so a hidden tag hides consistently.
 */
export function isTagVisible(doc: ModelDocument, tagId: TagId | null): boolean {
  return tagId === null || (doc.tag(tagId)?.visible ?? true);
}
