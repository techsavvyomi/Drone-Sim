import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportRenderError } from '../analytics/crashReporting';

// The last line of defence for the whole UI.
//
// Without it, anything that throws while rendering unmounts the entire app and
// leaves a blank window with no way out but quitting. This reports the error and
// offers a reload, which is almost always enough: the stores start fresh and
// the pilot lands on the home screen.

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] render failed', error);
    reportRenderError(error, info.componentStack ?? undefined, true);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="app-crash">
        <div className="app-crash-card">
          <span className="app-crash-tag">System fault</span>
          <h1>Something went wrong</h1>
          <p>
            The simulator hit an error and stopped this screen. A crash report has been sent so it can be fixed.
          </p>
          <code>{error.message}</code>
          <button className="pro-btn" onClick={() => window.location.reload()}>
            Reload simulator
          </button>
        </div>
      </div>
    );
  }
}
