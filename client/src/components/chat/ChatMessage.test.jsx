/**
 * One turn of conversation, and the structured parts an assistant turn can carry.
 *
 * The behaviour worth protecting is what happens to a booking form once its booking has been
 * made. The form used to stay live: nothing closed it, so the thread ended on the question it
 * was answering and a second click booked the same appointment again. It is retired from the
 * transcript rather than from local state, so a reload shows the same thing.
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatMessage from './ChatMessage';
import { renderWithProviders } from '@/test/renderWithProviders';
import { formatDateTime, formatTime } from '@/utils/formatDate';

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

const SECOND_PROVIDER = {
  id: '22222222-2222-4222-8222-222222222222',
  fullName: 'Dr. Amara Chen',
  specialty: 'Dermatology',
  slotDurationMinutes: 30,
};

/**
 * An assistant turn that is still gathering, asked as a question.
 *
 * This is the shape the reported bug produced: somebody asked for a doctor's availability, and
 * the reply arrived as a booking form with a Confirm booking button.
 */
const needsDetailTurn = {
  id: 'assistant-0',
  role: 'assistant',
  content: 'Which day would you like to see Dr. Samuel Okafor?',
  createdAt: '',
  reply: {
    kind: 'needs_detail',
    text: 'Which day would you like to see Dr. Samuel Okafor?',
    prefill: { providerId: PROVIDER.id },
    missing: ['date'],
    providers: [PROVIDER],
  },
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

describe('a turn that is still gathering details', () => {
  it('asks the question without opening a booking form', () => {
    renderTurn({ message: needsDetailTurn, isBookingResolved: false });

    expect(screen.getByText('Which day would you like to see Dr. Samuel Okafor?')).toBeVisible();

    /*
     * The bug, stated as an assertion. A form with a Confirm booking button under "which day
     * would you like?" answers a question nobody asked and turns the assistant into a wrapper
     * around the form it was meant to replace.
     */
    expect(screen.queryByRole('button', { name: /confirm booking/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Finish the details')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^date/i)).not.toBeInTheDocument();
  });

  it('offers the form to anyone who would rather fill it in', async () => {
    const user = userEvent.setup();
    renderTurn({ message: needsDetailTurn, isBookingResolved: false });

    // Present but closed: someone who prefers four fields to a conversation should not have to
    // talk their way to them.
    await user.click(screen.getByRole('button', { name: /fill in the details instead/i }));

    expect(screen.getByText('Finish the details')).toBeInTheDocument();
    expect(await screen.findByLabelText(/^provider/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm booking/i })).toBeInTheDocument();
  });

  it('shows the candidates when the question is which provider', () => {
    renderTurn({
      message: {
        ...needsDetailTurn,
        reply: {
          ...needsDetailTurn.reply,
          text: 'Several of our doctors match that — which would you prefer?',
          missing: ['providerName'],
          providers: [PROVIDER, SECOND_PROVIDER],
        },
      },
      isBookingResolved: false,
    });

    // The cards answer the question rather than help fill in a field, so they sit outside the
    // closed form.
    expect(screen.getByText('Dr. Samuel Okafor')).toBeInTheDocument();
    expect(screen.getByText('Dr. Amara Chen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm booking/i })).not.toBeInTheDocument();
  });

  it('is retired once a later turn is a completed booking', () => {
    renderTurn({ message: needsDetailTurn, isBookingResolved: true });

    expect(
      screen.queryByRole('button', { name: /fill in the details instead/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Which day would you like to see Dr. Samuel Okafor?')).toBeVisible();
  });
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

/**
 * The reply to "what is free on Tuesday morning?".
 *
 * `slotTimezone` is the clinic's and is carried on the payload, which is what makes these times
 * mean the same thing to every reader. The clinic here keeps its hours in UTC, so 09:00Z is a
 * 09:00 appointment — and a reader in Karachi must still be shown 09:00, not their own 14:00.
 */
const slotListTurn = {
  id: 'assistant-3',
  role: 'assistant',
  content: "Here are Dr. Samuel Okafor's free times on the morning of Tuesday 18 August.",
  createdAt: '',
  reply: {
    kind: 'slot_list',
    text: "Here are Dr. Samuel Okafor's free times on the morning of Tuesday 18 August.",
    slots: ['2026-08-18T09:00:00.000Z', '2026-08-18T09:30:00.000Z', '2026-08-18T10:00:00.000Z'],
    slotDate: '2026-08-18',
    slotTimezone: 'UTC',
    slotWindow: 'morning',
    providers: [PROVIDER],
    prefill: { providerId: PROVIDER.id },
    missing: ['time'],
  },
};

describe('the free-times list', () => {
  /*
   * The reported bug, as an assertion on the prose.
   *
   * "Let me check Dr Samuel Okafor's availability for next Tuesday morning" was narrating an
   * errand while the answer to it was already rendered underneath. The sentence has to present
   * the list, and it has to name the day it resolved "next Tuesday" to — that is what lets someone
   * catch it resolving to the wrong one.
   */
  it('presents the answer instead of announcing a lookup', () => {
    renderTurn({ message: slotListTurn, isBookingResolved: false });

    const text = screen.getByText(/free times/i).textContent;
    expect(text).not.toMatch(/let me check|i(?:'| wi)ll check|checking/i);
    expect(text).toMatch(/Tuesday 18 August/);
    expect(text).toMatch(/Dr\. Samuel Okafor/);
  });

  it('renders the times in the clinic’s zone, and says which one that is', () => {
    renderTurn({ message: slotListTurn, isBookingResolved: false });

    /*
     * Asserted through the app's own formatter rather than as literals, so the suite is not
     * claiming anything about the locale of the machine it runs on. What it does claim is the
     * zone: these are the clinic's 09:00, 09:30 and 10:00, and a reader east of the clinic must
     * not be shown their own afternoon instead.
     */
    for (const slot of slotListTurn.reply.slots) {
      expect(screen.getByText(formatTime(slot, 'UTC'))).toBeInTheDocument();
    }

    // Named, so a reader whose own clock disagrees finds out here and not at the appointment.
    expect(screen.getByText(/clinic time \(UTC\)/i)).toBeInTheDocument();
  });

  /**
   * Proves the zone comes off the payload rather than from the runtime.
   *
   * Without this, a suite that happens to run in the same zone as its fixture passes whether the
   * code reads `slotTimezone` or silently ignores it. Rendering the same instants against a
   * different clinic is what tells those two apart.
   */
  it('reads the zone off the reply, not the machine it renders on', () => {
    const tokyoTurn = {
      ...slotListTurn,
      reply: { ...slotListTurn.reply, slotTimezone: 'Asia/Tokyo' },
    };

    renderTurn({ message: tokyoTurn, isBookingResolved: false });

    for (const slot of tokyoTurn.reply.slots) {
      expect(screen.getByText(formatTime(slot, 'Asia/Tokyo'))).toBeInTheDocument();
      expect(screen.queryByText(formatTime(slot, 'UTC'))).not.toBeInTheDocument();
    }

    expect(screen.getByText(/clinic time \(GMT\+9\)/i)).toBeInTheDocument();
  });
});

describe('the booking confirmation', () => {
  it('names the provider, the specialty, the status and a time in local terms', () => {
    renderTurn({ message: bookedTurn, isBookingResolved: false });

    expect(screen.getByText('Booked with Dr. Samuel Okafor.')).toBeInTheDocument();
    expect(screen.getByText('Dr. Samuel Okafor')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();

    /*
     * The time is asserted through the app's own formatter rather than as a literal, because a
     * hardcoded string would only be asserting where the suite runs.
     *
     * This turn is rendered with no auth context, so there is no clinic zone to be had and the
     * formatter falls back to the viewer's — the documented degradation, asserted here so it stays
     * a fallback rather than becoming the behaviour again. The clinic-zone path is covered by the
     * free-times list above, which carries its zone on the reply itself.
     */
    const startsAt = bookedTurn.reply.appointment.startsAt;
    expect(screen.getByText(`${formatDateTime(startsAt, null)} · Dermatology`)).toBeInTheDocument();
  });
});
