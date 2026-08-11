/**
 * Appointment data hooks.
 *
 * All server state goes through TanStack Query; components never call the API directly. The
 * invalidation in each mutation is what keeps every view consistent after an action — a
 * booking made in the chat updates the appointments list without either knowing about the other.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import appointmentsApi from '@/api/appointments';
import { queryKeys } from '@/config/queryKeys';

/** Throw on failure so Query's isError path handles it; components render ErrorState. */
const unwrap = (result) => {
  if (!result.ok) {
    const error = new Error(result.error.message);
    error.code = result.error.code;
    error.status = result.status;
    error.details = result.error.details;
    throw error;
  }
  return result;
};

export const useProviders = (specialty) =>
  useQuery({
    queryKey: queryKeys.providers.list({ specialty: specialty ?? null }),
    queryFn: async () => {
      const result = unwrap(
        await appointmentsApi.listProviders(specialty ? { specialty } : undefined),
      );
      return result.data.providers;
    },
    // The provider list barely changes; no need to refetch it on every mount.
    staleTime: 5 * 60 * 1000,
  });

export const useAppointments = ({ scope = 'all', status, page = 1, limit = 20 } = {}) =>
  useQuery({
    queryKey: queryKeys.appointments.list({ scope, status: status ?? null, page, limit }),
    queryFn: async () => {
      const params = { scope, page, limit };
      if (status) params.status = status;
      const result = unwrap(await appointmentsApi.listAppointments(params));
      return { items: result.data, meta: result.meta };
    },
    // Keeps the previous page visible while the next loads, instead of flashing empty.
    placeholderData: (previous) => previous,
  });

export const useAvailability = (providerId, date) =>
  useQuery({
    queryKey: queryKeys.appointments.availability(providerId, date),
    queryFn: async () => {
      const result = unwrap(await appointmentsApi.getAvailability({ providerId, date }));
      return result.data.slots;
    },
    // Only ask once both halves of the question are known.
    enabled: Boolean(providerId && date),
    // Availability goes stale the moment someone else books, so always refetch on mount.
    staleTime: 0,
  });

export const useCreateAppointment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    /**
     * Resolves with `{ appointment, chatMessage }`. `chatMessage` is the confirmation turn the
     * server recorded when the booking carried a `chatSessionId`, and null otherwise — the chat
     * appends it to the thread, and the standalone form ignores it.
     */
    mutationFn: async (payload) => {
      const result = unwrap(await appointmentsApi.createAppointment(payload));
      return { appointment: result.data.appointment, chatMessage: result.data.chatMessage ?? null };
    },
    /**
     * Deliberately not optimistic. A booking can be refused by the database (the slot was
     * taken a moment ago), and showing a confirmed appointment that then vanishes is worse
     * than a brief spinner — especially for something a person will plan their day around.
     */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
    },
  });
};

export const useCancelAppointment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }) => {
      const result = unwrap(await appointmentsApi.cancelAppointment(id, reason ? { reason } : {}));
      return result.data.appointment;
    },
    onSuccess: () => {
      // Invalidates lists and availability alike: a cancellation frees the slot for others.
      void queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
    },
  });
};

export default {
  useProviders,
  useAppointments,
  useAvailability,
  useCreateAppointment,
  useCancelAppointment,
};
