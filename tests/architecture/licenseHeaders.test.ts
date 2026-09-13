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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'mjs', 'cjs', 'css', 'html', 'svg']);
/** Generated, installed or data directories. Test fixtures are sample files whose exact bytes the tests rely on. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dev-dist',
  'coverage',
  'playwright-report',
  'test-results',
  '.git',
  '.claude',
  'fixtures',
]);

export const LICENSE_HEADER_LINES: readonly string[] = [
  'Copyright (C) 2026 Stanislav Georgiev',
  'https://github.com/slaviboy',
  '',
  'Licensed under the Apache License, Version 2.0 (the "License");',
  'you may not use this file except in compliance with the License.',
  'You may obtain a copy of the License at',
  '',
  '     http://www.apache.org/licenses/LICENSE-2.0',
  '',
  'Unless required by applicable law or agreed to in writing, software',
  'distributed under the License is distributed on an "AS IS" BASIS,',
  'WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.',
  'See the License for the specific language governing permissions and',
  'limitations under the License.',
];

const BLOCK_HEADER = `/*\n${LICENSE_HEADER_LINES.map((line) => (line ? ` * ${line}` : ' *')).join('\n')}\n */\n`;
const MARKUP_HEADER = `<!--\n${LICENSE_HEADER_LINES.map((line) => (line ? `  ${line}` : '')).join('\n')}\n-->\n`;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(name)) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else {
      const extension = name.includes('.') ? (name.split('.').pop() ?? '') : '';
      if (SOURCE_EXTENSIONS.has(extension)) files.push(relative(ROOT, path));
    }
  }
  return files;
}

function hasHeader(path: string): boolean {
  const text = readFileSync(join(ROOT, path), 'utf8');
  if (path.endsWith('.html')) return text.replace(/^<!doctype html>\n/i, '').startsWith(MARKUP_HEADER);
  if (path.endsWith('.svg')) return text.startsWith(MARKUP_HEADER);
  return text.startsWith(BLOCK_HEADER);
}

describe('license headers', () => {
  it('every source file starts with the Apache License header', () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(300);
    expect(files.filter((path) => !hasHeader(path))).toEqual([]);
  });
});
