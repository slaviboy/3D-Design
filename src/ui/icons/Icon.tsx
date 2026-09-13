/** Original line icons for Planar, drawn on a 20×20 grid with a 1.5px stroke. */
const PATHS: Readonly<Record<string, string>> = {
  'tool.select': 'M5 3l10 6.5-4.4 1 2.6 5-1.8.9-2.6-5L5 15z',
  'tool.orbit': 'M10 3a7 7 0 1 1-6.6 4.7M3.4 3.6v4.1h4.1M10 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  'tool.pan':
    'M10 2v16M2 10h16M10 2l-2.5 2.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5',
  'tool.zoom': 'M8.5 3a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM12.5 12.5L17 17M6 8.5h5M8.5 6v5',
  'camera.zoomExtents': 'M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M7 7h6v6H7z',
  'edit.undo': 'M7 5L3 9l4 4M3 9h9a5 5 0 0 1 0 10h-2',
  'edit.redo': 'M13 5l4 4-4 4M17 9H8a5 5 0 0 0 0 10h2',
  'edit.delete': 'M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11',
  'file.new': 'M5 2h7l4 4v12H5zM12 2v4h4',
  'file.open': 'M2 6h6l2 2h8v9H2zM2 6V4h5l2 2',
  'file.save': 'M4 3h10l3 3v11H4zM7 3v5h6V3M7 17v-5h7v5',
  'camera.view.top': 'M10 3l7 4-7 4-7-4zM3 7v6l7 4 7-4V7',
  'camera.view.front': 'M4 6h9v11H4zM13 6l3-3v11l-3 3M4 6l3-3h9',
  'camera.view.iso': 'M10 2l7 4v8l-7 4-7-4V6zM10 10l7-4M10 10v8M10 10L3 6',
  'help.commandPalette': 'M8.5 3a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM12.5 12.5L17 17',
  'tool.line': 'M5 15L15 5M3 13h4v4H3zM13 3h4v4h-4z',
  'tool.rectangle': 'M3 5h14v10H3z',
  'tool.circle': 'M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM10 10h7',
  'tool.polygon': 'M10 2.5l6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5z',
  'tool.eraser': 'M11 3l6 6-8 8H5l-2-2zM7 7l6 6M10 17h7',
  'tool.tapeMeasure': 'M2 6h16v8H2zM5 6v3M8 6v4M11 6v3M14 6v4',
  'tool.pushPull': 'M3 13l7 4 7-4-7-4zM10 11V2M7 5l3-3 3 3',
  'tool.move': 'M10 3v14M3 10h14M8 5l2-2 2 2M8 15l2 2 2-2M5 8l-2 2 2 2M15 8l2 2-2 2',
  'edit.makeGroup': 'M3 3h14v14H3zM6 6h4v4H6zM11 10h3v4h-3z',
  'edit.makeComponent': 'M3 4h6v6H3zM11 10h6v6h-6zM9 7h5v3',
  'edit.explode': 'M8 8h4v4H8zM3 3l3 3M17 3l-3 3M3 17l3-3M17 17l-3-3',
  'tool.rotate': 'M16 10a6 6 0 1 1-2-4.5M15 2v4h-4',
  'tool.scale': 'M3 17V9h8v8zM11 9l6-6M12 3h5v5',
  'tool.arc': 'M10 16H3M10 16l5-8M3 16a7 7 0 0 1 12-8',
  'tool.twoPointArc': 'M3 15a7.5 7.5 0 0 1 14 0M2 14h2v2H2zM16 14h2v2h-2z',
  'tool.threePointArc': 'M3 15a7.5 7.5 0 0 1 14 0M2 14h2v2H2zM9 6.5h2v2H9zM16 14h2v2h-2z',
  'tool.pie': 'M10 10V3a7 7 0 1 1-7 7z',
  'tool.freehand': 'M3 14c2-6 4 2 6-3s3-5 5-1 2 4 3 2',
  'tool.rotatedRectangle': 'M10 2l8 8-8 8-8-8z',
  'tool.protractor': 'M3 15a7 7 0 0 1 14 0zM10 15l4-6',
  'tool.dimension': 'M3 6v8M17 6v8M3 10h14M5 8l-2 2 2 2M15 8l2 2-2 2',
  'tool.text': 'M4 4h12M10 4v12M7 16h6',
  'tool.offset': 'M3 3h14v14H3zM7 7h6v6H7z',
  'tool.axes': 'M5 15V3M5 15h12M5 15l-3 3M3 5l2-2 2 2M15 13l2 2-2 2',
};

export function hasIcon(commandId: string): boolean {
  return commandId in PATHS;
}

export function Icon({ commandId, size = 20 }: { readonly commandId: string; readonly size?: number }) {
  const path = PATHS[commandId];
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
