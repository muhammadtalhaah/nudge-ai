/**
 * Route guard behaviour.
 *
 * The case worth protecting is the bootstrap gate: on a reload there is no access token in
 * memory yet, only an httpOnly cookie the page cannot read. If the guard decided before the
 * silent refresh resolved, every refresh would bounce a signed-in user to /login.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import RequireAuth from './RequireAuth';

const authState = { isAuthenticated: false, isBootstrapping: false };

vi.mock('@/context/AuthContext', async () => {
  const actual = await vi.importActual('@/context/AuthContext');
  return { ...actual, useAuth: () => authState };
});

const renderGuard = () =>
  render(
    <MemoryRouter initialEntries={['/chat']}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/chat" element={<p>Protected content</p>} />
        </Route>
        <Route path="/login" element={<p>Login screen</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('RequireAuth', () => {
  it('shows a loading state while the session is still being restored', () => {
    authState.isAuthenticated = false;
    authState.isBootstrapping = true;

    renderGuard();

    // Critically: not the login screen. Redirecting here would log out anyone who refreshes.
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('redirects to login once bootstrapping finds no session', () => {
    authState.isAuthenticated = false;
    authState.isBootstrapping = false;

    renderGuard();

    expect(screen.getByText('Login screen')).toBeInTheDocument();
  });

  it('renders the protected content for an authenticated user', () => {
    authState.isAuthenticated = true;
    authState.isBootstrapping = false;

    renderGuard();

    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });
});
