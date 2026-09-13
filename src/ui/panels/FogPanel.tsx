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
