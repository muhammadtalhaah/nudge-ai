/**
 * Shell for the login and signup screens.
 */

import { Outlet } from 'react-router-dom';
import { CalendarHeart } from 'lucide-react';

import ThemeToggle from '@/components/shared/ThemeToggle';

const AuthLayout = () => {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between p-4 sm-tablet:p-6">
        <div className="flex items-center gap-2">
          <CalendarHeart className="text-primary size-5" aria-hidden="true" />
          <span className="font-semibold">Nudge AI</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center p-4 sm-tablet:p-6">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </main>

      <footer className="text-muted-foreground p-4 text-center text-xs">
        Appointment booking, powered by a conversational assistant.
      </footer>
    </div>
  );
};

export default AuthLayout;
