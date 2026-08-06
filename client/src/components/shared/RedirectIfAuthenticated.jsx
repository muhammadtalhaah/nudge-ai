/**
 * Keeps a signed-in user off the login and signup screens, sending them to the app instead.
 */

import { Navigate, Outlet } from 'react-router-dom';

import FullPageSpinner from '@/components/shared/FullPageSpinner';
import { ROUTES } from '@/config/constants';
import { useAuth } from '@/context/AuthContext';

const RedirectIfAuthenticated = () => {
  const { isAuthenticated, isBootstrapping } = useAuth();

  if (isBootstrapping) {
    return <FullPageSpinner label="Loading" />;
  }

  return isAuthenticated ? <Navigate to={ROUTES.CHAT} replace /> : <Outlet />;
};

export default RedirectIfAuthenticated;
