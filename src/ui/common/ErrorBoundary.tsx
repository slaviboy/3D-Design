import { Component, type ErrorInfo, type ReactNode } from 'react';

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
    if (import.meta.env.DEV) {
      // Development diagnostics only; production builds never log.
      // eslint-disable-next-line no-console
      console.error(error, info.componentStack);
    }
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
