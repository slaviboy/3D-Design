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
