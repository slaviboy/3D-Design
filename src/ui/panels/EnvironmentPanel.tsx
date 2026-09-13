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

import { BUILTIN_ENVIRONMENTS, CUSTOM_ENVIRONMENT_ID } from '../../app/styles/stylePresets';
import { useEditor, useEditorState } from '../EditorContext';
import { CheckField } from './fields';
import { Panel } from './Panel';
import { NumberField, SelectField } from './styleFields';

/** Image-based lighting: built-in environments or an HDR file loaded for this session. */
export function EnvironmentPanel() {
  const editor = useEditor();
  const environment = useEditorState((state) => state.environment);
  const imageName = useEditorState((state) => state.environmentImageName);
  const options = [
    ...BUILTIN_ENVIRONMENTS.map((entry) => ({ value: entry.id, label: entry.label })),
    {
      value: CUSTOM_ENVIRONMENT_ID,
      label: imageName === null ? 'Custom image (not loaded)' : `${imageName} (this session)`,
    },
  ];
  // An id this version doesn't know is shown as the studio, which the renderer falls back to.
  const value = options.some((option) => option.value === environment.environmentId)
    ? environment.environmentId
    : 'studio';

  return (
    <Panel id="environment" title="Environment">
      <div className="styles">
        <CheckField
          label="Show environment"
          value={environment.enabled}
          onChange={(enabled) => {
            editor.updateEnvironmentSettings({ enabled });
          }}
        />
        <SelectField
          label="Environment"
          value={value}
          options={options}
          onChange={(environmentId) => {
            editor.updateEnvironmentSettings({ environmentId });
          }}
        />
        <button
          type="button"
          className="button button--small styles__save"
          onClick={() => {
            void editor.loadEnvironmentImage();
          }}
        >
          Load HDR Image…
        </button>
        <p className="styles__note">
          A loaded image is used in this session only. The model saves the settings, not the image.
        </p>
        <NumberField
          label="Rotation (°)"
          value={environment.rotationDegrees}
          onCommit={(rotationDegrees) => editor.updateEnvironmentSettings({ rotationDegrees })}
        />
        <NumberField
          label="Exposure"
          value={environment.exposure}
          onCommit={(exposure) => editor.updateEnvironmentSettings({ exposure })}
        />
        <CheckField
          label="Show as background"
          value={environment.showAsBackground}
          onChange={(showAsBackground) => {
            editor.updateEnvironmentSettings({ showAsBackground });
          }}
        />
        <CheckField
          label="Use for reflections"
          value={environment.useForReflections}
          onChange={(useForReflections) => {
            editor.updateEnvironmentSettings({ useForReflections });
          }}
        />
      </div>
    </Panel>
  );
}
