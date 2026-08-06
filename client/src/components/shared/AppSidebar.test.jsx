/**
 * Sidebar navigation and the recent-conversations list.
 *
 * The behaviour worth protecting is that a conversation is selected *by URL* — that is what
 * lets the sidebar switch threads without reaching into the chat page's state, and what makes
 * a reload or a shared link reopen the same one.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppSidebar from './AppSidebar';
import { LayoutProvider } from '@/context/LayoutContext';

const listSessions = vi.fn();
const createSession = vi.fn();

vi.mock('@/api/chat', () => ({
  default: {
    listSessions: (...args) => listSessions(...args),
    createSession: (...args) => createSession(...args),
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

const SESSIONS = [
  {
    id: 'session-newest',
    title: 'Itchy rash on my arm',
    status: 'active',
    messageCount: 4,
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
  {
    id: 'session-older',
    title: 'Cardiology follow-up',
    status: 'active',
    messageCount: 2,
    lastMessageAt: new Date(Date.now() - 7_200_000).toISOString(),
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
  },
];

/** Shows the current location so navigation can be asserted. */
const LocationProbe = () => {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
};

const renderSidebar = (route = '/chat') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <LayoutProvider>
          <AppSidebar />
          <LocationProbe />
          <Routes>
            <Route path="/chat" element={null} />
            <Route path="/appointments" element={null} />
          </Routes>
        </LayoutProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  listSessions.mockReset();
  createSession.mockReset();
  listSessions.mockResolvedValue({ ok: true, data: { sessions: SESSIONS }, meta: null });
});

describe('AppSidebar', () => {
  it('renders the primary navigation', async () => {
    renderSidebar();

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Assistant' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Appointments' })).toBeInTheDocument();
  });

  it('shows a loading state before the conversations arrive', () => {
    renderSidebar();
    expect(screen.getByText('Loading conversations')).toBeInTheDocument();
  });

  it('lists the recent conversations by title', async () => {
    renderSidebar();

    expect(await screen.findByText('Itchy rash on my arm')).toBeInTheDocument();
    expect(screen.getByText('Cardiology follow-up')).toBeInTheDocument();
  });

  it('links each conversation to its own URL', async () => {
    renderSidebar();

    const link = await screen.findByRole('link', { name: /Itchy rash on my arm/ });
    expect(link).toHaveAttribute('href', '/chat?session=session-newest');
  });

  it('marks the conversation named in the URL as current', async () => {
    renderSidebar('/chat?session=session-older');

    const older = await screen.findByRole('link', { name: /Cardiology follow-up/ });
    expect(older).toHaveAttribute('aria-current', 'page');

    const newest = screen.getByRole('link', { name: /Itchy rash on my arm/ });
    expect(newest).not.toHaveAttribute('aria-current');
  });

  it('marks the newest as current when the URL names none, since that is what opens', async () => {
    renderSidebar('/chat');

    const newest = await screen.findByRole('link', { name: /Itchy rash on my arm/ });
    expect(newest).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark any conversation current when away from the chat page', async () => {
    renderSidebar('/appointments');

    const newest = await screen.findByRole('link', { name: /Itchy rash on my arm/ });
    expect(newest).not.toHaveAttribute('aria-current');
  });

  it('creates a conversation and navigates to it', async () => {
    const user = userEvent.setup();
    createSession.mockResolvedValue({
      ok: true,
      data: { session: { id: 'session-brand-new', title: null } },
      meta: null,
    });

    renderSidebar();
    await user.click(screen.getByRole('button', { name: /New conversation/ }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/chat?session=session-brand-new');
    });
  });

  it('shows an empty state when there are no conversations', async () => {
    listSessions.mockResolvedValue({ ok: true, data: { sessions: [] }, meta: null });
    renderSidebar();

    expect(await screen.findByText(/No conversations yet/)).toBeInTheDocument();
  });

  it('reports a failure to load rather than rendering nothing', async () => {
    listSessions.mockResolvedValue({
      ok: false,
      status: 500,
      error: { code: 'INTERNAL_ERROR', message: 'boom', details: null },
    });
    renderSidebar();

    expect(await screen.findByText('Could not load conversations.')).toBeInTheDocument();
  });

  it('falls back to a placeholder title for an untitled conversation', async () => {
    listSessions.mockResolvedValue({
      ok: true,
      data: { sessions: [{ ...SESSIONS[0], title: null, lastMessageAt: null }] },
      meta: null,
    });
    renderSidebar();

    // Scoped to the link: "New conversation" is also the button's label, so a bare text query
    // would be ambiguous and could pass while asserting the wrong element.
    const link = await screen.findByRole('link', { name: /New conversation/ });
    expect(link).toHaveAttribute('href', '/chat?session=session-newest');
  });
});
