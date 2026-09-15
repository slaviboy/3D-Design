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
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dev-dist',
  'coverage',
  'playwright-report',
  'test-results',
  '.git',
  '.claude',
  '.idea',
]);
const BINARY_EXTENSIONS = new Set(['stl', 'png', 'jpg', 'jpeg', 'glb', 'wasm', 'hdr', 'exr', 'ico']);

/**
 * Patterns that must never be committed. Built from pieces, so this file doesn't match itself. They cover private
 * keys, common cloud and service tokens, and absolute home-directory paths from a developer's machine.
 */
const SECRET_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'private key', pattern: new RegExp(['-----BEGIN ', '[A-Z ]*PRIVATE KEY-----'].join('')) },
  { name: 'AWS access key', pattern: new RegExp(['AKIA', '[0-9A-Z]{16}'].join('')) },
  { name: 'GitHub token', pattern: new RegExp(['gh[pousr]_', '[A-Za-z0-9]{36}'].join('')) },
  { name: 'GitHub fine-grained token', pattern: new RegExp(['github_pat_', '[A-Za-z0-9_]{40,}'].join('')) },
  { name: 'Slack token', pattern: new RegExp(['xox[baprs]-', '[A-Za-z0-9-]{10,}'].join('')) },
  { name: 'Google API key', pattern: new RegExp(['AIza', '[0-9A-Za-z_-]{35}'].join('')) },
  { name: 'secret API key', pattern: new RegExp(['\\bsk-', '[A-Za-z0-9]{32,}'].join('')) },
  { name: 'home directory path', pattern: new RegExp(['/Users/', '[a-z][a-z0-9_-]+/'].join(''), 'i') },
  { name: 'home directory path', pattern: new RegExp(['/home/', '[a-z][a-z0-9_-]+/'].join('')) },
];
const FORBIDDEN_FILE_NAMES = [
  /^\.env(\..*)?$/,
  /\.pem$/,
  /^id_(rsa|ed25519|ecdsa)$/,
  /^\.npmrc$/,
  /^\.netrc$/,
];

function repositoryFiles(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(name)) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...repositoryFiles(path));
    else files.push(relative(ROOT, path));
  }
  return files;
}

describe('secrets', () => {
  const files = repositoryFiles(ROOT);

  it('no credential files are in the repository', () => {
    const names = files.map((path) => path.split('/').pop() ?? path);
    expect(names.filter((name) => FORBIDDEN_FILE_NAMES.some((pattern) => pattern.test(name)))).toEqual([]);
  });

  it('no keys, tokens or local paths appear in any text file', () => {
    const findings: string[] = [];
    for (const path of files) {
      const extension = path.includes('.') ? (path.split('.').pop() ?? '').toLowerCase() : '';
      if (BINARY_EXTENSIONS.has(extension)) continue;
      const text = readFileSync(join(ROOT, path), 'utf8');
      for (const { name, pattern } of SECRET_PATTERNS) {
        if (pattern.test(text)) findings.push(`${path}: ${name}`);
      }
    }
    expect(findings).toEqual([]);
  });
});
