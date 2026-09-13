import type { Rgb } from '../../kernel/model/types';

/** One sRGB-encoded channel in [0, 1] to linear. */
export function srgbToLinear(value: number): number {
  const v = clamp01(value);
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** One linear channel in [0, 1] to sRGB encoding. */
export function linearToSrgb(value: number): number {
  const v = clamp01(value);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function rgbFromSrgb(r: number, g: number, b: number): Rgb {
  return { r: srgbToLinear(r), g: srgbToLinear(g), b: srgbToLinear(b) };
}

export function srgbFromRgb(color: Rgb): [number, number, number] {
  return [linearToSrgb(color.r), linearToSrgb(color.g), linearToSrgb(color.b)];
}
