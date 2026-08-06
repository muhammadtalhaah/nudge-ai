/**
 * Provider composition and app root.
 *
 * Order matters: QueryClientProvider must wrap AuthProvider, because AuthProvider clears the
 * query cache on logout and needs the client to do it.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import ErrorBoundary from '@/components/shared/ErrorBoundary';
import { Toaster } from '@/components/ui/sonner';
import { QUERY_STALE_TIME_MS } from '@/config/constants';
import { AuthProvider } from '@/context/AuthContext';
import { LayoutProvider } from '@/context/LayoutContext';
import { ThemeProvider } from '@/context/ThemeContext';
import AppRouter from '@/navigations/AppRouter';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME_MS,
      // A 401 or 404 will fail identically however many times it is retried; only retry once,
      // and only for errors that might be transient.
      retry: (failureCount, error) => failureCount < 1 && error?.status >= 500,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Mutations are user-initiated and often not idempotent — never retry them silently.
      retry: false,
    },
  },
});

const App = () => {
  return (
    <ErrorBoundary title="The app failed to start">
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrowserRouter>
            <AuthProvider>
              <LayoutProvider>
                <AppRouter />
                <Toaster position="top-right" />
              </LayoutProvider>
            </AuthProvider>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
