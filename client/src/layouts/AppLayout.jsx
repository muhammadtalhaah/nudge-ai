/**
 * Shell for the authenticated app: sidebar, header, and the routed page.
 *
 * The sidebar is permanent from tablet width up and an off-canvas drawer below it. Both render
 * the same `AppSidebar`, so navigation has one implementation rather than a mobile copy that
 * drifts out of step.
 */

import { Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu, MessageSquare } from 'lucide-react';

import AppSidebar from '@/components/shared/AppSidebar';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import ThemeToggle from '@/components/shared/ThemeToggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/context/AuthContext';
import { useLayout } from '@/context/LayoutContext';
import { ROUTES } from '@/config/constants';
import { cn } from '@/lib/utils';

const AppLayout = () => {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { isSidebarOpen, openSidebar, closeSidebar } = useLayout();

  // First initial as a lightweight avatar; no image upload exists in this prototype.
  const initial = user?.fullName?.trim()?.charAt(0)?.toUpperCase() ?? '?';

  return (
    // Fixed-height shell rather than min-height: it gives the chat pane a definite height to
    // fill, so it no longer needs to guess the chrome's size with a calc(). `main` owns the
    // scrolling, which keeps the sidebar and header fixed.
    <div className="flex h-dvh overflow-hidden">
      {/* Permanent sidebar, tablet and up. */}
      <aside className="bg-sidebar hidden h-full w-64 shrink-0 border-r lg-tablet:block">
        <AppSidebar />
      </aside>

      {/* Mobile drawer. Radix handles focus trapping and Escape. */}
      <Sheet open={isSidebarOpen} onOpenChange={(open) => (open ? openSidebar() : closeSidebar())}>
        <SheetContent side="left" className="p-0 lg-tablet:hidden">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2">
              <MessageSquare className="text-primary size-5" aria-hidden="true" />
              Nudge AI
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <AppSidebar />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 supports-backdrop-filter:bg-background/80 z-20 shrink-0 border-b backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-4 sm-tablet:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="lg-tablet:hidden"
              onClick={openSidebar}
              aria-label="Open navigation"
              aria-expanded={isSidebarOpen}
            >
              <Menu className="size-5" aria-hidden="true" />
            </Button>

            {/* Brand shows in the header only on mobile, where the sidebar is hidden. */}
            <span className="flex items-center gap-2 font-semibold lg-tablet:hidden">
              <MessageSquare className="text-primary size-5" aria-hidden="true" />
              Nudge AI
            </span>

            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />

              {/* Account menu. Radix owns the focus handling and Escape, and the avatar is the
                  trigger, so the header keeps one control instead of a chip plus a loose
                  sign-out button. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-auto gap-2 rounded-full px-1 py-1 sm-tablet:pr-3"
                    aria-label="Account menu"
                  >
                    <Avatar>
                      <AvatarFallback className="bg-secondary text-secondary-foreground font-medium">
                        {initial}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-muted-foreground hidden max-w-32 truncate text-sm sm-tablet:inline">
                      {user?.fullName}
                    </span>
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="truncate font-normal">
                    <span className="block truncate font-medium">{user?.fullName}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {user?.email}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void logout()} className={'cursor-pointer'}>
                    <LogOut aria-hidden="true" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main
          className={cn(
            'min-h-0 min-w-0 flex-1 overflow-y-auto',
            location.pathname === ROUTES.CHAT ? '' : 'px-4 py-6 sm-tablet:px-6',
          )}
        >
          {/* Scoped per page: a crash in one view leaves the sidebar and header usable. */}
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
