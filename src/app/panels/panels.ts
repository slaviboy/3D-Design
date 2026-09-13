/** Panels in the dock, in display order. */
export type PanelId = 'entityInfo' | 'outliner' | 'components' | 'tags' | 'soften' | 'scenes' | 'shadows';

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
  { id: 'scenes', label: 'Scenes', aliases: ['views', 'pages', 'saved views', 'animation'] },
  { id: 'shadows', label: 'Shadows', aliases: ['sun', 'daylight', 'location', 'geolocation', 'time of day'] },
];

export const PANEL_IDS: readonly PanelId[] = PANELS.map((panel) => panel.id);

/** Panels shown when the app starts. */
export const DEFAULT_OPEN_PANELS: readonly PanelId[] = ['entityInfo', 'outliner', 'components', 'tags'];
