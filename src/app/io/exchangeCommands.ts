import type { CommandRegistry } from '../commands/CommandRegistry';
import type { Editor } from '../Editor';

/** File > Import…, Export 3D Model… and Export 2D Graphic…. */
export function registerExchangeCommands(registry: CommandRegistry<Editor>): void {
  registry.register(
    {
      id: 'file.import',
      label: 'Import…',
      category: 'File',
      description: 'Add a glTF, OBJ, STL, COLLADA or 3DS model to this model as a group',
      aliases: ['import model', 'insert model', 'gltf', 'glb', 'obj', 'stl', 'collada', 'dae', '3ds'],
      isEnabled: (editor) => editor.exchange.canImport,
      run: (editor) => editor.exchange.importModel(),
    },
    {
      id: 'file.exportModel',
      label: 'Export 3D Model…',
      category: 'File',
      description: 'Save the model or the selection as glTF, OBJ, STL or COLLADA',
      aliases: ['export', 'gltf', 'glb', 'obj', 'stl', 'collada', 'dae', '3d print'],
      isEnabled: (editor) => editor.exchange.canExport,
      run: (editor) => {
        editor.exchange.requestModelExport();
      },
    },
    {
      id: 'file.exportImage',
      label: 'Export 2D Graphic…',
      category: 'File',
      description: 'Save the current view as a PNG image',
      aliases: ['png', 'image', 'screenshot', 'picture', 'render view'],
      isEnabled: (editor) => editor.exchange.canExport,
      run: (editor) => {
        editor.exchange.requestImageExport();
      },
    },
  );
}
