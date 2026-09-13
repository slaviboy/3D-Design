import * as THREE from 'three';
import { DEFAULT_SHADOW_SETTINGS, type ShadowSettings } from '../../kernel/model/types';
import { localDateTimeToUtc, parseLocalDateTime, solarPosition, sunDirection } from '../../kernel/sun/solar';
import { AMBIENT_LIGHT_INTENSITY, SUN_DIRECTION, SUN_LIGHT_INTENSITY } from '../palette';

/** Shadow map resolution in texels per side. */
const SHADOW_MAP_SIZE = 2048;
/** Smallest radius the shadow camera covers, in meters. */
const MIN_SHADOW_RADIUS = 1;
/** Depth bias against shadow acne. */
const SHADOW_BIAS = -0.0002;
/** Normal offset in shadow-map texels. */
const NORMAL_BIAS_TEXELS = 1.5;
/** The ground receiver extends this many bounding radii from the model's center. */
const GROUND_EXTENT_RADII = 8;
/** Darkness of ground shadows at full light. */
const GROUND_SHADOW_OPACITY = 0.45;

interface ShadowFlags {
  castShadows?: boolean;
  receiveShadows?: boolean;
  definitionId?: number;
}

/** Where the directional light comes from, and whether the sun is up. */
export function lightDirection(settings: ShadowSettings): { direction: THREE.Vector3; sunUp: boolean } {
  const fixed = new THREE.Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize();
  if (!settings.enabled && !settings.useSunForShading) return { direction: fixed, sunUp: true };
  const local = parseLocalDateTime(settings.dateTime);
  if (!local) return { direction: fixed, sunUp: true };
  const position = solarPosition(localDateTimeToUtc(local), settings.latitude, settings.longitude);
  const d = sunDirection(position, settings.northAngle);
  return { direction: new THREE.Vector3(d.x, d.y, d.z), sunUp: position.altitude > 0 };
}

/**
 * The sun, the ambient light and shadow casting. With default settings the lights match Planar's fixed lighting.
 * The shadow map is re-rendered only when the model or the settings change (the caller decides when): the shadow
 * camera is fitted to the model, not to the view, so orbiting never needs a new shadow map.
 */
export class ShadowController {
  readonly sun = new THREE.DirectionalLight(0xffffff, SUN_LIGHT_INTENSITY);
  readonly ambient = new THREE.AmbientLight(0xffffff, AMBIENT_LIGHT_INTENSITY);
  readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;

  constructor(renderer: THREE.WebGLRenderer) {
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    this.sun.position.set(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z);
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = SHADOW_BIAS;
    const material = new THREE.ShadowMaterial({ opacity: GROUND_SHADOW_OPACITY, depthWrite: false });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    this.ground.userData = { excludeFromBounds: true };
  }

  /** Objects to add to the scene. */
  get objects(): THREE.Object3D[] {
    return [this.sun, this.sun.target, this.ambient, this.ground];
  }

  /** Applies the settings to the lights, the shadow camera, the ground and the model's meshes. */
  update(
    renderer: THREE.WebGLRenderer,
    settings: ShadowSettings,
    modelRoot: THREE.Object3D,
    bounds: THREE.Box3,
  ): void {
    const { direction, sunUp } = lightDirection(settings);
    this.sun.intensity = sunUp ? (SUN_LIGHT_INTENSITY * settings.light) / DEFAULT_SHADOW_SETTINGS.light : 0;
    this.ambient.intensity = (AMBIENT_LIGHT_INTENSITY * settings.dark) / DEFAULT_SHADOW_SETTINGS.dark;

    const casting = settings.enabled && sunUp && !bounds.isEmpty();
    renderer.shadowMap.enabled = settings.enabled;
    this.sun.castShadow = casting;

    const sphere = bounds.isEmpty() ? new THREE.Sphere() : bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, MIN_SHADOW_RADIUS);
    this.sun.target.position.copy(sphere.center);
    this.sun.position.copy(sphere.center).addScaledVector(direction, radius * 2);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    const camera = this.sun.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = radius * 0.5;
    camera.far = radius * 3.5;
    camera.updateProjectionMatrix();
    this.sun.shadow.normalBias = ((2 * radius) / SHADOW_MAP_SIZE) * NORMAL_BIAS_TEXELS;

    this.ground.visible = casting && settings.onGround;
    this.ground.position.set(sphere.center.x, sphere.center.y, 0);
    this.ground.scale.setScalar(radius * GROUND_EXTENT_RADII);
    this.ground.material.opacity = GROUND_SHADOW_OPACITY * settings.light;

    const visit = (node: THREE.Object3D, cast: boolean, receive: boolean): void => {
      const flags = node.userData as ShadowFlags;
      const nodeCast = cast && flags.castShadows !== false;
      const nodeReceive = receive && flags.receiveShadows !== false;
      if (node instanceof THREE.Mesh) {
        node.castShadow = casting && nodeCast;
        node.receiveShadow = casting && settings.onFaces && nodeReceive;
      }
      for (const child of node.children) visit(child, nodeCast, nodeReceive);
    };
    visit(modelRoot, true, true);
    if (casting) renderer.shadowMap.needsUpdate = true;
  }

  dispose(): void {
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.sun.dispose();
  }
}
