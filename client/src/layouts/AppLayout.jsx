/**
 * Shell for the authenticated app: sidebar, header, and the routed page.
 *
 * The sidebar is permanent from tablet width up and an off-canvas drawer below it. Both render
 * the same `AppSidebar`, so navigation has one implementation rather than a mobile copy that
 * drifts out of step.
 */

import { Outlet } from 'react-router-dom';
import { LogOut, Menu, MessageSquare } from 'lucide-react';

import AppSidebar from '@/components/shared/AppSidebar';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import ThemeToggle from '@/components/shared/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/context/AuthContext';
import { useLayout } from '@/context/LayoutContext';

const AppLayout = () => {
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

              <div className="hidden items-center gap-2 sm-tablet:flex">
                <span
                  className="bg-secondary text-secondary-foreground flex size-8 items-center justify-center rounded-full text-sm font-medium"
                  aria-hidden="true"
                >
                  {initial}
                </span>
                <span className="text-muted-foreground max-w-32 truncate text-sm">
                  {user?.fullName}
                </span>
              </div>

              <Button variant="ghost" size="icon" onClick={logout} aria-label="Sign out">
                <LogOut className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 sm-tablet:px-6">
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
