# Developing Planar

## Requirements

- **Node.js 22.12+, 24 (LTS, recommended), or 26+.** This matches Vitest 5's supported engines. Node 25 works but
  npm warns with `EBADENGINE`.
- **npm 10 or newer.**
- **Playwright browsers,** for the end-to-end tests. Install them once with `npx playwright install chromium`.

Development needs network access only to install packages. The built application never uses the network.

## Setup

```sh
cd app
npm install
npm run dev          # http://localhost:5173
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server with hot reload (no CSP) |
| `npm run typecheck` | Checks the whole project, plus the kernel alone with no DOM or Node types |
| `npm run lint` | ESLint (strict, type-checked, layer boundaries); fails on any warning |
| `npm run format` / `format:check` | Prettier |
| `npm test` / `test:watch` / `coverage` | Vitest |
| `npm run build` | Typecheck, then a production build into `dist/` |
| `npm run preview` | Serves `dist/` on port 4173 |
| `npm run e2e` | Production build in `e2e` mode (adds the `window.__planar` test hook) plus Playwright |
| `npm run bench` | Kernel benchmarks (`*.bench.ts`), results in `bench/results/` |
| `npm run verify` | The full gate, required before every commit that closes a phase |

## Project conventions

- **Layers.** Read [ARCHITECTURE.md](ARCHITECTURE.md) before adding a module. ESLint rejects imports that cross a
  layer boundary the wrong way.
- **Strict TypeScript.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `erasableSyntaxOnly` are all
  on. No enums (use union types), no `any`, and no non-null assertions unless the reason is commented.
- **No magic numbers.** Tolerances go in `src/kernel/tolerance.ts`. UI sizes go in CSS custom properties. Other
  constants go in named `const`s next to the module that owns them.
- **No placeholder code.** No empty folders, stub buttons, or unimplemented commands. Menus and toolbars list only
  registered, working commands.
- **Logging.** Use the logger that arrives with the foundation phase. `console.*` is a lint error.
- **Dependencies.** Every new dependency is recorded in ARCHITECTURE.md with its license, size and justification.
  Runtime dependencies must work offline and be bundled.
- **Commits.** The project follows a phase roadmap, and each phase ends with a commit after `npm run verify` passes.

## Version pins

- **TypeScript is pinned to `~6.0`** because typescript-eslint 8.x supports TypeScript below 6.1 only. Revisit when
  typescript-eslint supports TypeScript 7.
