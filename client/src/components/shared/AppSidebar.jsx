/**
 * Sidebar contents: primary navigation and the recent-conversations list.
 *
 * Presentational apart from the two data hooks it calls. The desktop and mobile shells in
 * AppLayout both render this same component, so there is one implementation of the navigation
 * rather than a duplicated mobile copy that drifts.
 */

import { useMemo } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, MessageSquare, Plus } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/config/constants';
import { useChatSessions, useCreateChatSession } from '@/hooks/useChatSessions';
import { useLayout } from '@/context/LayoutContext';
import { cn } from '@/lib/utils';
import { recencyBucket } from '@/utils/formatDate';

const NAV_ITEMS = [
  { to: ROUTES.CHAT, label: 'Assistant', icon: MessageSquare },
  { to: ROUTES.APPOINTMENTS, label: 'Appointments', icon: CalendarDays },
];

/** How many conversations the list shows before it stops. */
const VISIBLE_SESSIONS = 12;

/**
 * Recency headings, in order.
 *
 * Conversation titles are derived from the opening message, so a list of them repeats heavily
 * — six threads that all read "I have an itchy rash on my…" are indistinguishable, and a
 * per-row timestamp on each does not help because reading twelve of them is the work being
 * avoided. Dating the *group* instead gives one piece of temporal information per few rows,
 * which is the convention every chat history has converged on for exactly this reason.
 */
const GROUPS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Previous 7 days' },
  { key: 'older', label: 'Older' },
];

const AppSidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { closeSidebar } = useLayout();

  const activeSessionId = searchParams.get('session');
  const isOnChat = location.pathname === ROUTES.CHAT;

  const { data: sessions, isPending, isError } = useChatSessions();
  const createSession = useCreateChatSession();

  /**
   * The visible slice, bucketed by recency. Empty buckets are dropped so a heading never
   * appears without rows under it.
   */
  const grouped = useMemo(() => {
    const visible = (sessions ?? []).slice(0, VISIBLE_SESSIONS);

    return GROUPS.map(({ key, label }) => ({
      key,
      label,
      items: visible.filter(
        (session) => recencyBucket(session.lastMessageAt ?? session.createdAt) === key,
      ),
    })).filter((group) => group.items.length > 0);
  }, [sessions]);

  /**
   * Starting a conversation from the sidebar navigates to it by URL rather than reaching into
   * the chat page's state — the page reads `?session=` and opens whatever it names, so the two
   * stay decoupled.
   */
  const handleNewConversation = async () => {
    try {
      const session = await createSession.mutateAsync();
      navigate(`${ROUTES.CHAT}?session=${session.id}`);
      closeSidebar();
    } catch {
      // The mutation's own error state drives the button label; nothing else to do here.
    }
  };

  return (
    // The surface is set here rather than only on the desktop <aside>, so the sticky group
    // headings below have the same colour to sit on inside the mobile drawer too.
    <div className="bg-sidebar flex h-full min-h-0 flex-col">
      {/* Brand. Hidden on mobile, where the header already shows it above the drawer. */}
      <div className="hidden h-14 shrink-0 items-center px-4 lg-tablet:flex">
        <Link to={ROUTES.CHAT} className="flex items-center gap-2 font-semibold">
          <MessageSquare className="text-primary size-5" aria-hidden="true" />
          Nudge AI
        </Link>
      </div>

      <div className="px-3 pt-2 pb-3">
        <Button
          className="w-full justify-start"
          onClick={handleNewConversation}
          disabled={createSession.isPending}
        >
          <Plus className="size-4" aria-hidden="true" />
          {createSession.isPending ? 'Starting…' : 'New conversation'}
        </Button>
      </div>

      {/* Navigation links are Buttons in all but name, so they take their sizing, focus ring
          and hover treatment from buttonVariants rather than restating it here. */}
      <nav aria-label="Main" className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            onClick={closeSidebar}
            className={({ isActive }) =>
              cn(
                buttonVariants({ variant: isActive ? 'secondary' : 'ghost' }),
                'w-full justify-start',
                !isActive && 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
              )
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>

      <Separator className="mt-4" />

      {/* Recent conversations. Scrolls independently so the navigation above stays reachable. */}
      <nav aria-label="Recent conversations" className="flex min-h-0 flex-1 flex-col pt-3">
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {isPending ? (
            <div className="space-y-2" aria-busy="true">
              <span className="sr-only">Loading conversations</span>
              {Array.from({ length: 4 }).map((_unused, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-muted-foreground px-1 text-sm">Could not load conversations.</p>
          ) : sessions.length === 0 ? (
            <p className="text-muted-foreground px-1 text-sm">
              No conversations yet. Start one above.
            </p>
          ) : (
            grouped.map((group) => (
              <section key={group.key} className="mb-3 last:mb-0">
                {/* Sticky so the heading stays legible while its own group is being scrolled
                    past — otherwise the dates are only readable at rest. */}
                <h2 className="bg-sidebar text-muted-foreground/80 sticky top-0 z-10 px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase">
                  {group.label}
                </h2>

                <ul className="space-y-0.5">
                  {group.items.map((session) => {
                    // The newest conversation is the one open by default, so it is highlighted
                    // even before the URL names it explicitly.
                    const isActive =
                      isOnChat &&
                      (activeSessionId
                        ? activeSessionId === session.id
                        : session.id === sessions[0].id);

                    return (
                      <li key={session.id}>
                        <Link
                          to={`${ROUTES.CHAT}?session=${session.id}`}
                          onClick={closeSidebar}
                          aria-current={isActive ? 'page' : undefined}
                          title={session.title || 'New conversation'}
                          className={cn(
                            'block truncate rounded-md px-3 py-1.5 text-sm transition-colors',
                            isActive
                              ? 'bg-secondary text-secondary-foreground font-medium'
                              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                          )}
                        >
                          {session.title || 'New conversation'}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}

          {sessions?.length > VISIBLE_SESSIONS ? (
            <p className="text-muted-foreground/70 px-3 pt-2 text-xs">
              Showing the {VISIBLE_SESSIONS} most recent.
            </p>
          ) : null}
        </div>
      </nav>
    </div>
  );
};

export default AppSidebar;
