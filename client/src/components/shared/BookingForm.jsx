/**
 * The structured booking form.
 *
 * This is the brief's required fallback path: when the assistant cannot extract a complete,
 * unambiguous booking, it hands over whatever it *did* understand and this form is rendered
 * prefilled. The user finishes in a click or two rather than retyping.
 *
 * The same component is the standalone booking form on the appointments page, so the two
 * routes into a booking share one implementation and one validation schema.
 */

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { CalendarPlus } from 'lucide-react';
import { toast } from 'sonner';

import { createBookingFormSchema } from '@shared/schemas.js';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useAvailability, useCreateAppointment, useProviders } from '@/hooks/useAppointments';
import { cn } from '@/lib/utils';
import { useClinicTimezone } from '@/context/AuthContext';
import {
  formatClockValue,
  formatTime,
  toIsoInstant,
  todayIsoDate,
  zoneLabel,
} from '@/utils/formatDate';
import { applyServerErrors } from '@/utils/serverErrors';

const FIELD_NAMES = ['providerId', 'date', 'time', 'notes'];

/**
 * @param prefill       values extracted by the assistant, if any
 * @param highlight     field names the assistant said were missing, so they can be marked
 * @param onBooked      called with the created appointment and, when this form belongs to a
 *                      conversation, the confirmation turn the server recorded in it
 * @param chatSessionId the conversation this form is rendered in, so a booking made here is
 *                      recorded as part of it. Absent on the standalone appointments page.
 * @param compact       denser layout for rendering inside a chat bubble
 */
