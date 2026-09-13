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
import { vec3 } from '../../../src/kernel/math/vec3';
import { insertCurve } from '../../../src/kernel/ops/curves';
import { eraseEdges } from '../../../src/kernel/ops/erase';
import { counts, draw, expectValid, newDocument, polygon, rectangle } from '../helpers';

/**
 * Faces whose loops touch at a single vertex. Kernel fuzzing found that such regions were rejected as invalid
 * ("loop-not-simple"), which would have made ordinary drawing operations fail.
 */
describe('regions pinched at a vertex', () => {
  const diamondTouchingBottomEdge = polygon([vec3(2, 0, 0), vec3(3, 1, 0), vec3(2, 2, 0), vec3(1, 1, 0)]);

  it('fuzz counterexample: a rectangle drawn around a pentagon whose corner touches its edge', () => {
    const doc = newDocument();
    insertCurve(doc, doc.rootDefinitionId, {
      kind: 'circle',
      center: vec3(1, 1, 0),
      normal: vec3(0, 0, 1),
      xAxis: vec3(1, 0, 0),
      radius: 1,
      segments: 5,
    });
    draw(doc, rectangle(0, 0, 2, 2));
    expect(counts(doc)).toEqual({ v: 9, e: 10, f: 2 });
    expectValid(doc);
  });

  it('fuzz counterexample: a smaller pentagon drawn inside a larger one becomes its hole, not the reverse', () => {
    const doc = newDocument();
    const pentagon = (radius: number) =>
      insertCurve(doc, doc.rootDefinitionId, {
        kind: 'circle',
        center: vec3(1, 2, 0),
        normal: vec3(0, 0, 1),
        xAxis: vec3(1, 0, 0),
        radius,
        segments: 5,
      });
    pentagon(1);
    pentagon(0.5);
    expect(counts(doc)).toEqual({ v: 10, e: 10, f: 2 });
    const holeCounts = [...doc.rootStore.faces()].map((face) => face.inners.length).sort();
    expect(holeCounts).toEqual([0, 1]);
    expectValid(doc);
  });

  it('a hole whose corner touches the outer boundary becomes a hole loop of the surrounding face', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 4, 4));
    draw(doc, diamondTouchingBottomEdge);
    expect(counts(doc)).toEqual({ v: 8, e: 9, f: 2 });
    const surrounding = [...doc.rootStore.faces()].filter((face) => face.inners.length === 1);
    expect(surrounding).toHaveLength(1);
    expectValid(doc);
  });

  it('two holes touching each other at a corner are separate hole loops', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 6, 6));
    draw(doc, rectangle(1, 1, 3, 3));
    draw(doc, rectangle(3, 3, 5, 5));
    expect(counts(doc)).toEqual({ v: 11, e: 12, f: 3 });
    const surrounding = [...doc.rootStore.faces()].find((face) => face.inners.length > 0);
    expect(surrounding?.inners).toHaveLength(2);
    expectValid(doc);
  });

  it('erasing an edge of a touching hole heals it into the surrounding face', () => {
    const doc = newDocument();
    draw(doc, rectangle(0, 0, 4, 4));
    const { createdEdges } = draw(doc, diamondTouchingBottomEdge);
    const diamondEdge = createdEdges.find((id) => doc.rootStore.getEdge(id).faces.length === 2);
    expect(diamondEdge).toBeDefined();
    if (diamondEdge !== undefined) eraseEdges(doc, doc.rootDefinitionId, [diamondEdge]);
    expect(counts(doc)).toEqual({ v: 8, e: 8, f: 1 });
    expectValid(doc);
  });
});
