import { srgbFromRgb } from '../mesh/color';
import { flattenScene, type ExportScene } from './exportScene';

/* OBJ (with MTL) and STL (binary and ASCII) writers. Both formats are flat lists of triangles in file space. */

/** Shortest decimal text that keeps a coordinate to ten significant digits. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value) || Object.is(value, -0)) return '0';
  return String(Number.parseFloat(value.toPrecision(10)));
}

/** A name OBJ and MTL tools accept: no whitespace. */
function objName(name: string, fallback: string): string {
  const cleaned = name.trim().replace(/\s+/g, '_');
  return cleaned === '' ? fallback : cleaned;
}

export function writeObj(scene: ExportScene, mtlFileName: string): { obj: string; mtl: string } {
  const usedNames = new Set<string>();
  const unique = (base: string): string => {
    let name = base;
    for (let n = 2; usedNames.has(name); n++) name = `${base}_${String(n)}`;
    usedNames.add(name);
    return name;
  };
  const materialNames = scene.materials.map((material, index) =>
    unique(objName(material.name, `material_${String(index + 1)}`)),
  );
  const defaultName = unique('Default');
  let usesDefault = false;

  const lines: string[] = ['# Exported by Planar', `mtllib ${mtlFileName}`];
  let vertexBase = 1;
  let normalBase = 1;
  const objectNames = new Set<string>();
  for (const object of flattenScene(scene)) {
    let name = objName(object.name, 'object');
    for (let n = 2; objectNames.has(name); n++) name = `${objName(object.name, 'object')}_${String(n)}`;
    objectNames.add(name);
    const count = object.materials.length;
    lines.push(`o ${name}`);
    for (let i = 0; i < count * 3; i++) {
      lines.push(
        `v ${formatNumber(object.positions[i * 3] ?? 0)} ${formatNumber(object.positions[i * 3 + 1] ?? 0)} ${formatNumber(object.positions[i * 3 + 2] ?? 0)}`,
      );
    }
    for (let t = 0; t < count; t++) {
      lines.push(
        `vn ${formatNumber(object.normals[t * 3] ?? 0)} ${formatNumber(object.normals[t * 3 + 1] ?? 0)} ${formatNumber(object.normals[t * 3 + 2] ?? 0)}`,
      );
    }
    let current: string | null = null;
    for (let t = 0; t < count; t++) {
      const material = object.materials[t] ?? -1;
      const materialName = material >= 0 ? (materialNames[material] ?? defaultName) : defaultName;
      if (materialName === defaultName) usesDefault = true;
      if (materialName !== current) {
        lines.push(`usemtl ${materialName}`);
        current = materialName;
      }
      const n = normalBase + t;
      const v = vertexBase + t * 3;
      lines.push(
        `f ${String(v)}//${String(n)} ${String(v + 1)}//${String(n)} ${String(v + 2)}//${String(n)}`,
      );
    }
    vertexBase += count * 3;
    normalBase += count;
  }

  const mtl: string[] = ['# Exported by Planar'];
  const writeMaterial = (name: string, rgb: readonly number[], opacity: number): void => {
    mtl.push(
      '',
      `newmtl ${name}`,
      'Ka 0 0 0',
      `Kd ${rgb.map((channel) => formatNumber(Math.round(channel * 1e6) / 1e6)).join(' ')}`,
      'Ks 0 0 0',
      `d ${formatNumber(opacity)}`,
      'illum 1',
    );
  };
  scene.materials.forEach((material, index) => {
    writeMaterial(materialNames[index] ?? defaultName, srgbFromRgb(material.color), material.opacity);
  });
  if (usesDefault) writeMaterial(defaultName, [0.8, 0.8, 0.8], 1);
  return { obj: `${lines.join('\n')}\n`, mtl: `${mtl.join('\n')}\n` };
}

const STL_HEADER = 'Binary STL exported by Planar';

export function writeStlBinary(scene: ExportScene): Uint8Array {
  const objects = flattenScene(scene);
  const count = objects.reduce((sum, object) => sum + object.materials.length, 0);
  const out = new Uint8Array(84 + count * 50);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(STL_HEADER).subarray(0, 80));
  view.setUint32(80, count, true);
  let offset = 84;
  for (const object of objects) {
    for (let t = 0; t < object.materials.length; t++) {
      for (let k = 0; k < 3; k++) view.setFloat32(offset + k * 4, object.normals[t * 3 + k] ?? 0, true);
      for (let k = 0; k < 9; k++)
        view.setFloat32(offset + 12 + k * 4, object.positions[t * 9 + k] ?? 0, true);
      offset += 50;
    }
  }
  return out;
}

export function writeStlAscii(scene: ExportScene, name: string): string {
  const solid = objName(name, 'model');
  const lines: string[] = [`solid ${solid}`];
  for (const object of flattenScene(scene)) {
    for (let t = 0; t < object.materials.length; t++) {
      const n = [0, 1, 2].map((k) => formatNumber(object.normals[t * 3 + k] ?? 0)).join(' ');
      lines.push(`  facet normal ${n}`, '    outer loop');
      for (let corner = 0; corner < 3; corner++) {
        const p = [0, 1, 2].map((k) => formatNumber(object.positions[t * 9 + corner * 3 + k] ?? 0)).join(' ');
        lines.push(`      vertex ${p}`);
      }
      lines.push('    endloop', '  endfacet');
    }
  }
  lines.push(`endsolid ${solid}`);
  return `${lines.join('\n')}\n`;
}
