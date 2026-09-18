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

import * as THREE from 'three';
import { axisReach } from './axes';
import { ModelRenderer } from './ModelRenderer';
import { VIEW_COLORS } from './palette';
import { SectionOverlay } from './sections/SectionOverlay';
import { ShadowController } from './shadows/ShadowController';
import type { ViewSource } from './ViewSource';
import { BackgroundController } from './styles/BackgroundController';

/** Largest device pixel ratio rendered; higher ratios cost fill rate for little visible gain. */
const MAX_PIXEL_RATIO = 2;
/** Near plane as a fraction of the far plane; bounds depth-buffer precision. */
const NEAR_TO_FAR_RATIO = 1 / 20_000;
const MIN_NEAR = 1e-3;
const MIN_FAR = 100;
const AXIS_DASH = 0.004;

export interface ViewportCallbacks {
  /** Called with the drawing area size in CSS pixels whenever it changes. */
  readonly onResize?: (size: { width: number; height: number }) => void;
}

function buildAxes(): THREE.Group {
  const axes = new THREE.Group();
  axes.matrixAutoUpdate = false;
  const directions: [THREE.Vector3, number][] = [
    [new THREE.Vector3(1, 0, 0), VIEW_COLORS.axisX],
    [new THREE.Vector3(0, 1, 0), VIEW_COLORS.axisY],
    [new THREE.Vector3(0, 0, 1), VIEW_COLORS.axisZ],
  ];
  for (const [direction, color] of directions) {
    const positive = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), direction]);
    axes.add(new THREE.Line(positive, new THREE.LineBasicMaterial({ color })));
    const negative = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      direction.clone().negate(),
    ]);
    const dashed = new THREE.Line(
      negative,
      new THREE.LineDashedMaterial({ color, dashSize: AXIS_DASH, gapSize: AXIS_DASH }),
    );
    dashed.computeLineDistances();
    axes.add(dashed);
  }
  return axes;
}

/**
 * The 3D view. Renders on demand: a frame is drawn only after the session changes or the view is resized. The scene is
 * Z-up, like the kernel.
 */
export class Viewport {
  readonly canvas: HTMLCanvasElement;

  readonly #container: HTMLElement;
  readonly #source: ViewSource;
  readonly #callbacks: ViewportCallbacks;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #perspective = new THREE.PerspectiveCamera();
  readonly #orthographic = new THREE.OrthographicCamera();
  readonly #model: ModelRenderer;
  readonly #shadows: ShadowController;
  readonly #sections = new SectionOverlay();
  readonly #axes = buildAxes();
  /** Background color, sky and ground, fog and environment. */
  readonly #background: BackgroundController;
  /** Bounding sphere of the model from the last camera update. */
  #sphere = new THREE.Sphere();
  readonly #resizeObserver: ResizeObserver;
  readonly #unsubscribe: () => void;
  #frame: number | null = null;
  #width = 1;
  #height = 1;
  /** Lights, shadows and sections need refreshing; camera moves alone never set this. */
  #lightingDirty = true;

