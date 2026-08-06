/**
 * Appointment status badge.
 *
 * Every status carries an icon and a text label as well as a colour, so status is never
 * communicated by colour alone (WCAG 1.4.1). Colours come from the semantic status tokens in
 * styles/theme.css, so a palette change does not touch this file.
 */

import { Ban, CalendarCheck, CheckCircle2, Clock, UserX } from 'lucide-react';

import { cn } from '@/lib/utils';

const STATUS_CONFIG = {
  PENDING: {
    label: 'Pending',
    Icon: Clock,
    className: 'bg-status-pending/15 text-status-pending-foreground border-status-pending/40',
  },
  CONFIRMED: {
    label: 'Confirmed',
    Icon: CalendarCheck,
    className: 'bg-status-confirmed/15 text-status-confirmed-foreground border-status-confirmed/40',
  },
  CANCELLED: {
    label: 'Cancelled',
    Icon: Ban,
    className: 'bg-status-cancelled/15 text-status-cancelled-foreground border-status-cancelled/40',
  },
  COMPLETED: {
    label: 'Completed',
    Icon: CheckCircle2,
    className: 'bg-status-completed/15 text-status-completed-foreground border-status-completed/40',
  },
  NO_SHOW: {
    label: 'No show',
    Icon: UserX,
    className: 'bg-status-no-show/15 text-status-no-show-foreground border-status-no-show/40',
  },
};

const AppStatusBadge = ({ status, className }) => {
  // An unrecognised status still renders rather than crashing — a new server-side value
  // should degrade to something readable.
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    Icon: Clock,
    className: 'bg-muted text-muted-foreground border-border',
  };

  const { label, Icon, className: statusClassName } = config;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
        statusClassName,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
};

export default AppStatusBadge;
