import { Component, type ReactNode } from 'react';

/**
 * Contains a render failure to the subtree: `fallback` shows in its place
 * instead of React unmounting the whole app (a blank window). A new
 * `resetKey` (another conversation or panel) or `reset()` tries again.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback: (error: unknown, reset: () => void) => ReactNode; resetKey?: unknown; label?: string },
  { error: unknown; failed: boolean }
> {
  state = { error: null as unknown, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[${this.props.label ?? 'render'}] render failed`, error);
  }

  componentDidUpdate(previous: { resetKey?: unknown }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.reset();
  }

  reset = () => this.setState({ error: null, failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}
