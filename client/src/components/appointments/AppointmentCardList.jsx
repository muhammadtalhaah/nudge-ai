/**
 * Mobile view of appointments.
 *
 * A dense table squeezed into a phone is unreadable, so small screens get cards with the most
 * important fields first and the same actions as the desktop table.
 */

import { CalendarDays, Stethoscope } from 'lucide-react';

import AppStatusBadge from '@/components/shared/AppStatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useClinicTimezone } from '@/context/AuthContext';
import { formatDateTime } from '@/utils/formatDate';

const isCancellable = (status) => status === 'CONFIRMED' || status === 'PENDING';

const AppointmentCardList = ({ appointments, onCancel, cancellingId }) => {
  // Clinic time, like everywhere else an appointment is shown. A card that renders the
  // reader's zone while the chat renders the clinic's makes two screens disagree about the
  // same booking.
  const clinicTimezone = useClinicTimezone();

  return (
    <ul className="space-y-3">
      {appointments.map((appointment) => (
        <li key={appointment.id}>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 font-medium">
                  <CalendarDays
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                  {formatDateTime(appointment.startsAt, clinicTimezone)}
                </div>
                <AppStatusBadge status={appointment.status} />
              </div>

              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Stethoscope className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {appointment.providerName} · {appointment.providerSpecialty}
                </span>
              </div>

              {appointment.notes ? (
                <p className="text-muted-foreground line-clamp-2 text-sm">{appointment.notes}</p>
              ) : null}

              {isCancellable(appointment.status) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onCancel(appointment)}
                  disabled={cancellingId === appointment.id}
                  aria-label={`Cancel appointment with ${appointment.providerName} on ${formatDateTime(appointment.startsAt, clinicTimezone)}`}
                >
                  {cancellingId === appointment.id ? 'Cancelling' : 'Cancel appointment'}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
};

export default AppointmentCardList;
