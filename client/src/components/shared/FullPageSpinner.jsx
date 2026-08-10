/**
 * Full-viewport loading state, used while the app works out whether there is a session.
 */

import { Spinner } from '@/components/ui/spinner';

const FullPageSpinner = ({ label = 'Loading' }) => {
  return (
    <div
      className="flex min-h-dvh items-center justify-center"
      // Announced to assistive tech, since visually it is just a spinning icon.
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        {/* The wrapper above already carries the status role and the label, so the icon's own
            defaults are cleared rather than announced a second time. */}
        <Spinner
          className="text-muted-foreground size-6"
          role={undefined}
          aria-label={undefined}
          aria-hidden="true"
        />
        <p className="text-muted-foreground text-sm">{label}…</p>
      </div>
    </div>
  );
};

export default FullPageSpinner;
