/**
 * Inline error state with a retry action.
 *
 * Shares shadcn's Empty primitives with EmptyState, so a failed list and an empty one are laid
 * out identically and only their content differs. Every async surface in the app uses this
 * rather than rendering a raw message, so a failure always comes with a way out.
 */

import { RotateCcw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { cn } from '@/lib/utils';

const ErrorState = ({ message, onRetry, isRetrying = false, className }) => {
  return (
    <Empty className={className} role="alert">
      <EmptyHeader>
        <EmptyMedia className="text-destructive">
          <TriangleAlert className="size-6" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-sm font-normal">
          {message || 'Something went wrong.'}
        </EmptyTitle>
      </EmptyHeader>

      {onRetry ? (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
            <RotateCcw className={cn('size-4', isRetrying && 'animate-spin')} aria-hidden="true" />
            {isRetrying ? 'Retrying' : 'Try again'}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
};

export default ErrorState;
