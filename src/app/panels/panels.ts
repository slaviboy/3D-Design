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

/** Panels in the dock, in display order. */
export type PanelId =
  | 'entityInfo'
  | 'outliner'
  | 'components'
  | 'tags'
  | 'soften'
  | 'materials'
  | 'scenes'
  | 'shadows'
  | 'instructor'
  | 'styles'
  | 'fog'
  | 'environment';

export interface PanelDescriptor {
  readonly id: PanelId;
  readonly label: string;
  /** Extra command palette search terms for the command that shows or hides the panel. */
  readonly aliases: readonly string[];
}

export const PANELS: readonly PanelDescriptor[] = [
  { id: 'entityInfo', label: 'Entity Info', aliases: ['properties', 'inspector', 'attributes'] },
  { id: 'outliner', label: 'Outliner', aliases: ['hierarchy', 'tree', 'scene graph'] },
  { id: 'components', label: 'Components', aliases: ['definitions', 'blocks', 'library'] },
  { id: 'tags', label: 'Tags', aliases: ['layers', 'visibility'] },
  { id: 'soften', label: 'Soften Edges', aliases: ['smooth', 'soften', 'hide edges by angle'] },
  { id: 'materials', label: 'Materials', aliases: ['colors', 'textures', 'paint', 'swatches'] },
  { id: 'scenes', label: 'Scenes', aliases: ['views', 'pages', 'saved views', 'animation'] },
  { id: 'shadows', label: 'Shadows', aliases: ['sun', 'daylight', 'location', 'geolocation', 'time of day'] },
  {
    id: 'styles',
    label: 'Styles',
    aliases: ['display', 'face style', 'edge style', 'background', 'sky', 'ground'],
  },
  { id: 'fog', label: 'Fog', aliases: ['haze', 'atmosphere', 'depth fade'] },
  {
    id: 'environment',
    label: 'Environment',
    aliases: ['hdr', 'image based lighting', 'reflections', 'skydome'],
  },
  { id: 'instructor', label: 'Instructor', aliases: ['help', 'hints', 'tool help', 'how to use a tool'] },
];

export const PANEL_IDS: readonly PanelId[] = PANELS.map((panel) => panel.id);

/** Panels shown when the app starts. */
export const DEFAULT_OPEN_PANELS: readonly PanelId[] = [
  'entityInfo',
  'outliner',
  'components',
  'tags',
  'materials',
];
