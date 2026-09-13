import { describe, expect, it } from 'vitest';
import { migrateModel, MODEL_MIGRATIONS, type ModelMigration } from '../../src/io/format/migrations';
import { PLANAR_SCHEMA_VERSION } from '../../src/io/format/planarFile';
import { err, ok } from '../../src/kernel/result';

const addField =
  (name: string): ModelMigration =>
  (model) =>
    ok({ ...(model as Record<string, unknown>), [name]: true });

describe('model migrations', () => {
  it('has an upgrade for every schema version before the current one', () => {
    for (let version = 1; version < PLANAR_SCHEMA_VERSION; version++) {
      expect(MODEL_MIGRATIONS.has(version)).toBe(true);
    }
  });

  it('applies each step in order without changing the input', () => {
    const migrations = new Map([
      [1, addField('two')],
      [2, addField('three')],
    ]);
    const input = { one: true };
    const result = migrateModel(input, 1, 3, migrations);
    expect(result).toEqual(ok({ one: true, two: true, three: true }));
    expect(input).toEqual({ one: true });
    expect(migrateModel(input, 3, 3, migrations)).toEqual(ok(input));
  });

  it('reports missing or failing steps and newer files', () => {
    const migrations = new Map<number, ModelMigration>([
      [1, addField('two')],
      [2, () => err('bad data')],
    ]);
    expect(migrateModel({}, 1, 4, migrations)).toEqual(
      err('upgrading from format version 2 failed: bad data'),
    );
    expect(migrateModel({}, 3, 4, migrations)).toEqual(err('there is no upgrade from format version 3'));
    expect(migrateModel({}, 5, 4, migrations).ok).toBe(false);
    expect(migrateModel({}, 0, 4, migrations).ok).toBe(false);
  });
});
