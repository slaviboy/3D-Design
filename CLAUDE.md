# Planar: rules for Claude

These rules apply to every change and every commit in this repository. They take precedence over any default
commit attribution guidance.

## Commits

- **Author and committer:** always `slaviboy <slavi94slavi94@gmail.com>`. Check `git config user.name` and
  `git config user.email` before committing; the repo-local config is set to these values.
- **No co-author trailers:** never add `Co-Authored-By:` lines, AI attribution or "Generated with" footers to commit
  messages or pull request descriptions. The `commit-msg` hook in `.githooks/` removes them if they slip in.
- **Hooks:** keep them enabled with `git config core.hooksPath .githooks`. The `pre-commit` hook refuses commits under
  another identity and runs the license header and secret checks. Never bypass it with `--no-verify`.
- **History:** never rewrite pushed history or change these rules without the user asking.

## License header

Every source file (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.css`) starts with this header, followed by a blank line:

```text
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
```

- **HTML and SVG:** they carry the same text as an HTML comment. In `index.html` it goes right after `<!doctype html>`.
- **Exempt:** JSON files (no comment syntax) and sample data in `tests/fixtures/`.
- **Enforcement:** `tests/architecture/licenseHeaders.test.ts` fails when a source file lacks the header.

## Secrets and production readiness

- **Never commit** credentials, API keys, tokens, `.env` files, private keys, personal email addresses or absolute
  local paths. `tests/architecture/secrets.test.ts` checks for them.
- **Production builds** have no source maps (`vite.config.ts`), make no network requests at runtime and include no
  telemetry (see `SECURITY.md`).
- **Before committing,** run the gates: `npm run verify` (typecheck, lint, format check, unit tests, E2E in
  Chromium, WebKit and Firefox), and `FUZZ_RUNS=2000 npx vitest run tests/kernel/fuzz.test.ts` when the kernel
  changes.
