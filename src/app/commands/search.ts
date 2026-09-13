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

import type { CommandDefinition } from './CommandRegistry';

const WORD_START_BONUS = 2;
const CONTIGUOUS_BONUS = 1;
const ALIAS_WEIGHT = 0.8;
const DESCRIPTION_WEIGHT = 0.4;

/**
 * Fuzzy match score of `query` against `text` (case-insensitive): 0 when the query's characters don't appear in
 * order. Matches at word starts and contiguous runs score higher, and a plain substring match scores highest.
 */
export function matchScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (q === '') return 1;
  const substringIndex = t.indexOf(q);
  if (substringIndex >= 0) {
    const atWordStart = substringIndex === 0 || /[\s\-./]/.test(t[substringIndex - 1] ?? '');
    return 10 + q.length * 2 + (atWordStart ? 5 : 0) - substringIndex * 0.01;
  }
  let score = 0;
  let position = 0;
  let previous = -2;
  for (const character of q) {
    if (character === ' ') continue;
    const index = t.indexOf(character, position);
    if (index < 0) return 0;
    score += 1;
    if (index === 0 || /[\s\-./]/.test(t[index - 1] ?? '')) score += WORD_START_BONUS;
    if (index === previous + 1) score += CONTIGUOUS_BONUS;
    previous = index;
    position = index + 1;
  }
  return score;
}

/** Commands matching a query, best first. An empty query returns every command in registration order. */
export function searchCommands<Context>(
  commands: readonly CommandDefinition<Context>[],
  query: string,
): CommandDefinition<Context>[] {
  if (query.trim() === '') return [...commands];
  return commands
    .map((command, order) => {
      const score = Math.max(
        matchScore(query, command.label),
        matchScore(query, `${command.category} ${command.label}`),
        ...(command.aliases ?? []).map((alias) => matchScore(query, alias) * ALIAS_WEIGHT),
        command.description ? matchScore(query, command.description) * DESCRIPTION_WEIGHT : 0,
      );
      return { command, score, order };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.command);
}
