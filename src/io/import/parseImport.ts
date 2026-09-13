import { validateImportedScene, type ImportedScene } from '../mesh/importedScene';
import { ImportError, type ImportLimits } from '../mesh/limits';
import { parseDae } from './dae';
import { expandFileSet, FileResolver, findMainFile, type InputFile } from './fileSet';
import { parseGltf } from './gltf';
import { parse3ds, parseObj, parseStl } from './objStl3ds';

/**
 * Parses one import: expands zips, finds the model file, runs the importer for its format and validates the result.
 * Runs in the io worker (and directly in tests). Throws an {@link ImportError} with a message for the user.
 */
export async function parseImportFiles(
  files: readonly InputFile[],
  limits: ImportLimits,
): Promise<ImportedScene> {
  try {
    const expanded = expandFileSet(files, limits);
    const main = findMainFile(expanded, limits);
    const file = expanded.find((candidate) => candidate.name === main.name);
    if (!file) throw new ImportError('the model file could not be found');
    const warnings: string[] = [];
    const resolver = new FileResolver(expanded, main.name, warnings);
    let scene: ImportedScene;
    switch (main.format.id) {
      case 'gltf':
        scene = await parseGltf(file, resolver, limits, warnings);
        break;
      case 'obj':
        scene = parseObj(file, resolver, limits, warnings);
        break;
      case 'stl':
        scene = parseStl(file, limits, warnings);
        break;
      case 'dae':
        scene = parseDae(file, limits, warnings);
        break;
      case '3ds':
        scene = parse3ds(file, limits, warnings);
        break;
    }
    validateImportedScene(scene, limits);
    if (scene.meshes.length === 0) throw new ImportError('the file has no triangle meshes');
    return scene;
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError(
      `the file could not be read (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}
