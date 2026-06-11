import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';

import { AdvancedSidebar } from '@/components/layout/advanced-sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { ForgotPassword } from '@/features/auth/components/forgot-password';
import { Login } from '@/features/auth/components/login';
import { ResetPassword } from '@/features/auth/components/reset-password';
import { SignUp } from '@/features/auth/components/sign-up';
import { DataSources } from '@/features/data-sources/components/data-sources';
import { MLExperimentRunner } from '@/features/modeling/components/ml-experiment-runner';
import { ModelViewer } from '@/features/modeling/components/model-viewer';
import { Projects } from '@/features/projects/components/projects';
import { LandingPage } from '@/features/public/components/landing-page';
import { PublicDashboard } from '@/features/public/components/public-dashboard';
import { SettingsPanel } from '@/features/settings/components/settings-panel';
import { useAuth } from '@/contexts/auth-context';
import { useWorkspace } from '@/contexts/workspace-context';
import { AnalyticalWorkspaceProvider } from '@/features/analysis/contexts/analytical-workspace-context';
import type { AppView } from '@/store/app-store';

const AnalyticalWorkspace = lazy(async () => {
  const module = await import('@/features/analysis/components/analytical-workspace');
  return { default: module.AnalyticalWorkspace };
});

function normalizePath(path: string): string {
  if (!path) {
    return '/';
  }
  const clean = path.split('?')[0].split('#')[0] || '/';
  if (clean.length > 1 && clean.endsWith('/')) {
    return clean.slice(0, -1);
  }
  return clean;
}

function useSimpleRouter() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => {
      setPath(normalizePath(window.location.pathname));
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, replace = false) => {
    const next = normalizePath(to);
    if (replace) {
      window.history.replaceState({}, '', next);
    } else {
      window.history.pushState({}, '', next);
    }
    setPath(next);
  }, []);

  return { path, navigate };
}

function App() {
  const { path, navigate } = useSimpleRouter();
  const {
    user,
    isLoading,
    isAuthenticated,
    login,
    register,
    forgotPassword,
    resetPassword,
    logout,
  } = useAuth();
  const { activeWorkspace, activeWorkspaceId, setActiveWorkspaceId, isLoading: isLoadingWorkspace } = useWorkspace();

  const [activeView, setActiveView] = useState<AppView>('home');
  const [resetTokenPrefill, setResetTokenPrefill] = useState<string | undefined>(undefined);

  const isGenericUser = user?.role === 'generic';
  const isPrivatePath = path.startsWith('/app');
  const isAuthPath = ['/login', '/register', '/forgot-password', '/reset-password'].includes(path);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!isAuthenticated && isPrivatePath) {
      navigate('/login', true);
      return;
    }

    if (isAuthenticated && isGenericUser && isPrivatePath) {
      navigate('/public-dashboard', true);
      return;
    }

    if (isAuthenticated && isGenericUser && path !== '/public-dashboard' && path !== '/' && !isAuthPath) {
      navigate('/public-dashboard', true);
      return;
    }

    if (isAuthenticated && isAuthPath) {
      navigate(isGenericUser ? '/public-dashboard' : '/app', true);
      return;
    }

    if (
      isAuthenticated &&
      !isGenericUser &&
      !path.startsWith('/app') &&
      path !== '/public-dashboard' &&
      path !== '/'
    ) {
      navigate('/app', true);
    }
  }, [isAuthenticated, isAuthPath, isGenericUser, isLoading, isPrivatePath, navigate, path]);

  const handleSelectWorkspace = useCallback(
    (workspaceId: string) => {
      setActiveWorkspaceId(workspaceId);
      setActiveView('analytical-workspace');
    },
    [setActiveWorkspaceId],
  );

  const handleCloseWorkspace = useCallback(() => {
    setActiveWorkspaceId(null);
    setActiveView('projects');
  }, [setActiveWorkspaceId]);

  const privateView = useMemo(() => {
    switch (activeView) {
      case 'home':
        return <PublicDashboard embedded showLoginAction={false} />;
      case 'projects':
        return <Projects onSelectProject={handleSelectWorkspace} />;
      case 'data-sources':
        return <DataSources onOpenAnalytics={() => setActiveView('analytical-workspace')} />;
      case 'code-editor':
        return activeWorkspaceId ? <ModelViewer /> : <Projects onSelectProject={handleSelectWorkspace} />;
      case 'ml-experiments':
        return activeWorkspaceId ? <MLExperimentRunner /> : <Projects onSelectProject={handleSelectWorkspace} />;
      case 'analytical-workspace':
        return (
          <Suspense
            fallback={
              <div className="p-6 text-sm text-muted-foreground">
                Loading analytical workspace...
              </div>
            }
          >
            <AnalyticalWorkspace />
          </Suspense>
        );
      case 'settings':
        return <SettingsPanel />;
      default:
        return <PublicDashboard embedded showLoginAction={false} />;
    }
  }, [activeView, activeWorkspaceId, handleSelectWorkspace]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9FBFC] text-muted-foreground">
        Loading session...
      </div>
    );
  }

  if (path === '/') {
    return <LandingPage onExplore={() => navigate('/public-dashboard')} onLogin={() => navigate('/login')} />;
  }

  if (path === '/public-dashboard') {
    return <PublicDashboard onGoToLogin={() => navigate('/login')} />;
  }

  if (!isAuthenticated) {
    if (path === '/register') {
      return (
        <SignUp
          onRegister={async (payload) => {
            await register(payload);
          }}
          onBackToLogin={() => navigate('/login')}
        />
      );
    }

    if (path === '/forgot-password') {
      return (
        <ForgotPassword
          onSend={forgotPassword}
          onBackToLogin={() => navigate('/login')}
          onOpenResetPassword={(token) => {
            setResetTokenPrefill(token);
            navigate('/reset-password');
          }}
        />
      );
    }

    if (path === '/reset-password') {
      return (
        <ResetPassword
          initialToken={resetTokenPrefill}
          onReset={async (payload) => {
            await resetPassword(payload);
          }}
          onBackToLogin={() => navigate('/login')}
        />
      );
    }

    return (
      <Login
        onLogin={async (payload) => {
          const loggedUser = await login(payload);
          if (loggedUser.role === 'generic') {
            navigate('/public-dashboard', true);
          } else {
            navigate('/app', true);
          }
        }}
        onOpenRegister={() => navigate('/register')}
        onOpenForgotPassword={() => navigate('/forgot-password')}
      />
    );
  }

  if (isGenericUser) {
    return (
      <PublicDashboard
        onGoToLogin={() => {
          void (async () => {
            await logout();
            navigate('/login', true);
          })();
        }}
      />
    );
  }

  if (!path.startsWith('/app')) {
    return null;
  }

  return (
    <AnalyticalWorkspaceProvider>
      <div className="flex h-screen bg-background">
        <AdvancedSidebar
          activeView={activeView}
          onNavigate={setActiveView}
          selectedProject={activeWorkspaceId}
          selectedProjectName={isLoadingWorkspace ? "Cargando proyecto..." : (activeWorkspace?.name ?? null)}
          onCloseProject={handleCloseWorkspace}
        />

        <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
          <TopBar userName={user?.full_name ?? user?.email ?? 'User'} onLogout={() => void logout()} />
          <main className="min-h-0 flex-1 overflow-y-auto">{privateView}</main>
        </div>
      </div>
    </AnalyticalWorkspaceProvider>
  );
}

export default App;
