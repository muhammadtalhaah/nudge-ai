/**
 * Catches render errors so one broken subtree does not blank the whole app.
 *
 * A class component because that is still the only way to implement componentDidCatch —
 * there is no hook equivalent.
 */

import { Component } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // In a real deployment this is where an error reporter would be called. Logging to the
    // console at minimum means the failure is not silent.
    console.error('Unhandled render error:', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, title = 'Something went wrong' } = this.props;

    if (!error) return children;

    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6" role="alert">
        <div className="max-w-md space-y-4 text-center">
          <TriangleAlert className="text-destructive mx-auto size-8" aria-hidden="true" />
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm">
            This part of the page failed to load. You can try again — the rest of the app is
            unaffected.
          </p>
          <Button onClick={this.handleReset} variant="outline">
            <RotateCcw className="size-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
