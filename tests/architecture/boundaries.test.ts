import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

/**
 * Checks that the layer boundary rules in eslint.config.js actually reject forbidden imports.
 * Probe files don't need to exist, so type-aware linting is turned off for these checks.
 */
const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function boundaryViolations(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message);
}

describe('architectural layer boundaries', () => {
  it.each([
    ['src/kernel/probe.ts', "export * from 'three';"],
    ['src/kernel/probe.ts', "export * from 'react';"],
    ['src/kernel/probe.ts', "export * from 'zustand';"],
    ['src/kernel/probe.ts', "export * from '../render/probe';"],
    ['src/kernel/ops/probe.ts', "export * from '../../app/probe';"],
    ['src/kernel/probe.ts', "export * from '../ui/probe';"],
    ['src/render/probe.ts', "export * from '../app/probe';"],
    ['src/render/probe.ts', "export * from 'react';"],
    ['src/io/probe.ts', "export * from '../render/probe';"],
    ['src/workers/probe.ts', "export * from '../ui/probe';"],
    ['src/app/probe.ts', "export * from '../ui/probe';"],
    ['src/app/probe.ts', "export * from 'react-dom';"],
    ['src/ui/probe.tsx', "export * from 'three';"],
    ['src/io/mesh/probe.ts', "export * from 'three';"],
    ['src/io/export/probe.ts', "export * from 'three';"],
    ['src/io/export/probe.ts', "export * from '../../app/probe';"],
    ['src/io/import/formats.ts', "export * from 'three/examples/jsm/loaders/OBJLoader.js';"],
    ['src/app/io/probe.ts', "export * from 'three/examples/jsm/loaders/GLTFLoader.js';"],
    ['src/app/io/probe.ts', "export * from '../../io/import/parseImport';"],
  ])('%s rejects: %s', async (filePath, code) => {
    expect(await boundaryViolations(filePath, code)).not.toHaveLength(0);
  });

  it.each([
    ['src/ui/probe.tsx', "export * from '../app/probe';"],
    ['src/ui/probe.tsx', "export * from '../kernel/probe';"],
    ['src/app/probe.ts', "export * from '../render/probe';"],
    ['src/app/probe.ts', "export * from '../kernel/probe';"],
    ['src/render/probe.ts', "export * from 'three';"],
    ['src/io/probe.ts', "export * from '../kernel/probe';"],
    ['src/kernel/ops/probe.ts', "export * from '../tolerance';"],
    ['src/io/import/probe.ts', "export * from 'three/examples/jsm/loaders/STLLoader.js';"],
    ['src/workers/probe.ts', "export * from '../io/import/parseImport';"],
    ['src/app/io/probe.ts', "export * from '../../io/import/formats';"],
    ['src/app/io/probe.ts', "export * from '../../io/export/formats';"],
  ])('%s allows: %s', async (filePath, code) => {
    expect(await boundaryViolations(filePath, code)).toEqual([]);
  });
});
