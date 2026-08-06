/**
 * Centralised routing.
 *
 * Pages are lazy-loaded so the initial bundle only carries the shell and whichever screen the
 * visitor actually landed on.
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import FullPageSpinner from '@/components/shared/FullPageSpinner';
import RedirectIfAuthenticated from '@/components/shared/RedirectIfAuthenticated';
import RequireAuth from '@/components/shared/RequireAuth';
import { ROUTES } from '@/config/constants';
import AppLayout from '@/layouts/AppLayout';
import AuthLayout from '@/layouts/AuthLayout';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const SignupPage = lazy(() => import('@/pages/auth/SignupPage'));
const ChatPage = lazy(() => import('@/pages/chat/ChatPage'));
const AppointmentsPage = lazy(() => import('@/pages/appointments/AppointmentsPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

const AppRouter = () => {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {/* Signed out only — a logged-in user is bounced to the app. */}
        <Route element={<RedirectIfAuthenticated />}>
          <Route element={<AuthLayout />}>
            <Route path={ROUTES.LOGIN} element={<LoginPage />} />
            <Route path={ROUTES.SIGNUP} element={<SignupPage />} />
          </Route>
        </Route>

        {/* Authenticated area. The guard blocks; the API is still the final authority. */}
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path={ROUTES.CHAT} element={<ChatPage />} />
            <Route path={ROUTES.APPOINTMENTS} element={<AppointmentsPage />} />
          </Route>
        </Route>

        <Route path={ROUTES.ROOT} element={<Navigate to={ROUTES.CHAT} replace />} />
        <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
};

export default AppRouter;
