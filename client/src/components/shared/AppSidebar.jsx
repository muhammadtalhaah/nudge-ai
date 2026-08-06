/**
 * Sidebar contents: primary navigation and the recent-conversations list.
 *
 * Presentational apart from the two data hooks it calls. The desktop and mobile shells in
 * AppLayout both render this same component, so there is one implementation of the navigation
 * rather than a duplicated mobile copy that drifts.
 */

import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, MessageSquare, MessageSquarePlus, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/config/constants';
import { useChatSessions, useCreateChatSession } from '@/hooks/useChatSessions';
import { useLayout } from '@/context/LayoutContext';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/utils/formatDate';

const NAV_ITEMS = [
  { to: ROUTES.CHAT, label: 'Assistant', icon: MessageSquare },
  { to: ROUTES.APPOINTMENTS, label: 'Appointments', icon: CalendarDays },
];

/** How many conversations the list shows before it stops. */
const VISIBLE_SESSIONS = 12;

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
    <div className="flex h-full min-h-0 flex-col">
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

      <nav aria-label="Main" className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            onClick={closeSidebar}
            className={({ isActive }) =>
              cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
              )
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Recent conversations. Scrolls independently so the navigation above stays reachable. */}
      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <h2 className="text-muted-foreground px-4 pb-2 text-xs font-semibold tracking-wide uppercase">
          Recent chats
        </h2>

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
            <ul className="space-y-1">
              {sessions.slice(0, VISIBLE_SESSIONS).map((session) => {
                // The newest conversation is the one open by default, so it is highlighted even
                // before the URL names it explicitly.
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
                      className={cn(
                        'block rounded-md px-3 py-2 text-sm transition-colors',
                        isActive
                          ? 'bg-secondary text-secondary-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <MessageSquarePlus
                          className="size-3.5 shrink-0 opacity-60"
                          aria-hidden="true"
                        />
                        <span className="truncate font-medium">
                          {session.title || 'New conversation'}
                        </span>
                      </span>
                      {session.lastMessageAt ? (
                        <span className="text-muted-foreground/80 mt-0.5 block pl-5.5 text-xs">
                          {formatRelative(session.lastMessageAt)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {sessions?.length > VISIBLE_SESSIONS ? (
            <p className="text-muted-foreground/70 px-3 pt-2 text-xs">
              Showing the {VISIBLE_SESSIONS} most recent.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default AppSidebar;
