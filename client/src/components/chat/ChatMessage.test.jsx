/**
 * One turn of conversation, and the structured parts an assistant turn can carry.
 *
 * The behaviour worth protecting is what happens to a booking form once its booking has been
 * made. The form used to stay live: nothing closed it, so the thread ended on the question it
 * was answering and a second click booked the same appointment again. It is retired from the
 * transcript rather than from local state, so a reload shows the same thing.
 */

import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatMessage from './ChatMessage';
import { renderWithProviders } from '@/test/renderWithProviders';
import { formatDateTime } from '@/utils/formatDate';

const listProviders = vi.fn();
const getAvailability = vi.fn();

vi.mock('@/api/appointments', () => ({
  default: {
    listProviders: (...args) => listProviders(...args),
    getAvailability: (...args) => getAvailability(...args),
    createAppointment: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PROVIDER = {
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Dr. Samuel Okafor',
  specialty: 'Dermatology',
  slotDurationMinutes: 30,
};

/** An assistant turn carrying the prefilled fallback form. */
const formFallbackTurn = {
  id: 'assistant-1',
  role: 'assistant',
  content: 'Which day would you like to see Dr. Samuel Okafor?',
  createdAt: '',
  reply: {
    kind: 'form_fallback',
    text: 'Which day would you like to see Dr. Samuel Okafor?',
    prefill: { providerId: PROVIDER.id },
    missing: ['date'],
    providers: [PROVIDER],
  },
};

const bookedTurn = {
  id: 'assistant-2',
  role: 'assistant',
  content: 'Booked with Dr. Samuel Okafor.',
  createdAt: '',
  reply: {
    kind: 'appointment_created',
    text: 'Booked with Dr. Samuel Okafor.',
    appointment: {
      id: 'appointment-1',
      providerName: 'Dr. Samuel Okafor',
      providerSpecialty: 'Dermatology',
      // A fixed instant, so the assertion does not depend on when the suite runs.
      startsAt: '2030-06-12T09:30:00.000Z',
      endsAt: '2030-06-12T10:00:00.000Z',
      status: 'CONFIRMED',
    },
  },
};

const renderTurn = (props) => renderWithProviders(<ChatMessage {...props} />, { withAuth: false });

beforeEach(() => {
  listProviders.mockResolvedValue({ ok: true, data: { providers: [PROVIDER] } });
  getAvailability.mockResolvedValue({ ok: true, data: { slots: [] } });
});

describe('the fallback booking form', () => {
  it('is offered while the booking is still outstanding', async () => {
    renderTurn({ message: formFallbackTurn, isBookingResolved: false });

    expect(screen.getByText('Finish the details')).toBeInTheDocument();
    expect(await screen.findByLabelText(/^provider/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm booking/i })).toBeInTheDocument();
  });

  it('is retired once a later turn is a completed booking', () => {
    renderTurn({ message: formFallbackTurn, isBookingResolved: true });

    expect(screen.queryByText('Finish the details')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm booking/i })).not.toBeInTheDocument();

    // The assistant's question stays: it is what was actually said, and the confirmation turn
    // below it is the answer.
    expect(
      screen.getByText('Which day would you like to see Dr. Samuel Okafor?'),
    ).toBeInTheDocument();
  });
});

describe('the booking confirmation', () => {
  it('names the provider, the specialty, the status and a time in local terms', () => {
    renderTurn({ message: bookedTurn, isBookingResolved: false });

    expect(screen.getByText('Booked with Dr. Samuel Okafor.')).toBeInTheDocument();
    expect(screen.getByText('Dr. Samuel Okafor')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();

    /*
     * The time is asserted through the app's own formatter rather than as a literal. That is
     * the claim being made: the confirmation shows the instant rendered in the *viewer's*
     * timezone and locale. A hardcoded string would only be asserting where the suite runs —
     * and the server, which knows the clinic's timezone and not the viewer's, deliberately
     * names no time in the prose above.
     */
    const startsAt = bookedTurn.reply.appointment.startsAt;
    expect(screen.getByText(`${formatDateTime(startsAt)} · Dermatology`)).toBeInTheDocument();
  });
});
