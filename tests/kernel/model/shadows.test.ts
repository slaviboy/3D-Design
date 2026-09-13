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
import { KernelError } from '../../../src/kernel/errors';
import { ModelDocument } from '../../../src/kernel/model/ModelDocument';
import { setShadowSettings } from '../../../src/kernel/model/mutations';
import { createSnapshot, hashDocument, restoreSnapshot } from '../../../src/kernel/model/snapshot';
import { DEFAULT_SHADOW_SETTINGS } from '../../../src/kernel/model/types';

describe('shadow settings', () => {
  it('start at the defaults, which snapshots leave out', () => {
    const doc = new ModelDocument();
    expect(doc.shadows).toEqual(DEFAULT_SHADOW_SETTINGS);
    expect(createSnapshot(doc).shadows).toBeUndefined();
  });

  it('change as one undoable document change, normalizing the date and north angle', () => {
    const doc = new ModelDocument({ validateOnCommit: true });
    const before = hashDocument(doc);
    doc.transact('Shadow Settings', () => {
      setShadowSettings(doc, {
        enabled: true,
        dateTime: '2026-06-21T09:15+02:00',
        latitude: 48.2,
        longitude: 16.37,
        northAngle: -30,
        light: 0.9,
        dark: 0.3,
        onGround: false,
      });
    });
    expect(doc.shadows).toMatchObject({
      enabled: true,
      dateTime: '2026-06-21T09:15:00+02:00',
      northAngle: 330,
      onGround: false,
    });
    expect(doc.undoDepth).toBe(1);
    const after = hashDocument(doc);
    expect(after).not.toBe(before);
    doc.undo();
    expect(doc.shadows).toEqual(DEFAULT_SHADOW_SETTINGS);
    expect(hashDocument(doc)).toBe(before);
    doc.redo();
    expect(hashDocument(doc)).toBe(after);

    doc.transact('Same', () => {
      setShadowSettings(doc, { enabled: true });
    });
    expect(doc.undoDepth).toBe(1);
  });

  it('refuse invalid values without changing anything', () => {
    const doc = new ModelDocument();
    for (const patch of [
      { latitude: 91 },
      { longitude: -181 },
      { light: 1.5 },
      { dark: -0.1 },
      { dateTime: 'tomorrow' },
      { northAngle: Number.NaN },
    ]) {
      expect(() => {
        doc.transact('Bad', () => {
          setShadowSettings(doc, patch);
        });
      }).toThrow(KernelError);
    }
    expect(doc.shadows).toEqual(DEFAULT_SHADOW_SETTINGS);
    expect(doc.undoDepth).toBe(0);
  });

  it('survive a snapshot round trip; invalid settings in a file are rejected', () => {
    const doc = new ModelDocument();
    doc.transact('Shadows', () => {
      setShadowSettings(doc, { enabled: true, latitude: -33.9, useSunForShading: true });
    });
    const snapshot = createSnapshot(doc);
    expect(snapshot.shadows?.latitude).toBe(-33.9);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.value.shadows).toEqual(doc.shadows);
      expect(hashDocument(restored.value)).toBe(hashDocument(doc));
    }
    const broken = { ...snapshot, shadows: { ...snapshot.shadows, dateTime: '2026-02-30T10:00:00Z' } };
    expect(restoreSnapshot(JSON.parse(JSON.stringify(broken))).ok).toBe(false);
    const missingField = { ...snapshot, shadows: { enabled: true } };
    expect(restoreSnapshot(JSON.parse(JSON.stringify(missingField))).ok).toBe(false);
  });
});
