import type { Platform } from '../shortcuts/shortcuts';
import { ARC_TOOL_ID, PIE_TOOL_ID, THREE_POINT_ARC_TOOL_ID, TWO_POINT_ARC_TOOL_ID } from '../tools/ArcTool';
import { AXES_TOOL_ID } from '../tools/AxesTool';
import { PLACE_COMPONENT_TOOL_ID } from '../tools/ComponentPlacementTool';
import { DIMENSION_TOOL_ID } from '../tools/DimensionTool';
import { FOLLOW_ME_TOOL_ID } from '../tools/FollowMeTool';
import { FREEHAND_TOOL_ID } from '../tools/FreehandTool';
import { OFFSET_TOOL_ID } from '../tools/OffsetTool';
import { PAINT_TOOL_ID } from '../tools/PaintBucketTool';
import { PROTRACTOR_TOOL_ID } from '../tools/ProtractorTool';
import { ROTATED_RECTANGLE_TOOL_ID } from '../tools/RotatedRectangleTool';
import { ROTATE_TOOL_ID } from '../tools/RotateTool';
import { SCALE_TOOL_ID } from '../tools/ScaleTool';
import { SECTION_PLANE_TOOL_ID } from '../tools/SectionPlaneTool';
import { TEXT_TOOL_ID } from '../tools/TextTool';
import { TEXT_3D_TOOL_ID } from '../tools/Text3DTool';
import {
  CIRCLE_TOOL_ID,
  ERASER_TOOL_ID,
  LINE_TOOL_ID,
  MOVE_TOOL_ID,
  ORBIT_TOOL_ID,
  PAN_TOOL_ID,
  POLYGON_TOOL_ID,
  PUSH_PULL_TOOL_ID,
  RECTANGLE_TOOL_ID,
  SELECT_TOOL_ID,
  TAPE_MEASURE_TOOL_ID,
  ZOOM_TOOL_ID,
} from '../tools/Tool';

/** Names of the modifier keys as printed on this platform's keyboard. */
export interface ModifierKeyNames {
  /** Adds to a selection and switches copy, keep and similar modes: Option on macOS, Ctrl elsewhere. */
  readonly toggle: string;
  /** Samples a material with the Paint Bucket: Command on macOS, Alt elsewhere. */
  readonly sample: string;
}

export function modifierKeyNames(platform: Platform): ModifierKeyNames {
  return platform === 'mac' ? { toggle: 'Option', sample: 'Command' } : { toggle: 'Ctrl', sample: 'Alt' };
}

export interface InstructorKey {
  /** Keys or mouse buttons, for example "Shift" or "Arrow keys". */
  readonly keys: string;
  readonly effect: string;
}

/** Help for one tool, shown in the Instructor panel. */
export interface InstructorHint {
  readonly title: string;
  /** One sentence on what the tool is for. */
  readonly purpose: string;
  readonly steps: readonly string[];
  readonly keys: readonly InstructorKey[];
  /** What can be typed into the measurements box while the tool is active, or null when the tool has none. */
  readonly measurements: string | null;
}

type HintSource = (names: ModifierKeyNames) => InstructorHint;

const ESC_CANCELS: InstructorKey = { keys: 'Esc', effect: 'Cancels the current step.' };
const ARROW_LOCKS: InstructorKey = {
  keys: 'Arrow keys',
  effect: 'Up locks to the blue axis, Right to red, Left to green. Press again to unlock.',
};
const MIDDLE_ORBITS: InstructorKey = {
  keys: 'Middle button drag',
  effect: 'Orbits in any tool; with Shift it pans.',
};
const SEGMENTS = 'type a number followed by s, such as 12s, to change how many segments it has';

