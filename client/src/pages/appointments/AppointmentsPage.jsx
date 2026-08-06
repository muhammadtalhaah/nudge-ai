/**
 * Appointments: list, book, cancel.
 *
 * A container — it coordinates the data hook, the filter state (persisted to the URL), and the
 * presentational table/card components. It contains no fetching and no business rules.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarPlus, CalendarX2 } from 'lucide-react';
import { toast } from 'sonner';

import AppointmentCardList from './components/AppointmentCardList';
import AppointmentTable from './components/AppointmentTable';
import BookingForm from '@/components/shared/BookingForm';
import EmptyState from '@/components/shared/EmptyState';
import ErrorState from '@/components/shared/ErrorState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppointments, useCancelAppointment } from '@/hooks/useAppointments';
import { formatDateTime } from '@/utils/formatDate';

const SCOPES = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

const isValidScope = (value) => SCOPES.some((scope) => scope.value === value);

const AppointmentsPage = () => {
  // Filter state lives in the URL so it survives a refresh and can be shared as a link.
  const [searchParams, setSearchParams] = useSearchParams();
  const scopeParam = searchParams.get('scope');
  const scope = isValidScope(scopeParam) ? scopeParam : 'upcoming';

  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [pendingCancel, setPendingCancel] = useState(null);

  const { data, isPending, isError, error, refetch, isFetching } = useAppointments({ scope });
  const cancelAppointment = useCancelAppointment();

  const setScope = (next) => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.set('scope', next);
        return params;
      },
      { replace: true },
    );
  };

  const confirmCancel = async () => {
    if (!pendingCancel) return;

    try {
      await cancelAppointment.mutateAsync({ id: pendingCancel.id });
      toast.success('Appointment cancelled');
      setPendingCancel(null);
    } catch (cancelError) {
      // Kept open so the user can retry or dismiss deliberately.
      toast.error(cancelError.message || 'Could not cancel that appointment');
    }
  };

  const appointments = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
          <p className="text-muted-foreground text-sm">Everything you have booked with us.</p>
        </div>

        <Button onClick={() => setIsBookingOpen(true)}>
          <CalendarPlus className="size-4" aria-hidden="true" />
          Book appointment
        </Button>
      </div>

      {/* Scope filter. A real tablist so arrow keys work as a keyboard user expects. */}
      <div className="flex gap-1" role="tablist" aria-label="Filter appointments">
        {SCOPES.map((option) => (
          <Button
            key={option.value}
            role="tab"
            aria-selected={scope === option.value}
            variant={scope === option.value ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setScope(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {isPending ? (
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading appointments</span>
          {Array.from({ length: 4 }).map((_unused, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message={error?.message} onRetry={refetch} isRetrying={isFetching} />
      ) : appointments.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title={scope === 'past' ? 'No past appointments' : 'Nothing booked yet'}
          description={
            scope === 'past'
              ? 'Once you have attended an appointment it will appear here.'
              : 'Ask the assistant to book one for you, or use the form.'
          }
          action={
            scope !== 'past' ? (
              <Button variant="outline" onClick={() => setIsBookingOpen(true)}>
                Book your first appointment
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          {/* Table from tablet up, cards below — same data, one fetch. */}
          <div className="hidden md-tablet:block">
            <Card>
              <CardContent className="p-0 md-tablet:p-2">
                <AppointmentTable
                  appointments={appointments}
                  onCancel={setPendingCancel}
                  cancellingId={cancelAppointment.isPending ? pendingCancel?.id : null}
                />
              </CardContent>
            </Card>
          </div>

          <div className="md-tablet:hidden">
            <AppointmentCardList
              appointments={appointments}
              onCancel={setPendingCancel}
              cancellingId={cancelAppointment.isPending ? pendingCancel?.id : null}
            />
          </div>

          {data?.meta ? (
            <p className="text-muted-foreground text-sm">
              Showing {appointments.length} of {data.meta.total}
            </p>
          ) : null}
        </>
      )}

      {/* Booking dialog */}
      <Dialog open={isBookingOpen} onOpenChange={setIsBookingOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm-tablet:max-w-lg">
          <DialogHeader>
            <DialogTitle>Book an appointment</DialogTitle>
            <DialogDescription>Choose a doctor, a day and a time.</DialogDescription>
          </DialogHeader>

          <BookingForm onBooked={() => setIsBookingOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation — a destructive action always asks first. */}
      <Dialog
        open={Boolean(pendingCancel)}
        onOpenChange={(open) => !open && setPendingCancel(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this appointment?</DialogTitle>
            <DialogDescription>
              {pendingCancel
                ? `${pendingCancel.providerName} on ${formatDateTime(pendingCancel.startsAt)}. The slot will be released for someone else.`
                : null}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingCancel(null)}
              disabled={cancelAppointment.isPending}
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={confirmCancel}
              disabled={cancelAppointment.isPending}
            >
              {cancelAppointment.isPending ? 'Cancelling' : 'Yes, cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AppointmentsPage;
