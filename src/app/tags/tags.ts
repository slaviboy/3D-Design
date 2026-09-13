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

import type { TagId } from '../../kernel/ids';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import type { Rgb } from '../../kernel/model/types';
import { tagUsage } from '../../kernel/ops/tags';

/** One row of the Tags panel. */
export interface TagRow {
  readonly id: TagId;
  readonly name: string;
  readonly visible: boolean;
  readonly color: Rgb;
  /** Number of edges, faces, groups, components and guides on the tag. */
  readonly usage: number;
}

export const UNTAGGED_LABEL = 'Untagged';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Tags sorted by name, with how much uses each. */
export function listTags(doc: ModelDocument): TagRow[] {
  const usage = tagUsage(doc);
  return [...doc.tags()]
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      visible: tag.visible,
      color: tag.color,
      usage: usage.get(tag.id) ?? 0,
    }))
    .sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);
}

/** `Tag 1`, `Tag 2`, … — the first name no tag uses yet. */
export function uniqueTagName(doc: ModelDocument, base = 'Tag'): string {
  const names = new Set([...doc.tags()].map((tag) => tag.name));
  for (let n = 1; ; n++) {
    const candidate = `${base} ${String(n)}`;
    if (!names.has(candidate)) return candidate;
  }
}

/** Distinct, readable colors handed to new tags in turn (sRGB hex). */
const TAG_COLORS = ['#d9674e', '#4f8fd6', '#5caa62', '#d6a13f', '#9a6bc9', '#3fb0a8', '#c75d93', '#7d8b99'];

export function nextTagColor(doc: ModelDocument): Rgb {
  const count = [...doc.tags()].length;
  return hexToRgb(TAG_COLORS[count % TAG_COLORS.length] ?? '#808080') ?? { r: 0.5, g: 0.5, b: 0.5 };
}

const toSrgb = (linear: number): number =>
  linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
const toLinear = (srgb: number): number => (srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4);

/** A linear RGB color as a `#rrggbb` sRGB string, as color inputs expect. */
export function rgbToHex(color: Rgb): string {
  const channel = (value: number): string =>
    Math.round(Math.min(1, Math.max(0, toSrgb(value))) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** Parses `#rrggbb` (sRGB) into linear RGB, or null when it isn't a hex color. */
export function hexToRgb(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return null;
  const channel = (part: string | undefined): number => toLinear(parseInt(part ?? '0', 16) / 255);
  return { r: channel(match[1]), g: channel(match[2]), b: channel(match[3]) };
}
