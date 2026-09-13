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

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createLogger } from '../../app/diagnostics/log';

const uiLog = createLogger('ui');

interface ErrorBoundaryProps {
  /** Short name of the area, used in the message ("the Entity Info panel"). */
  readonly area: string;
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/** Contains rendering errors to one area of the interface, so a broken panel never takes down the viewport. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Silent in production unless diagnostics are turned on (see src/app/diagnostics/log.ts).
    uiLog.error(`Rendering failed in ${this.props.area}`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <p>Something went wrong in {this.props.area}.</p>
        <p className="error-boundary__detail">{this.state.error.message}</p>
        <button
          type="button"
          className="button"
          onClick={() => {
            this.setState({ error: null });
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
