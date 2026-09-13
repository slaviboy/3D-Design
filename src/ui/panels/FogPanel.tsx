import { useEditor, useEditorState } from '../EditorContext';
import { CheckField } from './fields';
import { Panel } from './Panel';
import { ColorField, NumberField } from './styleFields';

/** Fog: on/off, the distances where it starts and hides everything, and its color. */
export function FogPanel() {
  const editor = useEditor();
  const fog = useEditorState((state) => state.fog);
  return (
    <Panel id="fog" title="Fog">
      <div className="styles">
        <CheckField
          label="Show fog"
          value={fog.enabled}
          onChange={(enabled) => {
            editor.updateFogSettings({ enabled });
          }}
        />
        <NumberField
          label="Start (m)"
          value={fog.start}
          onCommit={(start) => editor.updateFogSettings({ start })}
        />
        <NumberField label="End (m)" value={fog.end} onCommit={(end) => editor.updateFogSettings({ end })} />
        <CheckField
          label="Use background color"
          value={fog.useBackgroundColor}
          onChange={(useBackgroundColor) => {
            editor.updateFogSettings({ useBackgroundColor });
          }}
        />
        <ColorField
          label="Fog color"
          value={fog.color}
          onCommit={(color) => {
            editor.updateFogSettings({ color });
          }}
        />
      </div>
    </Panel>
  );
}
