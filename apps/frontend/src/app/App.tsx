import { TopBar } from '@/components/layout/top-bar';
import { AdvancedSidebar } from '@/components/layout/advanced-sidebar';
import { Login } from '@/features/auth/components/login';
import { AnalyticalWorkspace } from '@/features/analysis/components/analytical-workspace';
import { DataSources } from '@/features/data-sources/components/data-sources';
import { AdvancedHomeDashboard } from '@/features/dashboard/components/advanced-home-dashboard';
import { MLExperimentRunner } from '@/features/modeling/components/ml-experiment-runner';
import { ModelViewer } from '@/features/modeling/components/model-viewer';
import { Projects } from '@/features/projects/components/projects';
import { LandingPage } from '@/features/public/components/landing-page';
import { useAppStore } from '@/store/app-store';

function App() {
  const {
    showLanding,
    isLoggedIn,
    activeView,
    selectedProject,
    explorePlatform,
    login,
    navigate,
    selectProject,
    closeProject,
  } = useAppStore();

  const renderView = () => {
    switch (activeView) {
      case 'home':
        return <AdvancedHomeDashboard />;
      case 'projects':
        return <Projects onSelectProject={selectProject} />;
      case 'data-sources':
        return <DataSources />;
      case 'code-editor':
        return selectedProject ? <ModelViewer /> : <Projects onSelectProject={selectProject} />;
      case 'ml-experiments':
        return selectedProject ? <MLExperimentRunner /> : <Projects onSelectProject={selectProject} />;
      case 'analytical-workspace':
        return selectedProject ? <AnalyticalWorkspace /> : <Projects onSelectProject={selectProject} />;
      case 'settings':
        return (
          <div className="p-8">
            <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
            <p className="text-muted-foreground mt-2">Configure your ATMOS platform</p>
          </div>
        );
      default:
        return <AdvancedHomeDashboard />;
    }
  };

  if (showLanding) {
    return <LandingPage onExplore={explorePlatform} onLogin={explorePlatform} />;
  }

  if (!isLoggedIn) {
    return <Login onLogin={login} />;
  }

  return (
    <div className="flex h-screen bg-background">
      <AdvancedSidebar
        activeView={activeView}
        onNavigate={navigate}
        selectedProject={selectedProject}
        onCloseProject={closeProject}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />

        <main className="flex-1 overflow-y-auto">{renderView()}</main>
      </div>
    </div>
  );
}

export default App;
