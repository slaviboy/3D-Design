import * as THREE from 'three';
import { ModelRenderer } from './ModelRenderer';
import { VIEW_COLORS } from './palette';
import { SectionOverlay } from './sections/SectionOverlay';
import { ShadowController } from './shadows/ShadowController';
import type { ViewSource } from './ViewSource';

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

    this.#model = new ModelRenderer(source);
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
      this.#lightingDirty = false;
    }
    const camera = this.#syncCamera();
    this.#renderer.render(this.#scene, camera);
  }

  #syncCamera(): THREE.Camera {
    const view = this.#source.camera;
    const eye = new THREE.Vector3(view.eye.x, view.eye.y, view.eye.z);
    const target = new THREE.Vector3(view.target.x, view.target.y, view.target.z);
    const sphere = this.#model.bounds().getBoundingSphere(new THREE.Sphere());
    const reach = sphere.radius > 0 ? eye.distanceTo(sphere.center) + sphere.radius : eye.distanceTo(target);
    const far = Math.max(reach * 2, MIN_FAR);
    const near = Math.max(far * NEAR_TO_FAR_RATIO, MIN_NEAR);
    const aspect = this.#width / this.#height;
    const axes = this.#source.doc.axes;
    const red = new THREE.Vector3(axes.xAxis.x, axes.xAxis.y, axes.xAxis.z);
    const green = new THREE.Vector3(axes.yAxis.x, axes.yAxis.y, axes.yAxis.z);
    const blue = red.clone().cross(green);
    this.#axes.matrix
      .makeBasis(red.multiplyScalar(far), green.multiplyScalar(far), blue.multiplyScalar(far))
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
}
