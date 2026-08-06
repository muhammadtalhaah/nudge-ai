/**
 * Full-viewport loading state, used while the app works out whether there is a session.
 */

import { Loader2 } from 'lucide-react';

const FullPageSpinner = ({ label = 'Loading' }) => {
  return (
    <div
      className="flex min-h-dvh items-center justify-center"
      // Announced to assistive tech, since visually it is just a spinning icon.
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
        <p className="text-muted-foreground text-sm">{label}…</p>
      </div>
    </div>
  );
};

export default FullPageSpinner;
