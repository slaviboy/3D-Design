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

/**
 * Where the message goes when the area fails: in its place (`block`), on one line for the bars (`line`), floating
 * above the workspace for dialogs and layers (`overlay`), or across the whole window when nothing else is left (`page`).
 */
export type ErrorBoundaryLayout = 'block' | 'line' | 'overlay' | 'page';

interface ErrorBoundaryProps {
  /** Short name of the area, used in the message ("the Entity Info panel"). */
  readonly area: string;
  readonly layout?: ErrorBoundaryLayout;
  /** Closes the failed area (a dialog, for example); offered next to Try Again when given. */
  readonly onDismiss?: () => void;
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
    const { area, layout = 'block', onDismiss } = this.props;
    return (
      <div className={`error-boundary error-boundary--${layout}`} role="alert">
        <p className="error-boundary__message">Something went wrong in {area}.</p>
        <p className="error-boundary__detail">{this.state.error.message}</p>
        <div className="error-boundary__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              this.setState({ error: null });
            }}
          >
            Try again
          </button>
          {onDismiss && (
            <button
              type="button"
              className="button"
              onClick={() => {
                this.setState({ error: null });
                onDismiss();
              }}
            >
              Close
            </button>
          )}
          {layout === 'page' && (
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                window.location.reload();
              }}
            >
              Reload
            </button>
          )}
        </div>
      </div>
    );
  }
}
