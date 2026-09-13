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

import { err, ok, type Result } from '../../kernel/result';

/** Upgrades a parsed model.json by one schema version. Must not mutate its input. */
export type ModelMigration = (model: unknown) => Result<unknown>;

/**
 * Migrations keyed by the schema version they upgrade from. Version 1 is the first released schema, so there are none
 * yet. Every earlier version must stay loadable, so each schema change adds an entry here with fixture tests.
 */
export const MODEL_MIGRATIONS: ReadonlyMap<number, ModelMigration> = new Map();

/** Brings a parsed model from `fromVersion` up to `toVersion`, one step at a time. */
export function migrateModel(
  model: unknown,
  fromVersion: number,
  toVersion: number,
  migrations: ReadonlyMap<number, ModelMigration> = MODEL_MIGRATIONS,
): Result<unknown> {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) return err('the file has an invalid schema version');
  if (fromVersion > toVersion) {
    return err(`the file was created by a newer version of Planar (format version ${String(fromVersion)})`);
  }
  let current = model;
  for (let version = fromVersion; version < toVersion; version++) {
    const step = migrations.get(version);
    if (!step) return err(`there is no upgrade from format version ${String(version)}`);
    const result = step(current);
    if (!result.ok) return err(`upgrading from format version ${String(version)} failed: ${result.error}`);
    current = result.value;
  }
  return ok(current);
}
