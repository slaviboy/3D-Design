/** Default viewport colors. Styles make these configurable in the visualization phase. */
export const VIEW_COLORS = Object.freeze({
  background: 0xdfe5eb,
  faceFront: 0xf2f0ea,
  faceBack: 0x9eafc3,
  edge: 0x1d232b,
  selection: 0x1f66d6,
  axisX: 0xd4443b,
  axisY: 0x3b9a4b,
  axisZ: 0x2f5fd0,
});

/** Opacity of the tint drawn over selected faces. */
export const SELECTION_FACE_OPACITY = 0.35;
export const AMBIENT_LIGHT_INTENSITY = 1.4;
export const SUN_LIGHT_INTENSITY = 1.6;
/** Fixed light direction (from the scene toward the light), in world coordinates. */
export const SUN_DIRECTION = Object.freeze({ x: 0.45, y: -0.6, z: 0.9 });
