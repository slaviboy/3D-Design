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

import { describe, expect, it } from 'vitest';
import { INSTRUCTOR_HINTS, instructorHint, modifierKeyNames } from '../../src/app/instructor/instructor';
import { MOVE_TOOL_ID, SELECT_TOOL_ID } from '../../src/app/tools/Tool';
import { PAINT_TOOL_ID } from '../../src/app/tools/PaintBucketTool';
import { createTestEditor } from './fixtures';

const toolIds = (): string[] =>
  createTestEditor()
    .tools.tools()
    .map((tool) => tool.id);

describe('Instructor hints', () => {
  it('cover every registered tool, and only registered tools', () => {
    const ids = toolIds();
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) {
      for (const platform of ['mac', 'other'] as const) {
        const hint = instructorHint(id, platform);
        expect(hint, `hint for ${id}`).not.toBeNull();
        expect(hint?.title).not.toBe('');
        expect(hint?.purpose).not.toBe('');
        expect(hint?.steps.length).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(INSTRUCTOR_HINTS).sort()).toEqual([...ids].sort());
    expect(instructorHint('tool.unknown', 'other')).toBeNull();
  });

  it('match each tool’s title to its label', () => {
    for (const tool of createTestEditor().tools.tools()) {
      expect(instructorHint(tool.id, 'other')?.title).toBe(tool.label);
    }
  });

  it('name modifier keys as the platform does', () => {
    expect(modifierKeyNames('mac')).toEqual({ toggle: 'Option', sample: 'Command' });
    expect(modifierKeyNames('other')).toEqual({ toggle: 'Ctrl', sample: 'Alt' });

    const keys = (toolId: string, platform: 'mac' | 'other') =>
      instructorHint(toolId, platform)?.keys.map((key) => key.keys) ?? [];
    expect(keys(MOVE_TOOL_ID, 'mac')).toContain('Option');
    expect(keys(MOVE_TOOL_ID, 'mac')).not.toContain('Ctrl');
    expect(keys(MOVE_TOOL_ID, 'other')).toContain('Ctrl');
    expect(keys(SELECT_TOOL_ID, 'mac')).toContain('Shift+Option');
    expect(keys(PAINT_TOOL_ID, 'mac')).toContain('Command');
    expect(keys(PAINT_TOOL_ID, 'other')).toContain('Alt');
  });

  it('describe the measurements box only for tools that have one', () => {
    const editor = createTestEditor();
    expect(instructorHint(MOVE_TOOL_ID, 'other')?.measurements).toMatch(/3x/);
    for (const tool of editor.tools.tools()) {
      editor.activateTool(tool.id);
      // Tools that show a measurements box as soon as they are active must say what it accepts.
      if (editor.tools.measurement) {
        expect(instructorHint(tool.id, 'other')?.measurements, tool.id).not.toBeNull();
      }
    }
  });
});
