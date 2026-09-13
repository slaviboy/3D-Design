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

import { srgbFromRgb } from '../mesh/color';
import type { ExportScene } from './exportScene';
import { formatNumber } from './meshWriters';

/*
 * COLLADA 1.4.1 writer. Geometry is written once per mesh and instanced by nodes (instance_geometry), so shared
 * components stay shared. The asset records the unit and up axis the coordinates were written in.
 */

export interface DaeWriteOptions {
  /** Meters per coordinate unit, recorded in the asset. */
  readonly unitMeters: number;
  readonly unitName: string;
  readonly upAxis: 'Y_UP' | 'Z_UP';
  readonly generator: string;
  readonly created: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const numbers = (values: ArrayLike<number>): string => Array.from(values, formatNumber).join(' ');

export function writeDae(scene: ExportScene, options: DaeWriteOptions): string {
  const out: string[] = [];
  const push = (line: string): void => {
    out.push(line);
  };
  push('<?xml version="1.0" encoding="utf-8"?>');
  push('<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">');
  push('  <asset>');
  push(`    <contributor><authoring_tool>${escapeXml(options.generator)}</authoring_tool></contributor>`);
  push(`    <created>${escapeXml(options.created)}</created>`);
  push(`    <modified>${escapeXml(options.created)}</modified>`);
  push(`    <unit name="${escapeXml(options.unitName)}" meter="${formatNumber(options.unitMeters)}"/>`);
  push(`    <up_axis>${options.upAxis}</up_axis>`);
  push('  </asset>');

  const usesDefault = scene.meshes.some((mesh) =>
    mesh.primitives.some((primitive) => primitive.material < 0),
  );
  const materials = [
    ...scene.materials.map((material, index) => ({ id: `material-${String(index)}`, ...material })),
    ...(usesDefault
      ? [{ id: 'material-default', name: 'Default', color: { r: 0.6, g: 0.6, b: 0.6 }, opacity: 1 }]
      : []),
  ];
  const materialId = (index: number): string =>
    index >= 0 ? `material-${String(index)}` : 'material-default';

  push('  <library_effects>');
  for (const material of materials) {
    const [r, g, b] = srgbFromRgb(material.color);
    push(`    <effect id="${material.id}-effect">`);
    push('      <profile_COMMON><technique sid="common"><lambert>');
    push(`        <diffuse><color sid="diffuse">${numbers([r, g, b, 1])}</color></diffuse>`);
    if (material.opacity < 1) {
      push('        <transparent opaque="A_ONE"><color>1 1 1 1</color></transparent>');
      push(`        <transparency><float>${formatNumber(material.opacity)}</float></transparency>`);
    }
    push('      </lambert></technique></profile_COMMON>');
    push('    </effect>');
  }
  push('  </library_effects>');

  push('  <library_materials>');
  for (const material of materials) {
    push(`    <material id="${material.id}" name="${escapeXml(material.name)}">`);
    push(`      <instance_effect url="#${material.id}-effect"/>`);
    push('    </material>');
  }
  push('  </library_materials>');

  push('  <library_geometries>');
  scene.meshes.forEach((mesh, index) => {
    const id = `mesh-${String(index)}`;
    const count = mesh.positions.length / 3;
    push(`    <geometry id="${id}" name="${escapeXml(mesh.name)}">`);
    push('      <mesh>');
    for (const [suffix, data] of [
      ['positions', mesh.positions],
      ['normals', mesh.normals],
    ] as const) {
      push(`        <source id="${id}-${suffix}">`);
      push(
        `          <float_array id="${id}-${suffix}-array" count="${String(count * 3)}">${numbers(data)}</float_array>`,
      );
      push('          <technique_common>');
      push(`            <accessor source="#${id}-${suffix}-array" count="${String(count)}" stride="3">`);
      push(
        '              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>',
      );
      push('            </accessor>');
      push('          </technique_common>');
      push('        </source>');
    }
    push(
      `        <vertices id="${id}-vertices"><input semantic="POSITION" source="#${id}-positions"/></vertices>`,
    );
    for (const primitive of mesh.primitives) {
      const symbol = materialId(primitive.material);
      push(`        <triangles material="${symbol}" count="${String(primitive.indices.length / 3)}">`);
      push(`          <input semantic="VERTEX" source="#${id}-vertices" offset="0"/>`);
      push(`          <input semantic="NORMAL" source="#${id}-normals" offset="0"/>`);
      push(`          <p>${Array.from(primitive.indices, String).join(' ')}</p>`);
      push('        </triangles>');
    }
    push('      </mesh>');
    push('    </geometry>');
  });
  push('  </library_geometries>');

  push('  <library_visual_scenes>');
  push('    <visual_scene id="scene" name="Scene">');
  const writeNode = (nodeIndex: number, indent: string): void => {
    const node = scene.nodes[nodeIndex];
    if (!node) return;
    push(`${indent}<node id="node-${String(nodeIndex)}" name="${escapeXml(node.name)}">`);
    const m = node.transform;
    const rowMajor = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15].map((i) => m[i] ?? 0);
    push(`${indent}  <matrix sid="transform">${numbers(rowMajor)}</matrix>`);
    const mesh = node.mesh === null ? undefined : scene.meshes[node.mesh];
    if (mesh && node.mesh !== null) {
      push(`${indent}  <instance_geometry url="#mesh-${String(node.mesh)}">`);
      push(`${indent}    <bind_material><technique_common>`);
      for (const symbol of new Set(mesh.primitives.map((primitive) => materialId(primitive.material)))) {
        push(`${indent}      <instance_material symbol="${symbol}" target="#${symbol}"/>`);
      }
      push(`${indent}    </technique_common></bind_material>`);
      push(`${indent}  </instance_geometry>`);
    }
    for (const childIndex of node.children) writeNode(childIndex, `${indent}  `);
    push(`${indent}</node>`);
  };
  for (const root of scene.roots) writeNode(root, '      ');
  push('    </visual_scene>');
  push('  </library_visual_scenes>');
  push('  <scene><instance_visual_scene url="#scene"/></scene>');
  push('</COLLADA>');
  return `${out.join('\n')}\n`;
}
