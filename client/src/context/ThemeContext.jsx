/**
 * Dark / light theme.
 *
 * Written against Context rather than pulling in `next-themes` (which shadcn's generated
 * sonner component reaches for by default): this is a Vite SPA with no Next.js, the company
 * standard is Context for global state, and the whole behaviour is about thirty lines. The
 * dependency was removed and `components/ui/sonner.jsx` points at this hook instead.
 *
 * The no-flash problem is solved in index.html, which applies the stored theme class before
 * the bundle loads. This provider keeps that class in sync afterwards.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { THEME_STORAGE_KEY } from '@/config/constants';

const ThemeContext = createContext(null);

const readStoredTheme = () => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    // Private browsing can throw on access; fall back rather than crash the app.
    return 'system';
  }
};

const systemPrefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

const applyTheme = (theme) => {
  const isDark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', isDark);
  // Tells the browser to draw native form controls and scrollbars to match.
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  return isDark;
};

export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(readStoredTheme);
  const [isDark, setIsDark] = useState(() => applyTheme(readStoredTheme()));

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Not persisting is a degraded experience, not an error worth surfacing.
    }
    setIsDark(applyTheme(next));
  }, []);

  /** Explicit light/dark, so one click always changes what the user is looking at. */
  const toggleTheme = useCallback(() => {
    setTheme(isDark ? 'light' : 'dark');
  }, [isDark, setTheme]);

  // While following the system, track changes to it live.
  useEffect(() => {
    if (theme !== 'system') return undefined;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => setIsDark(applyTheme('system'));

    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [theme]);

  const value = useMemo(
    () => ({ theme, isDark, setTheme, toggleTheme }),
    [theme, isDark, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return context;
};

export default ThemeContext;
