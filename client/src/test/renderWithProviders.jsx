/**
 * Renders a component inside the providers the app supplies at runtime.
 *
 * Retries are disabled so a deliberately failing request fails once and the test asserts the
 * error state, rather than waiting out a retry schedule.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';

export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

export const renderWithProviders = (ui, { route = '/', withAuth = true } = {}) => {
  const queryClient = createTestQueryClient();

  const Wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[route]}>
          {withAuth ? <AuthProvider>{children}</AuthProvider> : children}
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );

  return { ...render(ui, { wrapper: Wrapper }), queryClient };
};

export default renderWithProviders;
