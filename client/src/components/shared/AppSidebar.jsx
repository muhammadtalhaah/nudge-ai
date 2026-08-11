/**
 * Sidebar contents: primary navigation and the recent-conversations list.
 *
 * Presentational apart from the two data hooks it calls. The desktop and mobile shells in
 * AppLayout both render this same component, so there is one implementation of the navigation
 * rather than a duplicated mobile copy that drifts.
 */

import { useMemo, useRef } from 'react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { CalendarDays, MessageSquare, Plus } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/config/constants';
import { useChatSessions } from '@/hooks/useChatSessions';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useLayout } from '@/context/LayoutContext';
import { cn } from '@/lib/utils';
import { recencyBucket } from '@/utils/formatDate';

/**
 * The chat itself is not listed here.
 *
 * "New Chat" starts one and every row in the history below opens one, so a nav link pointing
 * at the same place was a third route to somewhere the sidebar already goes twice — and it sat
 * permanently selected on the app's default screen, which made the highlight mean nothing. The
 * brand link still returns to the assistant from anywhere.
 */
const NAV_ITEMS = [{ to: ROUTES.APPOINTMENTS, label: 'Appointments', icon: CalendarDays }];

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
  const [searchParams] = useSearchParams();
  const { closeSidebar } = useLayout();

  const activeSessionId = searchParams.get('session');
  const isOnChat = location.pathname === ROUTES.CHAT;

  const { sessions, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useChatSessions();

  /**
   * The list scrolls inside this panel rather than the page, so it is the observer's root —
   * with the viewport instead, the sentinel's visibility answers a question about the wrong
   * box.
   */
  const scrollRef = useRef(null);

  const sentinelRef = useInfiniteScroll({
    onLoadMore: fetchNextPage,
    // Not while a page is already on its way: the sentinel stays on screen until the new rows
    // push it down, and every intersection until then would ask for the same page again.
    enabled: hasNextPage && !isFetchingNextPage,
    rootRef: scrollRef,
  });

  /**
   * Everything loaded so far, bucketed by recency. Empty buckets are dropped so a heading
   * never appears without rows under it.
   */
  const grouped = useMemo(
    () =>
      GROUPS.map(({ key, label }) => ({
        key,
        label,
        items: sessions.filter(
          (session) => recencyBucket(session.lastMessageAt ?? session.createdAt) === key,
        ),
      })).filter((group) => group.items.length > 0),
    [sessions],
  );

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
        {/*
          A link rather than a button, so the assistant opens in a new tab on cmd-click, on
          middle-click, and from the context menu — the same as every other destination in this
          sidebar. `asChild` hands Button's styling to the anchor, so nothing about how it looks
          changes; what changes is that the browser now knows this goes somewhere.

          Starting a conversation still creates nothing. This points at the chat with no
          `?session=`, which the page reads as a blank thread, and the record is written when
          there is a first message to put in it. Clicking it used to persist a conversation
          immediately, so anyone who clicked and thought better of it left an empty row in the
          sidebar forever.
        */}
        <Button asChild className="w-full justify-start text-white">
          <Link to={ROUTES.CHAT} onClick={closeSidebar}>
            <Plus className="size-4" aria-hidden="true" />
            New Chat
          </Link>
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
                // Sidebar tokens rather than the page's: this sits on the darker of the two
                // surfaces, so a hover tuned against the page barely registers here.
                isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
                !isActive &&
                  'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
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
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
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
                <h2 className="bg-sidebar text-muted-foreground sticky top-0 z-10 px-3 py-1.5 text-xs font-medium">
                  {group.label}
                </h2>

                <ul className="space-y-0.5">
                  {group.items.map((session) => {
                    // Only ever the conversation the URL names. The chat page opens a blank
                    // thread when it names none, so highlighting the newest row there would
                    // point at a conversation nobody is in.
                    const isActive = isOnChat && activeSessionId === session.id;

                    return (
                      <li key={session.id}>
                        <Link
                          to={`${ROUTES.CHAT}?session=${session.id}`}
                          onClick={closeSidebar}
                          aria-current={isActive ? 'page' : undefined}
                          title={session.title || 'New conversation'}
                          className={cn(
                            'block truncate rounded-lg px-3 py-2 text-sm transition-colors',
                            isActive
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                              : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
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

          {/*
            The end of the list, and the trigger for the next page. It is rendered only while
            more exist, so reaching the bottom of a complete list observes nothing.
          */}
          {hasNextPage ? (
            <div ref={sentinelRef} className="px-3 pt-2" aria-hidden="true">
              {isFetchingNextPage ? <Skeleton className="h-9 w-full" /> : null}
            </div>
          ) : null}

          {/* Announced rather than shown: the skeleton above is decorative, and a screen
              reader needs to be told the list grew under it. */}
          <p aria-live="polite" className="sr-only">
            {isFetchingNextPage ? 'Loading more conversations' : ''}
          </p>
        </div>
      </nav>
    </div>
  );
};

export default AppSidebar;
