/**
 * Inline error state with a retry action.
 *
 * Every async surface in the app uses this rather than rendering a raw message, so a failure
 * always comes with a way out.
 */

import { RotateCcw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ErrorState = ({ message, onRetry, isRetrying = false, className }) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        className,
      )}
      role="alert"
    >
      <TriangleAlert className="text-destructive size-6" aria-hidden="true" />
      <p className="text-sm">{message || 'Something went wrong.'}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
          <RotateCcw className={cn('size-4', isRetrying && 'animate-spin')} aria-hidden="true" />
          {isRetrying ? 'Retrying' : 'Try again'}
        </Button>
      ) : null}
    </div>
  );
};

export default ErrorState;
