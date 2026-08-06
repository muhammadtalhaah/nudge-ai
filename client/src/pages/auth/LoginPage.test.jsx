/**
 * Login form behaviour.
 *
 * Covers the two things the browser smoke test cannot assert cheaply: that validation
 * messages come from the *shared* schema, and that a server error lands on the right field.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LoginPage from './LoginPage';
import { renderWithProviders } from '@/test/renderWithProviders';

const mockLogin = vi.fn();

// The page reads login() from AuthContext; stubbing the hook keeps this a form test rather
// than an auth-plumbing test (which the server suite already covers).
vi.mock('@/context/AuthContext', async () => {
  const actual = await vi.importActual('@/context/AuthContext');
  return {
    ...actual,
    useAuth: () => ({ login: mockLogin, isAuthenticated: false, isBootstrapping: false }),
  };
});

beforeEach(() => {
  mockLogin.mockReset();
});

describe('LoginPage', () => {
  it('renders the page title as a real heading', async () => {
    renderWithProviders(<LoginPage />, { withAuth: false });
    // A real h1, not a styled div — shadcn's CardTitle renders a div, so this is asserted.
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });

  it('starts with the submit button disabled', () => {
    renderWithProviders(<LoginPage />, { withAuth: false });
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('shows an inline error as soon as the email is invalid', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { withAuth: false });

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'whatever');

    // The message text comes from shared/schemas.ts, so this asserts the shared schema is
    // genuinely the one driving client validation.
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('clears the error once the value becomes valid', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { withAuth: false });

    const email = screen.getByLabelText('Email');
    await user.type(email, 'nope');
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();

    await user.clear(email);
    await user.type(email, 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');

    await waitFor(() => {
      expect(screen.queryByText('Enter a valid email address')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('marks invalid inputs with aria-invalid', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { withAuth: false });

    await user.type(screen.getByLabelText('Email'), 'nope');
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('submits the normalised values', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({ ok: true, data: { user: { fullName: 'Ada Lovelace' } } });

    renderWithProviders(<LoginPage />, { withAuth: false });

    await user.type(screen.getByLabelText('Email'), '  ADA@Example.com ');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));
    // Trimmed and lower-cased by the shared schema before it ever reaches the API.
    expect(mockLogin).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'correct horse battery',
    });
  });

  it('shows a form-level message when credentials are rejected', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({
      ok: false,
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
        details: null,
      },
    });

    renderWithProviders(<LoginPage />, { withAuth: false });

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email or password is incorrect')).toBeInTheDocument();
  });

  it('maps a server field error onto the field it belongs to', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request contains invalid data',
        details: [{ path: 'password', message: 'That password is not accepted' }],
      },
    });

    renderWithProviders(<LoginPage />, { withAuth: false });

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Attached to the field, not dumped into a banner.
    expect(await screen.findByText('That password is not accepted')).toBeInTheDocument();
    expect(screen.queryByText('The request contains invalid data')).not.toBeInTheDocument();
  });
});
