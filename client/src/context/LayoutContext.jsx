/**
 * Layout chrome state.
 *
 * Only the mobile sidebar's open/closed flag lives here. It is global because the header's menu
 * button, the sidebar itself, and the navigation links inside it all need to read or change it,
 * and they are in different branches of the tree.
 *
 * On desktop the sidebar is always visible and this state is unused.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const LayoutContext = createContext(null);

export const LayoutProvider = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const openSidebar = useCallback(() => setIsSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setIsSidebarOpen((open) => !open), []);

  const value = useMemo(
    () => ({ isSidebarOpen, openSidebar, closeSidebar, toggleSidebar }),
    [isSidebarOpen, openSidebar, closeSidebar, toggleSidebar],
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
};

export const useLayout = () => {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used inside a LayoutProvider');
  }
  return context;
};

export default LayoutContext;
