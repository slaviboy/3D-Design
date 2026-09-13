import { formatChord } from '../../app/shortcuts/shortcuts';
import { useEditor, useEditorState } from '../EditorContext';
import { Icon } from '../icons/Icon';

const MAIN_TOOLBAR: readonly (string | null)[] = [
  'file.new',
  'file.open',
  'file.save',
  null,
  'edit.undo',
  'edit.redo',
  'edit.delete',
  null,
  'edit.makeGroup',
  'edit.makeComponent',
  null,
  'camera.zoomExtents',
  'camera.view.iso',
  'camera.view.top',
  'camera.view.front',
  null,
  'help.commandPalette',
];

const TOOL_PALETTE: readonly string[] = [
  'tool.select',
  'tool.eraser',
  'tool.line',
  'tool.rectangle',
  'tool.circle',
  'tool.polygon',
  'tool.twoPointArc',
  'tool.freehand',
  'tool.pushPull',
  'tool.move',
  'tool.rotate',
  'tool.scale',
  'tool.offset',
  'tool.tapeMeasure',
  'tool.protractor',
  'tool.orbit',
  'tool.pan',
  'tool.zoom',
];

function CommandButton({
  commandId,
  pressable,
}: {
  readonly commandId: string;
  readonly pressable: boolean;
}) {
  const editor = useEditor();
  useEditorState(
    (state) => `${String(state.revision)}|${String(state.selectionVersion)}|${state.activeToolId}`,
  );
  const command = editor.commands.get(commandId);
  if (!command) return null;
  const chord = editor.shortcuts.chordsFor(commandId)[0];
  const title = chord ? `${command.label} (${formatChord(chord, editor.platform)})` : command.label;
  return (
    <button
      type="button"
      className="toolbar__button"
      aria-label={command.label}
      title={title}
      aria-pressed={pressable ? editor.commands.isChecked(commandId, editor) : undefined}
      disabled={!editor.commands.isEnabled(commandId, editor)}
      onClick={() => {
        void editor.runCommand(commandId);
      }}
    >
      <Icon commandId={commandId} />
    </button>
  );
}

export function Toolbar() {
  return (
    <div className="toolbar" role="toolbar" aria-label="Main toolbar">
      {MAIN_TOOLBAR.map((commandId, index) =>
        commandId === null ? (
          <span className="toolbar__separator" role="separator" key={`separator-${String(index)}`} />
        ) : (
          <CommandButton commandId={commandId} pressable={false} key={commandId} />
        ),
      )}
    </div>
  );
}

export function ToolPalette() {
  return (
    <div className="tool-palette" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {TOOL_PALETTE.map((commandId) => (
        <CommandButton commandId={commandId} pressable key={commandId} />
      ))}
    </div>
  );
}
