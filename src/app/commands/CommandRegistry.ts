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

export type CommandCategory = 'File' | 'Edit' | 'View' | 'Camera' | 'Draw' | 'Tools' | 'Window' | 'Help';

export interface CommandDefinition<Context> {
  readonly id: string;
  readonly label: string;
  readonly category: CommandCategory;
  /** Short explanation shown in the command palette. */
  readonly description?: string;
  /** Canonical key chords, for example "Mod+Z" (see shortcuts.ts). */
  readonly defaultShortcuts?: readonly string[];
  /** Extra search terms for the command palette. */
  readonly aliases?: readonly string[];
  readonly isEnabled?: (context: Context) => boolean;
  /** For toggles and radio items: whether the command's state is currently on. */
  readonly isChecked?: (context: Context) => boolean;
  /** May be synchronous or return a promise; the registry awaits either. */
  readonly run: (context: Context) => unknown;
}

/**
 * The single place commands are defined. Menus, toolbars, the command palette and keyboard shortcuts all execute
 * commands through the registry by id, so each action has exactly one implementation.
 */
export class CommandRegistry<Context> {
  readonly #commands = new Map<string, CommandDefinition<Context>>();

  register(...definitions: CommandDefinition<Context>[]): void {
    for (const definition of definitions) {
      if (this.#commands.has(definition.id))
        throw new Error(`Command "${definition.id}" is already registered`);
      this.#commands.set(definition.id, definition);
    }
  }

  get(id: string): CommandDefinition<Context> | undefined {
    return this.#commands.get(id);
  }

  /** All commands in registration order. */
  all(): CommandDefinition<Context>[] {
    return [...this.#commands.values()];
  }

  isEnabled(id: string, context: Context): boolean {
    const command = this.#commands.get(id);
    return command !== undefined && (command.isEnabled?.(context) ?? true);
  }

  isChecked(id: string, context: Context): boolean {
    return this.#commands.get(id)?.isChecked?.(context) ?? false;
  }

  /** Runs a command if it exists and is enabled. Resolves to whether it ran; errors propagate to the caller. */
  async execute(id: string, context: Context): Promise<boolean> {
    const command = this.#commands.get(id);
    if (!command || !(command.isEnabled?.(context) ?? true)) return false;
    await command.run(context);
    return true;
  }
}