const BookingForm = ({ prefill, highlight = [], onBooked, chatSessionId, compact = false }) => {
  const {
    data: providers,
    isPending: isLoadingProviders,
    isError: providersFailed,
  } = useProviders();
  const createAppointment = useCreateAppointment();
  const [formError, setFormError] = useState(null);

  /**
   * Every time this form shows or accepts is the clinic's, not the reader's.
   *
   * That single choice has to hold across three places or the form books the wrong instant: the
   * labels on the slot buttons, the "today" the date input floors itself at, and the zone the
   * chosen date and time are finally composed in. They are all fed from here.
   */
  const clinicTimezone = useClinicTimezone();

  /**
   * Rebuilt when the zone arrives, because both of its past-date rules are judged in that zone:
   * whether the chosen day has gone by, and whether the chosen time has gone by today.
   */
  const schema = useMemo(() => createBookingFormSchema(clinicTimezone), [clinicTimezone]);

  const {
    control,
    register,
    handleSubmit,
    setError,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    mode: 'onChange',
    reValidateMode: 'onChange',
    defaultValues: {
      providerId: prefill?.providerId ?? '',
      date: prefill?.date ?? '',
      time: prefill?.time ?? '',
      notes: prefill?.notes ?? '',
    },
  });

  // The assistant may refine its extraction across turns, so a new prefill must reach the
  // form. Keyed on the values themselves rather than object identity, which changes per render.
  const prefillKey = `${prefill?.providerId ?? ''}|${prefill?.date ?? ''}|${prefill?.time ?? ''}|${prefill?.notes ?? ''}`;
  useEffect(() => {
    reset({
      providerId: prefill?.providerId ?? '',
      date: prefill?.date ?? '',
      time: prefill?.time ?? '',
      notes: prefill?.notes ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefillKey is the stable identity
  }, [prefillKey, reset]);

  const selectedProviderId = watch('providerId');
  const selectedDate = watch('date');

  const { data: slots, isPending: isLoadingSlots } = useAvailability(
    selectedProviderId,
    selectedDate,
  );

  const selectedProvider = useMemo(
    () => providers?.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );

  const onSubmit = async (values) => {
    setFormError(null);

    const startsAt = toIsoInstant(values.date, values.time, clinicTimezone);
    if (!startsAt) {
      setError('date', { type: 'manual', message: 'That date and time could not be read' });
      return;
    }

    const result = await createAppointment
      .mutateAsync({
        providerId: values.providerId,
        startsAt,
        notes: values.notes?.trim() || undefined,
        // Only when this form belongs to a conversation. The server authorises the id and
        // records the confirmation turn it returns below.
        ...(chatSessionId ? { chatSessionId } : {}),
      })
      .then(
        (created) => ({ ok: true, ...created }),
        (error) => ({ ok: false, error }),
      );

    if (!result.ok) {
      const message = applyServerErrors(result.error, setError, FIELD_NAMES);
      // A taken slot is about the time, so point at the field the user must change.
      if (result.error.code === 'SLOT_UNAVAILABLE') {
        setError('time', { type: 'server', message: result.error.message });
      } else if (result.error.code === 'SLOT_IN_PAST') {
        // The clinic's clock is the authority on this, and it can disagree with the browser's
        // by a timezone. Reported on the date, which is the field the rule is about.
        setError('date', { type: 'server', message: result.error.message });
      } else if (message) {
        setFormError(message);
      }
      return;
    }

    toast.success(`Booked with ${selectedProvider?.fullName ?? 'your provider'}`);
    reset({ providerId: '', date: '', time: '', notes: '' });
    onBooked?.(result.appointment, result.chatMessage ?? null);
  };

  if (providersFailed) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load the list of providers. Please reload the page.
        </AlertDescription>
      </Alert>
    );
  }

  const isHighlighted = (field) => highlight.includes(field);

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className={cn('space-y-4', compact && 'space-y-3')}
    >
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Field data-invalid={Boolean(errors.providerId)}>
        {/* "Provider" throughout — the label, the placeholder, and the message in
            `createBookingFormSchema`. Labelling it Doctor while the validation asked for a provider
            read as an error about a field that was not on screen. */}
        <FieldLabel htmlFor="providerId">
          Provider
          {isHighlighted('providerName') || isHighlighted('specialty') ? (
            <span className="text-muted-foreground ml-1 text-xs font-normal">· still needed</span>
          ) : null}
        </FieldLabel>

        {isLoadingProviders ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Controller
            control={control}
            name="providerId"
            render={({ field }) => (
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <SelectTrigger
                  id="providerId"
                  aria-invalid={Boolean(errors.providerId)}
                  className="w-full"
                >
                  <SelectValue placeholder="Choose a provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers?.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.fullName} · {provider.specialty}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
        {errors.providerId ? <FieldError>{errors.providerId.message}</FieldError> : null}
      </Field>

      <div className={cn('grid gap-4', !compact && 'sm-tablet:grid-cols-2')}>
        <Field data-invalid={Boolean(errors.date)}>
          <FieldLabel htmlFor="date">
            Date
            {isHighlighted('date') ? (
              <span className="text-muted-foreground ml-1 text-xs font-normal">· still needed</span>
            ) : null}
          </FieldLabel>
          <Input
            id="date"
            type="date"
            /*
             * Greys out every earlier day in the native picker, so a past date cannot be
             * *selected* at all. It is not the whole guard: `min` does not constrain a typed
             * date, and this form is `noValidate`, so the browser will not block submit either
             * — `createBookingFormSchema` refuses a past date, and `appointmentService.book` refuses a
             * past instant behind it. Recomputed each render rather than memoised, so a tab left
             * open overnight does not still offer yesterday.
             */
            min={todayIsoDate(clinicTimezone)}
            aria-invalid={Boolean(errors.date)}
            {...register('date')}
          />
          {errors.date ? <FieldError>{errors.date.message}</FieldError> : null}
        </Field>

        <Field data-invalid={Boolean(errors.time)}>
          <FieldLabel htmlFor="time">
            Time
            {isHighlighted('time') ? (
              <span className="text-muted-foreground ml-1 text-xs font-normal">· still needed</span>
            ) : null}
          </FieldLabel>
          <Input
            id="time"
            type="time"
            step="900"
            aria-invalid={Boolean(errors.time)}
            {...register('time')}
          />
          {errors.time ? <FieldError>{errors.time.message}</FieldError> : null}
        </Field>
      </div>

      {/* Free slots for the chosen doctor and day, so the user is not guessing. */}
      {selectedProviderId && selectedDate ? (
        <Field>
          <FieldLabel>
            Available times
            {clinicTimezone ? (
              <span className="text-muted-foreground ml-1 text-xs font-normal">
                · clinic time ({zoneLabel(clinicTimezone)})
              </span>
            ) : null}
          </FieldLabel>
          {isLoadingSlots ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 6 }).map((_unused, index) => (
                <Skeleton key={index} className="h-8 w-16" />
              ))}
            </div>
          ) : slots?.length ? (
            <Controller
              control={control}
              name="time"
              render={({ field }) => (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Available times">
                  {slots.slice(0, 16).map((slot) => {
                    /*
                     * Two renderings of the same instant, and they are not interchangeable.
                     *
                     * `value` is canonical 24-hour HH:MM — it is what goes into the `time` input
                     * and what gets composed into the booking, so it must be the one shape both
                     * `clockTimeSchema` and `<input type="time">` accept. A locale-formatted
                     * string was being used for this, which in a 12-hour locale meant clicking a
                     * slot wrote "02:00 PM" into a field that only reads "14:00".
                     *
                     * `label` is what the button says, in the reader's own conventions.
                     */
                    const value = formatClockValue(slot, clinicTimezone);
                    const label = formatTime(slot, clinicTimezone);
                    const isSelected = field.value === value;
                    return (
                      <Button
                        key={slot}
                        type="button"
                        size="sm"
                        variant={isSelected ? 'default' : 'outline'}
                        aria-pressed={isSelected}
                        onClick={() => field.onChange(value)}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
              )}
            />
          ) : (
            <FieldDescription>No free times for that day. Try another date.</FieldDescription>
          )}
        </Field>
      ) : null}

      <Field data-invalid={Boolean(errors.notes)}>
        <FieldLabel htmlFor="notes">Reason for visit (optional)</FieldLabel>
        <Textarea
          id="notes"
          rows={compact ? 2 : 3}
          placeholder="Briefly, what is this about?"
          aria-invalid={Boolean(errors.notes)}
          {...register('notes')}
        />
        {errors.notes ? <FieldError>{errors.notes.message}</FieldError> : null}
      </Field>

      <Button
        type="submit"
        disabled={isSubmitting}
        className={cn('text-white', compact && 'w-full')}
      >
        {isSubmitting ? (
          <Spinner role={undefined} aria-label={undefined} aria-hidden="true" />
        ) : (
          <CalendarPlus className="size-4" aria-hidden="true" />
        )}
        {isSubmitting ? 'Booking' : 'Confirm booking'}
      </Button>
    </form>
  );
};

export default BookingForm;
