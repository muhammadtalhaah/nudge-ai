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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    expect(screen.getByRole('link', { name: 'Appointments' })).toBeInTheDocument();

    // The assistant has no nav link of its own: "New Chat" starts one and the history rows
    // open one, so a third route to the same screen only ever sat permanently selected.
    expect(screen.queryByRole('link', { name: 'Assistant' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New Chat/ })).toBeInTheDocument();
  });

  it('still reaches the assistant from the brand link', async () => {
    renderSidebar('/appointments');

    expect(screen.getByRole('link', { name: /Nudge AI/ })).toHaveAttribute('href', '/chat');
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

  it('marks nothing current when the URL names no conversation', async () => {
    renderSidebar('/chat');

    // A chat page with no `?session=` is a blank thread, not the newest conversation — so
    // highlighting a row here would point at one nobody is in.
    const newest = await screen.findByRole('link', { name: /Itchy rash on my arm/ });
    expect(newest).not.toHaveAttribute('aria-current');
  });

  it('does not mark any conversation current when away from the chat page', async () => {
    renderSidebar('/appointments');

    const newest = await screen.findByRole('link', { name: /Itchy rash on my arm/ });
    expect(newest).not.toHaveAttribute('aria-current');
  });

  it('opens a blank chat without creating a conversation', async () => {
    const user = userEvent.setup();

    renderSidebar('/chat?session=session-older');
    await user.click(screen.getByRole('button', { name: /New Chat/ }));

    // Navigation only: no `?session=`, so the chat page opens an empty thread. The record is
    // written when there is a first message to put in it.
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/chat');
    });
    expect(screen.getByTestId('location')).not.toHaveTextContent('session=');
    expect(createSession).not.toHaveBeenCalled();
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

    // Scoped to the link rather than queried as bare text: an untitled row and the button that
    // creates one are easy to confuse, and a text query could pass on the wrong element.
    const link = await screen.findByRole('link', { name: /New conversation/ });
    expect(link).toHaveAttribute('href', '/chat?session=session-newest');
  });
});

/**
 * Growing the list by scrolling to the end of it.
 *
 * jsdom has no layout, so nothing here can scroll for real. What is testable — and what
 * actually breaks — is the wiring: that a page is requested when the sentinel is seen, that
 * the cursor from the previous page is the one sent, and that a list which has ended stops
 * asking. The observer is stubbed and its callback invoked by hand to stand in for the scroll.
 */
describe('loading more conversations on scroll', () => {
  /** The observers the component created, so a test can decide when the sentinel is seen. */
  let observers;

  const page = (sessions, nextCursor = null) => ({
    ok: true,
    data: { sessions, nextCursor },
    meta: null,
  });

  const olderSession = (id) => ({
    id,
    title: `Conversation ${id}`,
    status: 'active',
    messageCount: 2,
    lastMessageAt: new Date(Date.now() - 200_000_000).toISOString(),
    createdAt: new Date(Date.now() - 200_000_000).toISOString(),
  });

  /** Fire every live observer as though its target had scrolled into view. */
  const scrollToEnd = async (target) => {
    for (const observer of observers) {
      observer.callback([{ isIntersecting: true, target }]);
    }
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
  };

  beforeEach(() => {
    observers = [];

    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback) {
          this.callback = callback;
          observers.push(this);
        }
        observe() {}
        unobserve() {}
        disconnect() {
          observers = observers.filter((entry) => entry !== this);
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the next page with the cursor the last one returned', async () => {
    listSessions
      .mockResolvedValueOnce(page(SESSIONS, 'cursor-from-page-one'))
      .mockResolvedValueOnce(page([olderSession('session-oldest')]));

    renderSidebar();
    await screen.findByText('Itchy rash on my arm');

    // The first request asks for the top of the list, with no cursor.
    expect(listSessions).toHaveBeenCalledWith({ cursor: undefined, limit: 20 });

    await scrollToEnd(document.body);

    expect(listSessions).toHaveBeenLastCalledWith({ cursor: 'cursor-from-page-one', limit: 20 });
  });

  it('appends the next page rather than replacing what is shown', async () => {
    listSessions
      .mockResolvedValueOnce(page(SESSIONS, 'cursor-from-page-one'))
      .mockResolvedValueOnce(page([olderSession('session-oldest')]));

    renderSidebar();
    await screen.findByText('Itchy rash on my arm');

    await scrollToEnd(document.body);

    expect(await screen.findByText('Conversation session-oldest')).toBeInTheDocument();
    // Still there — an infinite list grows, it does not page over itself.
    expect(screen.getByText('Itchy rash on my arm')).toBeInTheDocument();
    expect(screen.getByText('Cardiology follow-up')).toBeInTheDocument();
  });

  it('asks for nothing more once the server says the list has ended', async () => {
    listSessions.mockResolvedValue(page(SESSIONS, null));

    renderSidebar();
    await screen.findByText('Itchy rash on my arm');

    // No cursor means no sentinel to observe, so reaching the bottom triggers nothing.
    expect(observers).toHaveLength(0);
    expect(listSessions).toHaveBeenCalledTimes(1);
  });
});
