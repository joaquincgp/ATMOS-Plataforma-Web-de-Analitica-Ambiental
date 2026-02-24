import { Home, FolderOpen, Database, Settings, Code, Cpu, BarChart3, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AppView } from '@/store/app-store';

interface AdvancedSidebarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  selectedProject: string | null;
  onCloseProject: () => void;
}

export function AdvancedSidebar({ activeView, onNavigate, selectedProject, onCloseProject }: AdvancedSidebarProps) {
  const baseNavItems: Array<{ id: AppView; icon: typeof Home; label: string }> = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'projects', icon: FolderOpen, label: 'Projects' },
    { id: 'data-sources', icon: Database, label: 'Data Manager' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  const projectAssets: Array<{ id: AppView; icon: typeof Code; label: string }> = [
    { id: 'code-editor', icon: Code, label: 'Code Editor' },
    { id: 'ml-experiments', icon: Cpu, label: 'ML Experiments' },
    { id: 'analytical-workspace', icon: BarChart3, label: 'Analytics' },
  ];

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col h-screen">
      {/* Logo & Title */}
      <div className="p-6 border-b border-sidebar-border">
        <h1 className="text-2xl font-black text-sidebar-foreground tracking-tight">ATMOS</h1>
        <p className="text-[9pt] font-light text-sidebar-foreground/60 mt-1">
          Environmental Research and Data Analytics Platform
        </p>
      </div>
      
      {/* Main Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-1">
          {baseNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            
            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
                    ${isActive 
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground' 
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    }
                  `}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-sm">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Project Assets Section (Only shown when project is selected) */}
        {selectedProject && (
          <>
            <div className="mt-6 mb-3 flex items-center justify-between px-3">
              <span className="text-xs font-semibold text-sidebar-foreground/60 uppercase tracking-wider">
                Project Assets
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCloseProject}
                className="h-6 w-6 p-0 hover:bg-sidebar-accent"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="bg-sidebar-accent/30 rounded-lg p-2">
              <ul className="space-y-1">
                {projectAssets.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeView === item.id;
                  
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => onNavigate(item.id)}
                        className={`
                          w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm
                          ${isActive 
                            ? 'bg-sidebar-primary text-sidebar-primary-foreground' 
                            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                          }
                        `}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Project Info */}
            <div className="mt-3 px-3 py-2 bg-[#509EE3]/10 rounded-lg">
              <p className="text-xs font-medium text-[#509EE3] truncate">
                Quito South Analysis
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Active Project
              </p>
            </div>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border">
        <div className="text-xs text-sidebar-foreground/60">
          <p className="font-medium">UDLA Research</p>
          <p className="text-sidebar-foreground/40 mt-0.5">v2.0.0</p>
        </div>
      </div>
    </aside>
  );
}