  /** Throws when WebGL is unavailable; the caller reports that to the user. */
  constructor(container: HTMLElement, source: ViewSource, callbacks: ViewportCallbacks = {}) {
    this.#container = container;
    this.#source = source;
    this.#callbacks = callbacks;
    this.#renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.#renderer.setClearColor(VIEW_COLORS.background);
    this.#renderer.localClippingEnabled = true;
    this.canvas = this.#renderer.domElement;
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    container.append(this.canvas);

    for (const camera of [this.#perspective, this.#orthographic]) camera.up.set(0, 0, 1);
    this.#shadows = new ShadowController(this.#renderer);
    this.#scene.add(...this.#shadows.objects, this.#axes);
    this.#background = new BackgroundController(this.#renderer, this.#scene);

    this.#model = new ModelRenderer(source, () => {
      this.requestRender();
    });
    this.#scene.add(this.#model.root, this.#sections.group, this.#model.overlay, this.#model.preview);

    this.#unsubscribe = source.subscribe((change) => {
      this.#model.handleChange(change);
      this.#sections.handleChange(change);
      if (change.kind !== 'camera') this.#lightingDirty = true;
      this.requestRender();
    });
    this.#resizeObserver = new ResizeObserver(() => {
      this.#resize();
    });
    this.#resizeObserver.observe(container);
    this.#resize();
  }

  get size(): { width: number; height: number } {
    return { width: this.#width, height: this.#height };
  }

  requestRender(): void {
    this.#frame ??= requestAnimationFrame(() => {
      this.#frame = null;
      this.#render();
    });
  }

  /** The current image as a PNG data URL. */
  toDataUrl(): string {
    this.#render();
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#unsubscribe();
    this.#resizeObserver.disconnect();
    this.#model.dispose();
    this.#sections.dispose();
    this.#shadows.dispose();
    this.#background.dispose();
    this.#axes.traverse((object) => {
      if (object instanceof THREE.Line) {
        (object.geometry as THREE.BufferGeometry).dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    this.#renderer.dispose();
    this.canvas.remove();
  }

  #resize(): void {
    const width = Math.max(1, Math.floor(this.#container.clientWidth));
    const height = Math.max(1, Math.floor(this.#container.clientHeight));
    if (width === this.#width && height === this.#height && this.canvas.width > 0) return;
    this.#width = width;
    this.#height = height;
    this.#renderer.setSize(width, height, false);
    this.#callbacks.onResize?.({ width, height });
    this.requestRender();
  }

  #render(): void {
    const changed = this.#model.update();
    if (changed || this.#lightingDirty) {
      this.#sections.update(this.#source, this.#model.root);
      this.#shadows.update(this.#renderer, this.#source.doc.shadows, this.#model.root, this.#model.bounds());
      this.#background.update(this.#source);
      this.#lightingDirty = false;
    }
    const camera = this.#syncCamera();
    this.#syncStyleView(camera, this.#renderer.getPixelRatio());
    this.#renderer.render(this.#scene, camera);
  }

  /** Passes the drawing size, camera and model depth range to the style materials and the sky. */
  #syncStyleView(camera: THREE.Camera, pixelRatio: number): void {
    const view = this.#source.camera;
    const eye = new THREE.Vector3(view.eye.x, view.eye.y, view.eye.z);
    const forward = new THREE.Vector3(view.target.x, view.target.y, view.target.z).sub(eye).normalize();
    const center = forward.dot(this.#sphere.center.clone().sub(eye));
    const radius = Math.max(this.#sphere.radius, 0);
    this.#model.setStyleView({
      width: this.#width,
      height: this.#height,
      pixelRatio,
      projection: view.projection,
      fovDegrees: view.fovDegrees,
      orthoHalfHeight: view.orthoHalfHeight,
      depthNear: Math.max(0, center - radius),
      depthFar: center + radius,
    });
    this.#background.beforeRender(camera, view.projection === 'parallel');
  }

  #syncCamera(): THREE.Camera {
    const view = this.#source.camera;
    const eye = new THREE.Vector3(view.eye.x, view.eye.y, view.eye.z);
    const target = new THREE.Vector3(view.target.x, view.target.y, view.target.z);
    const sphere = this.#model.bounds().getBoundingSphere(new THREE.Sphere());
    this.#sphere = sphere;
    const reach = sphere.radius > 0 ? eye.distanceTo(sphere.center) + sphere.radius : eye.distanceTo(target);
    const far = Math.max(reach * 2, MIN_FAR);
    const near = Math.max(far * NEAR_TO_FAR_RATIO, MIN_NEAR);
    const aspect = this.#width / this.#height;
    const axes = this.#source.doc.axes;
    const red = new THREE.Vector3(axes.xAxis.x, axes.xAxis.y, axes.xAxis.z);
    const green = new THREE.Vector3(axes.yAxis.x, axes.yAxis.y, axes.yAxis.z);
    const blue = red.clone().cross(green);
    // The axes run past the edge of the view in every direction, so they read as infinite lines.
    const origin = new THREE.Vector3(axes.origin.x, axes.origin.y, axes.origin.z);
    const span = axisReach({
      eyeToOrigin: eye.distanceTo(origin),
      targetToOrigin: target.distanceTo(origin),
      far,
      viewRadius: view.projection === 'parallel' ? view.orthoHalfHeight * Math.max(aspect, 1) : far,
    });
    this.#axes.matrix
      .makeBasis(red.multiplyScalar(span), green.multiplyScalar(span), blue.multiplyScalar(span))
      .setPosition(axes.origin.x, axes.origin.y, axes.origin.z);
    this.#axes.matrixWorldNeedsUpdate = true;

    if (view.projection === 'parallel') {
      const camera = this.#orthographic;
      const halfHeight = view.orthoHalfHeight;
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.near = -far;
      camera.far = far;
      camera.position.copy(eye);
      camera.up.set(view.up.x, view.up.y, view.up.z);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      return camera;
    }
    const camera = this.#perspective;
    camera.fov = view.fovDegrees;
    camera.aspect = aspect;
    camera.near = near;
    camera.far = far;
    camera.position.copy(eye);
    camera.up.set(view.up.x, view.up.y, view.up.z);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    return camera;
  }

  /**
   * Renders the current view into an offscreen image of the given size and encodes it as PNG. The on-screen canvas
   * is not changed. Tool previews, overlays and the drawing axes are left out. The size is clamped to what the GPU
   * can render.
   */
  capture(options: { width: number; height: number; transparentBackground: boolean }): Promise<Blob> {
    const renderer = this.#renderer;
    const max = renderer.capabilities.maxTextureSize;
    const width = Math.max(1, Math.min(max, Math.round(options.width)));
    const height = Math.max(1, Math.min(max, Math.round(options.height)));
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4, type: THREE.UnsignedByteType });
    const previous = {
      width: this.#width,
      height: this.#height,
      color: renderer.getClearColor(new THREE.Color()),
    };
    const previousAlpha = renderer.getClearAlpha();
    const hidden = [this.#model.overlay, this.#model.preview, this.#axes].filter((object) => object.visible);
    const pixels = new Uint8Array(width * height * 4);
    try {
      for (const object of hidden) object.visible = false;
      this.#width = width;
      this.#height = height;
      this.#model.update();
      const camera = this.#syncCamera();
      this.#background.setHiddenForCapture(options.transparentBackground);
      this.#syncStyleView(camera, 1);
      if (options.transparentBackground) renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(target);
      renderer.render(this.#scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    } finally {
      renderer.setRenderTarget(null);
      renderer.setClearColor(previous.color, previousAlpha);
      this.#background.setHiddenForCapture(false);
      this.#width = previous.width;
      this.#height = previous.height;
      for (const object of hidden) object.visible = true;
      target.dispose();
      this.requestRender();
    }
    // Render targets hold linear color, bottom row first; PNG wants sRGB, top row first, not premultiplied.
    const toSrgb = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      const linear = i / 255;
      toSrgb[i] = Math.round(
        255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055),
      );
    }
    const image = new ImageData(width, height);
    for (let y = 0; y < height; y++) {
      const from = (height - 1 - y) * width * 4;
      const to = y * width * 4;
      for (let x = 0; x < width * 4; x += 4) {
        const alpha = pixels[from + x + 3] ?? 255;
        const unpremultiply = alpha > 0 && alpha < 255 ? 255 / alpha : 1;
        for (let c = 0; c < 3; c++) {
          image.data[to + x + c] =
            toSrgb[Math.min(255, Math.round((pixels[from + x + c] ?? 0) * unpremultiply))] ?? 0;
        }
        image.data[to + x + 3] = options.transparentBackground ? alpha : 255;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.putImageData(image, 0, 0);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The image could not be encoded'));
      }, 'image/png');
    });
  }
}
