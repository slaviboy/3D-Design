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

import type { DefinitionId } from './ids';

export type KernelErrorCode =
  | 'missing-entity'
  | 'duplicate-entity'
  | 'invalid-operation'
  | 'invalid-geometry'
  | 'transaction-required'
  | 'transaction-active'
  | 'invariant-violation';

/** Error raised by kernel operations. The `code` lets callers turn it into a user-facing message. */
export class KernelError extends Error {
  readonly code: KernelErrorCode;

  constructor(code: KernelErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KernelError';
    this.code = code;
  }
}

/** A single broken invariant found by the model validator. */
export interface ValidationProblem {
  readonly code: string;
  readonly message: string;
  readonly definitionId: DefinitionId | null;
  readonly ids: readonly number[];
}

/** Raised when a transaction would leave the model violating its invariants. The transaction has been rolled back. */
export class KernelInvariantError extends KernelError {
  readonly problems: readonly ValidationProblem[];

  constructor(label: string, problems: readonly ValidationProblem[]) {
    const summary = problems
      .slice(0, 5)
      .map((problem) => `${problem.code}: ${problem.message}`)
      .join('; ');
    super('invariant-violation', `"${label}" was rolled back because it broke model invariants: ${summary}`);
    this.name = 'KernelInvariantError';
    this.problems = problems;
  }
}
