/**
 * The structured booking form — the path a user lands on when the assistant could not complete
 * a booking on its own, and the standalone form on the appointments page.
 *
 * Three rules are worth protecting here, because each one failed in a way that looked like the
 * form working:
 *
 *   A past date must not reach the server. `min` greys the picker out, but the field is still
 *   typeable and the form is `noValidate`, so the only guard that actually holds at submit is
 *   the schema's.
 *
 *   The provider field is labelled and validated with the same word. It used to say Doctor and
 *   fail with "Choose a provider", which reads as an error about a field that is not on screen.
 *
 *   A booking made inside a conversation carries its session id, which is what lets the server
 *   record the confirmation as a turn of that conversation.
 *
 * The provider is supplied through `prefill` rather than by driving the Radix select: that is a
 * real code path (it is how the assistant hands over what it understood) and it keeps these
 * tests about validation rather than about a popover in jsdom.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BookingForm from './BookingForm';
import { renderWithProviders } from '@/test/renderWithProviders';

const listProviders = vi.fn();
const createAppointment = vi.fn();
const getAvailability = vi.fn();

vi.mock('@/api/appointments', () => ({
  default: {
    listProviders: (...args) => listProviders(...args),
    createAppointment: (...args) => createAppointment(...args),
    getAvailability: (...args) => getAvailability(...args),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PROVIDER = {
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Dr. Samuel Okafor',
  specialty: 'Dermatology',
  slotDurationMinutes: 30,
};

/** A local calendar date `offsetDays` from today, formatted the way the input expects. */
const localDate = (offsetDays) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const APPOINTMENT = {
  id: 'appointment-1',
  providerName: PROVIDER.fullName,
  providerSpecialty: PROVIDER.specialty,
  startsAt: new Date().toISOString(),
  status: 'CONFIRMED',
};

const CHAT_MESSAGE = {
  id: 'assistant-confirmation',
  role: 'assistant',
  content: 'Booked with Dr. Samuel Okafor.',
  createdAt: new Date().toISOString(),
  reply: { kind: 'appointment_created', text: 'Booked.', appointment: APPOINTMENT },
};

const renderForm = (props = {}) =>
  renderWithProviders(<BookingForm {...props} />, { withAuth: false });

/** Fill the date and time, then submit. */
const submitWith = async ({ date, time }) => {
  fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: date } });
  fireEvent.change(screen.getByLabelText(/^time/i), { target: { value: time } });
  await userEvent.click(screen.getByRole('button', { name: /confirm booking/i }));
};

beforeEach(() => {
  listProviders.mockResolvedValue({ ok: true, data: { providers: [PROVIDER] } });
  getAvailability.mockResolvedValue({ ok: true, data: { slots: [] } });
  createAppointment.mockResolvedValue({
    ok: true,
    data: { appointment: APPOINTMENT, chatMessage: CHAT_MESSAGE },
  });
});

describe('past dates', () => {
  it('bounds the picker at today, in the browser’s own timezone', async () => {
    renderForm();
    await waitFor(() => expect(screen.getByLabelText(/^provider/i)).toBeInTheDocument());

    expect(screen.getByLabelText(/^date/i)).toHaveAttribute('min', localDate(0));
  });

  it('refuses a past date at submit, where `min` cannot help', async () => {
    const onBooked = vi.fn();
    renderForm({ prefill: { providerId: PROVIDER.id }, onBooked });
    await waitFor(() => expect(screen.getByLabelText(/^provider/i)).toBeInTheDocument());

    await submitWith({ date: localDate(-1), time: '10:00' });

    expect(await screen.findByText(/that date has passed/i)).toBeInTheDocument();
    // The point of the rule: nothing was sent, so the server never had to refuse it.
    expect(createAppointment).not.toHaveBeenCalled();
    expect(onBooked).not.toHaveBeenCalled();
  });

  it('still books today and later', async () => {
    renderForm({ prefill: { providerId: PROVIDER.id } });
    await waitFor(() => expect(screen.getByLabelText(/^provider/i)).toBeInTheDocument());

    await submitWith({ date: localDate(1), time: '10:00' });

    await waitFor(() => expect(createAppointment).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/that date has passed/i)).not.toBeInTheDocument();
  });
});

describe('the provider field', () => {
  it('is labelled Provider, and says so when it is empty', async () => {
    renderForm();
    await waitFor(() => expect(screen.getByLabelText(/^provider/i)).toBeInTheDocument());

    // Label, placeholder and validation message all use the one word.
    expect(screen.getByText('Choose a provider')).toBeInTheDocument();

    await submitWith({ date: localDate(1), time: '10:00' });

    const errors = await screen.findAllByText('Choose a provider');
    // Two now: the select's placeholder, and the error naming the field it belongs to.
    expect(errors.length).toBeGreaterThan(1);
    expect(createAppointment).not.toHaveBeenCalled();
  });
});

describe('a booking made inside a conversation', () => {
  it('sends the session id and hands back the confirmation turn', async () => {
    const onBooked = vi.fn();
    renderForm({ prefill: { providerId: PROVIDER.id }, chatSessionId: 'session-7', onBooked });
    await waitFor(() => expect(screen.getByLabelText(/^provider/i)).toBeInTheDocument());

    await submitWith({ date: localDate(1), time: '10:00' });

    await waitFor(() => expect(onBooked).toHaveBeenCalledTimes(1));
    expect(createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: PROVIDER.id, chatSessionId: 'session-7' }),
    );
    // The chat needs both: the appointment, and the persisted turn to append to the thread.
    expect(onBooked).toHaveBeenCalledWith(APPOINTMENT, CHAT_MESSAGE);
  });

  it('sends no session id from the standalone form', async () => {
    const onBooked = vi.fn();
    createAppointment.mockResolvedValue({
      ok: true,
      data: { appointment: APPOINTMENT, chatMessage: null },
    });

    renderForm({ prefill: { providerId: PROVIDER.id }, onBooked });
    await waitFor(() => expect(screen.getByLabelText(/^provider/i)).toBeInTheDocument());

    await submitWith({ date: localDate(1), time: '10:00' });

    await waitFor(() => expect(onBooked).toHaveBeenCalledTimes(1));
    expect(createAppointment.mock.calls[0][0]).not.toHaveProperty('chatSessionId');
    expect(onBooked).toHaveBeenCalledWith(APPOINTMENT, null);
  });
});
