/**
 * Route guard for authenticated areas.
 *
 * Renders nothing decisive until the bootstrap silent-refresh has settled — otherwise a page
 * reload would redirect a signed-in user to /login for the moment before their session is
 * restored. Guarding the UI is a convenience; the API enforces access independently.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';

import FullPageSpinner from '@/components/shared/FullPageSpinner';
import { ROUTES } from '@/config/constants';
import { useAuth } from '@/context/AuthContext';

const RequireAuth = () => {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const location = useLocation();

  if (isBootstrapping) {
    return <FullPageSpinner label="Restoring your session" />;
  }

  if (!isAuthenticated) {
    // Remember where they were headed so login can return them there.
    return <Navigate to={ROUTES.LOGIN} replace state={{ from: location }} />;
  }

  return <Outlet />;
};

export default RequireAuth;
