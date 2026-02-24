import { createContext, useContext, useMemo, useState } from 'react';

export type AppView =
  | 'home'
  | 'projects'
  | 'data-sources'
  | 'code-editor'
  | 'ml-experiments'
  | 'analytical-workspace'
  | 'settings';

interface AppStoreValue {
  showLanding: boolean;
  isLoggedIn: boolean;
  activeView: AppView;
  selectedProject: string | null;
  explorePlatform: () => void;
  login: () => void;
  navigate: (view: AppView) => void;
  selectProject: (projectId: string) => void;
  closeProject: () => void;
}

const AppStoreContext = createContext<AppStoreValue | undefined>(undefined);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [showLanding, setShowLanding] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeView, setActiveView] = useState<AppView>('home');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const value = useMemo<AppStoreValue>(
    () => ({
      showLanding,
      isLoggedIn,
      activeView,
      selectedProject,
      explorePlatform: () => setShowLanding(false),
      login: () => {
        setShowLanding(false);
        setIsLoggedIn(true);
      },
      navigate: (view: AppView) => setActiveView(view),
      selectProject: (projectId: string) => {
        setSelectedProject(projectId);
        setActiveView('analytical-workspace');
      },
      closeProject: () => {
        setSelectedProject(null);
        setActiveView('projects');
      },
    }),
    [showLanding, isLoggedIn, activeView, selectedProject],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const context = useContext(AppStoreContext);
  if (!context) {
    throw new Error('useAppStore must be used within an AppStoreProvider');
  }
  return context;
}