/** Help for every registered tool, keyed by tool id. Original text written for Planar. */
export const INSTRUCTOR_HINTS: Readonly<Record<string, HintSource>> = {
  [SELECT_TOOL_ID]: ({ toggle }) => ({
    title: 'Select',
    purpose: 'Choose the edges, faces, groups and components other commands work on.',
    steps: [
      'Click an entity to select it; click empty space to clear the selection.',
      'Double-click a face to include its edges, or an edge to include its faces. Triple-click selects everything connected.',
      'Drag to the right to select what lies fully inside the box, or to the left to also catch what it touches.',
      'Double-click a group or component to edit its contents. Click outside it to close it again.',
      'Right-click, or press Shift+F10, for commands that apply to the selection.',
    ],
    keys: [
      { keys: toggle, effect: 'Adds to the selection.' },
      { keys: 'Shift', effect: 'Toggles entities in and out of the selection.' },
      { keys: `Shift+${toggle}`, effect: 'Removes from the selection.' },
      { keys: 'Esc', effect: 'Clears the selection, then closes the open group.' },
    ],
    measurements: null,
  }),
  [ORBIT_TOOL_ID]: () => ({
    title: 'Orbit',
    purpose: 'Turn the view around the model to see it from another side.',
    steps: ['Drag in the view to orbit.', 'Switch back to your previous tool when the view looks right.'],
    keys: [{ keys: 'Shift', effect: 'Pans while dragging.' }, MIDDLE_ORBITS],
    measurements: null,
  }),
  [PAN_TOOL_ID]: () => ({
    title: 'Pan',
    purpose: 'Slide the view sideways or up and down without turning it.',
    steps: ['Drag in the view to pan.'],
    keys: [MIDDLE_ORBITS],
    measurements: null,
  }),
  [ZOOM_TOOL_ID]: () => ({
    title: 'Zoom',
    purpose: 'Move the view closer to the model or further away.',
    steps: [
      'Drag up to zoom in and down to zoom out.',
      'In any tool, scroll the mouse wheel to zoom toward the pointer.',
    ],
    keys: [{ keys: 'Shift+Z', effect: 'Fits the whole model in the view.' }],
    measurements: null,
  }),
  [LINE_TOOL_ID]: () => ({
    title: 'Line',
    purpose: 'Draw edges. A closed, flat loop of edges becomes a face.',
    steps: [
      'Click where the line starts.',
      'Click where it ends, or type its length and press Enter. The next line starts from there.',
      'Press Esc to stop drawing.',
    ],
    keys: [
      ARROW_LOCKS,
      { keys: 'Shift', effect: 'Holds the direction the line is following.' },
      { keys: 'Esc', effect: 'Ends the line.' },
    ],
    measurements:
      'A length such as 2.5m, a point in model coordinates as [x,y,z], or an offset from the start as <x,y,z>.',
  }),
  [RECTANGLE_TOOL_ID]: () => ({
    title: 'Rectangle',
    purpose: 'Draw a rectangular face on the ground, on a face, or facing the view.',
    steps: ['Click the first corner.', 'Click the opposite corner, or type the width and height.'],
    keys: [ESC_CANCELS],
    measurements:
      'Width and height such as 2m,1m. Type new values right after drawing to resize the rectangle.',
  }),
  [ROTATED_RECTANGLE_TOOL_ID]: () => ({
    title: 'Rotated Rectangle',
    purpose: 'Draw a rectangle at any angle, one side first.',
    steps: [
      'Click the start of the first side.',
      'Click its end, or type its length or angle.',
      'Click to set the width, or type it.',
    ],
    keys: [ESC_CANCELS],
    measurements: 'The first side’s length or angle, then the width; or both sides at once, such as 2m,1m.',
  }),
  [CIRCLE_TOOL_ID]: () => ({
    title: 'Circle',
    purpose: 'Draw a circular face made of straight segments.',
    steps: ['Click the center.', 'Click to set the radius, or type it.'],
    keys: [ESC_CANCELS],
    measurements: `The radius, or ${SEGMENTS}.`,
  }),
  [POLYGON_TOOL_ID]: () => ({
    title: 'Polygon',
    purpose: 'Draw a regular polygon with equal sides.',
    steps: ['Click the center.', 'Click to set the radius, or type it.'],
    keys: [ESC_CANCELS],
    measurements: 'The radius, or a number followed by s, such as 6s, to change how many sides it has.',
  }),
  [ARC_TOOL_ID]: () => ({
    title: 'Arc',
    purpose: 'Draw an arc around a center point.',
    steps: [
      'Click the center.',
      'Click the start point, or type the radius.',
      'Click the end point, or type the angle it sweeps.',
    ],
    keys: [ESC_CANCELS],
    measurements: `The radius, then the angle; at any time, ${SEGMENTS}.`,
  }),
  [TWO_POINT_ARC_TOOL_ID]: () => ({
    title: '2-Point Arc',
    purpose: 'Draw an arc between two points, then pull out how far it bulges.',
    steps: [
      'Click the start point.',
      'Click the end point, or type the distance between them.',
      'Click to set the bulge, or type it.',
    ],
    keys: [ESC_CANCELS],
    measurements: `The chord length, then the bulge or a radius followed by r, such as 2mr; at any time, ${SEGMENTS}.`,
  }),
  [THREE_POINT_ARC_TOOL_ID]: () => ({
    title: '3-Point Arc',
    purpose: 'Draw an arc that passes through three points.',
    steps: ['Click the first point.', 'Click a second point on the arc.', 'Click the end point.'],
    keys: [ESC_CANCELS],
    measurements: `A number followed by s, such as 12s, sets the segments.`,
  }),
  [PIE_TOOL_ID]: () => ({
    title: 'Pie',
    purpose: 'Draw a wedge-shaped face: an arc closed back to its center.',
    steps: [
      'Click the center.',
      'Click the start of the arc, or type the radius.',
      'Click the end, or type the angle.',
    ],
    keys: [ESC_CANCELS],
    measurements: `The radius, then the angle; at any time, ${SEGMENTS}.`,
  }),
  [FREEHAND_TOOL_ID]: () => ({
    title: 'Freehand',
    purpose: 'Sketch an irregular line by dragging.',
    steps: ['Press and drag to draw.', 'Release to finish. End where you started to make a closed shape.'],
    keys: [ESC_CANCELS],
    measurements: null,
  }),
  [ERASER_TOOL_ID]: ({ toggle }) => ({
    title: 'Eraser',
    purpose: 'Remove edges, or hide and soften them instead.',
    steps: [
      'Click an edge to erase it, or drag across several.',
      'Faces that lose a boundary edge are removed too; flat neighbors merge.',
    ],
    keys: [
      { keys: 'Shift', effect: 'Hides edges instead of erasing them.' },
      { keys: toggle, effect: 'Softens edges.' },
      { keys: `${toggle}+Shift`, effect: 'Unsoftens edges.' },
    ],
    measurements: null,
  }),
  [TAPE_MEASURE_TOOL_ID]: ({ toggle }) => ({
    title: 'Tape Measure',
    purpose: 'Measure distances and place guide lines and guide points.',
    steps: [
      'Click a start point, or an edge to make a parallel guide.',
      'Move to measure, then click to finish, or type a distance to place the guide there.',
    ],
    keys: [{ keys: toggle, effect: 'Measures without creating a guide.' }, ESC_CANCELS],
    measurements: 'A distance from the start point.',
  }),
  [PROTRACTOR_TOOL_ID]: ({ toggle }) => ({
    title: 'Protractor',
    purpose: 'Measure angles and place angled guide lines.',
    steps: [
      'Click the vertex of the angle.',
      'Click a point on the zero line.',
      'Click to place the guide, or type the angle.',
    ],
    keys: [ARROW_LOCKS, { keys: toggle, effect: 'Only measures; no guide is placed.' }, ESC_CANCELS],
    measurements: 'An angle in degrees.',
  }),
  [AXES_TOOL_ID]: () => ({
    title: 'Axes',
    purpose: 'Move and turn the drawing axes that tools align to.',
    steps: [
      'Click the new origin.',
      'Click a point along the new red axis.',
      'Click a point toward the green axis. Tools > Reset Axes restores the default.',
    ],
    keys: [ESC_CANCELS],
    measurements: null,
  }),
  [PUSH_PULL_TOOL_ID]: ({ toggle }) => ({
    title: 'Push/Pull',
    purpose: 'Extrude a flat face into a solid shape, or push it in to cut a recess.',
    steps: [
      'Click a face.',
      'Move to set the distance, then click, or type the distance.',
      'Type another value right away to change the last push or pull.',
    ],
    keys: [{ keys: toggle, effect: 'Keeps the starting face and adds a new one.' }, ESC_CANCELS],
    measurements: 'A distance; a negative value pushes the other way.',
  }),
  [MOVE_TOOL_ID]: ({ toggle }) => ({
    title: 'Move',
    purpose: 'Move or copy the selection, or whatever is under the pointer.',
    steps: [
      'Select what to move, or point at a single entity.',
      'Click a start point.',
      'Click the destination, or type a distance.',
      'After a copy, type 3x for three more copies in a row, or 3/ for three spaced between.',
    ],
    keys: [{ keys: toggle, effect: 'Copies instead of moving.' }, ARROW_LOCKS, ESC_CANCELS],
    measurements:
      'A distance, a point as [x,y,z], an offset as <x,y,z>, or after a copy a count such as 3x or 3/.',
  }),
  [ROTATE_TOOL_ID]: ({ toggle }) => ({
    title: 'Rotate',
    purpose: 'Turn or copy the selection around a center point.',
    steps: [
      'Select what to rotate.',
      'Click the center of rotation.',
      'Click a point on the zero line.',
      'Click to finish, or type the angle. After a copy, type 6x or 6/ for a radial array.',
    ],
    keys: [{ keys: toggle, effect: 'Rotates a copy.' }, ARROW_LOCKS, ESC_CANCELS],
    measurements: 'An angle in degrees, or after a copy a count such as 6x or 6/.',
  }),
  [SCALE_TOOL_ID]: ({ toggle }) => ({
    title: 'Scale',
    purpose: 'Resize or stretch the selection.',
    steps: [
      'Select what to scale.',
      'Click a grip: corners scale evenly, edges and faces stretch.',
      'Move and click, or type a factor or a length.',
    ],
    keys: [
      { keys: 'Shift', effect: 'Switches between even scaling and stretching.' },
      { keys: toggle, effect: 'Scales about the center instead of the opposite grip.' },
      ESC_CANCELS,
    ],
    measurements: 'A factor such as 2 or 50%, one factor per direction such as 2,1,1, or a target length.',
  }),
  [OFFSET_TOOL_ID]: ({ toggle }) => ({
    title: 'Offset',
    purpose: 'Draw a copy of a face’s outline, or of connected edges, at an even distance.',
    steps: [
      'Click a face, or select connected edges first.',
      'Move to set the distance and click, or type it.',
    ],
    keys: [{ keys: toggle, effect: 'Keeps parts of the copy that would overlap.' }, ESC_CANCELS],
    measurements: 'A distance.',
  }),
  [FOLLOW_ME_TOOL_ID]: () => ({
    title: 'Follow Me',
    purpose: 'Sweep a profile face along a path of edges, like a molding or a lathe.',
    steps: [
      'Select the path edges first and click the profile face,',
      'or press on the profile face and drag along the path, then release.',
    ],
    keys: [ESC_CANCELS],
    measurements: null,
  }),
  [DIMENSION_TOOL_ID]: () => ({
    title: 'Dimension',
    purpose: 'Label a length, radius or diameter in the model.',
    steps: [
      'Click the first point or an edge, or click an arc or circle.',
      'Click the second point.',
      'Move to pull the label away from the geometry, then click to place it.',
    ],
    keys: [ESC_CANCELS],
    measurements: null,
  }),
  [TEXT_TOOL_ID]: () => ({
    title: 'Text',
    purpose: 'Add notes: leader text that points at an entity, or text fixed to the screen.',
    steps: [
      'Click an entity for leader text, or empty space for screen text.',
      'Click to place the label, then enter its text.',
    ],
    keys: [ESC_CANCELS],
    measurements: null,
  }),
  [TEXT_3D_TOOL_ID]: () => ({
    title: '3D Text',
    purpose: 'Put lettering into the model as real geometry, flat or extruded, for signs and labels.',
    steps: [
      'Choose 3D Text… in the Tools menu, type the text and pick its height, alignment and style.',
      'Select Place; an outline of the text follows the cursor.',
      'Click a face to set the text on it, or empty space to lay it on the ground.',
    ],
    keys: [{ keys: 'Esc', effect: 'Cancels placing the text.' }],
    measurements: null,
  }),
  [PAINT_TOOL_ID]: ({ toggle, sample }) => ({
    title: 'Paint Bucket',
    purpose: 'Apply the active material to faces, groups and components.',
    steps: ['Choose a material in the Materials panel.', 'Click a face, group or component to paint it.'],
    keys: [
      { keys: 'Shift', effect: 'Paints every matching face here.' },
      { keys: toggle, effect: 'Paints matching faces connected to the one you click.' },
      { keys: `${toggle}+Shift`, effect: 'Paints matching faces on the same object.' },
      { keys: sample, effect: 'Samples a material to make it active.' },
    ],
    measurements: null,
  }),
  [SECTION_PLANE_TOOL_ID]: () => ({
    title: 'Section Plane',
    purpose: 'Cut away part of the model to see inside it.',
    steps: [
      'Point at a face to align the plane with it, or at empty space to face the view.',
      'Click to place the plane.',
      'Select the plane to reverse it, turn its cut off, or make a group from the slice.',
    ],
    keys: [
      {
        keys: 'Arrow keys',
        effect: 'Lock the plane’s orientation: Up to blue, Right to red, Left to green.',
      },
      ESC_CANCELS,
    ],
    measurements: null,
  }),
  [PLACE_COMPONENT_TOOL_ID]: () => ({
    title: 'Place Component',
    purpose: 'Add another instance of a component to the model.',
    steps: [
      'Choose a component in the Components panel.',
      'Move to where it should go and click to place it.',
    ],
    keys: [{ keys: 'Esc', effect: 'Stops placing.' }],
    measurements: null,
  }),
};

/** The Instructor's help for a tool with this platform's key names, or null for a tool without an entry. */
export function instructorHint(toolId: string, platform: Platform): InstructorHint | null {
  return INSTRUCTOR_HINTS[toolId]?.(modifierKeyNames(platform)) ?? null;
}
