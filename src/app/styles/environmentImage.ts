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

import type { FileTypeFilter } from '../../io/fs/types';

/** Largest environment image accepted from a local file. */
export const MAX_ENVIRONMENT_IMAGE_BYTES = 64 * 1024 * 1024;

export const HDR_FILTER: FileTypeFilter = {
  description: 'Radiance HDR image',
  mimeType: 'image/vnd.radiance',
  extensions: ['.hdr'],
};

/** Whether bytes start like a Radiance HDR file (`#?RADIANCE` or `#?RGBE`). The renderer does the full parse. */
export function isRadianceHeader(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 16));
  return head.startsWith('#?RADIANCE') || head.startsWith('#?RGBE');
}
