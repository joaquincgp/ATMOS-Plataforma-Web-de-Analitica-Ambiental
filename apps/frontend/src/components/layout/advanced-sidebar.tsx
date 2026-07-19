import { useState } from 'react';
import {
  Home,
  FolderOpen,
  Database,
  Settings,
  Code,
  Cpu,
  BarChart3,
  ChevronDown,
  ChevronRight,
  PanelLeft,
  Rows3,
  Workflow,
} from 'lucide-react';
import type { AppView } from '@/store/app-store';
import atmosLogo from '@/assets/brand/atmos-logo.png';

interface AdvancedSidebarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  selectedProject: string | null;
  selectedProjectName: string | null;
  onCloseProject: () => void;
}

interface DataManagerNavProps {
  activeView: AppView;
  collapsed: boolean;
  sectionsCollapsed: boolean;
  items: { id: AppView; icon: typeof Workflow; label: string }[];
  onNavigate: (view: AppView) => void;
  onToggleSections: () => void;
}

export function AdvancedSidebar({
  activeView,
  onNavigate,
  selectedProject,
  selectedProjectName,
}: AdvancedSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [projectAssetsCollapsed, setProjectAssetsCollapsed] = useState(false);
  const [dataManagerCollapsed, setDataManagerCollapsed] = useState(false);

  const baseNavItems: { id: AppView; icon: typeof Home; label: string }[] = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'projects', icon: FolderOpen, label: 'Projects' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  const dataManagerItems: { id: AppView; icon: typeof Workflow; label: string }[] = [
    { id: 'data-sources', icon: Workflow, label: 'ETL Flow' },
    { id: 'data-sources-missing', icon: Rows3, label: 'Missing Data' },
  ];

  const projectAssets: { id: AppView; icon: typeof Code; label: string }[] = [
    { id: 'analytical-workspace', icon: BarChart3, label: 'Analytics' },
    { id: 'code-editor', icon: Code, label: 'Code Editor' },
    { id: 'ml-experiments', icon: Cpu, label: 'ML Experiments' },
  ];

  return (
    <aside
      className={`
        ${collapsed ? 'w-16' : 'w-64'}
        bg-sidebar border-r border-sidebar-border flex flex-col h-screen
        transition-[width] duration-300 ease-in-out overflow-hidden shrink-0
      `}
    >
      {/* Logo & Title */}
      <div
        className={`
          border-b border-sidebar-border flex items-center gap-3
          ${collapsed ? 'justify-center p-3' : 'p-6'}
          transition-[padding] duration-300 ease-in-out
        `}
      >
        <img
          src={atmosLogo}
          alt="ATMOS"
          decoding="async"
          className="h-9 w-9 shrink-0 object-contain"
        />
        <div
          className={`
            overflow-hidden transition-[max-width,opacity] duration-200 ease-in-out
            ${collapsed ? 'max-w-0 opacity-0 pointer-events-none' : 'max-w-[180px] opacity-100'}
          `}
        >
          <h1 className="text-2xl font-black text-sidebar-foreground tracking-tight">ATMOS</h1>
          <p className="text-[9pt] font-light text-sidebar-foreground/60 mt-1 leading-snug">
            Environmental Research and Data Analytics Platform
          </p>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 p-2 overflow-y-auto overflow-x-hidden">
        <ul className="space-y-1">
          {baseNavItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;

            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  title={collapsed ? item.label : undefined}
                  className={`
                    w-full flex items-center py-2.5 rounded-lg
                    transition-all duration-200
                    ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'}
                    ${isActive
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    }
                  `}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span
                    className={`
                      text-sm whitespace-nowrap overflow-hidden
                      transition-[max-width,opacity] duration-200 ease-in-out
                      ${collapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100'}
                    `}
                  >
                    {item.label}
                  </span>
                </button>
                {index === 1 && (
                  <DataManagerNav
                    activeView={activeView}
                    collapsed={collapsed}
                    sectionsCollapsed={dataManagerCollapsed}
                    items={dataManagerItems}
                    onNavigate={onNavigate}
                    onToggleSections={() => setDataManagerCollapsed((current) => !current)}
                  />
                )}
              </li>
            );
          })}
        </ul>

        {/* Project Assets Section */}
        {selectedProject && (
          <div
            className={`
              overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out
              ${collapsed ? 'max-h-0 opacity-0' : 'max-h-96 opacity-100'}
            `}
          >
            <div className="mt-6 mb-3 flex items-center justify-between gap-2 px-3">
              <button
                type="button"
                onClick={() => setProjectAssetsCollapsed((current) => !current)}
                className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60"
              >
                {projectAssetsCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                <span>Project Assets</span>
              </button>
            </div>

            {!projectAssetsCollapsed && (
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
            )}

            {/* Project Info */}
            <div className="mt-3 px-3 py-2 bg-[#509EE3]/10 rounded-lg">
              <p className="text-xs font-medium text-[#509EE3] truncate">
                {selectedProjectName ?? 'Project selected'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Active Project</p>
            </div>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div
        className={`
          border-t border-sidebar-border flex items-center
          ${collapsed ? 'justify-center p-3' : 'justify-between p-4'}
          transition-[padding] duration-300 ease-in-out
        `}
      >
        <div
          className={`
            overflow-hidden whitespace-nowrap
            transition-[max-width,opacity] duration-200 ease-in-out
            ${collapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100'}
          `}
        >
          <p className="text-xs font-medium text-sidebar-foreground/60">UDLA Research</p>
          <p className="text-xs text-sidebar-foreground/40 mt-0.5">v2.0.0</p>
        </div>

        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
          title={collapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
          className="h-7 w-7 flex items-center justify-center rounded-md text-sidebar-foreground/40 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent transition-colors duration-200 shrink-0"
        >
          <PanelLeft
            className={`w-4 h-4 transition-transform duration-300 ease-in-out ${collapsed ? 'rotate-180' : 'rotate-0'}`}
          />
        </button>
      </div>
    </aside>
  );
}

function DataManagerNav({
  activeView,
  collapsed,
  sectionsCollapsed,
  items,
  onNavigate,
  onToggleSections,
}: DataManagerNavProps) {
  const isDataManagerActive = items.some((item) => item.id === activeView);
  return (
    <div className={`${collapsed ? 'mt-1' : 'mt-1 space-y-1'}`}>
      <button
        type="button"
        onClick={onToggleSections}
        title={collapsed ? 'Data Manager' : undefined}
        className={`
          w-full flex items-center py-2.5 rounded-lg transition-all duration-200
          ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'}
          ${isDataManagerActive
            ? 'bg-sidebar-primary text-sidebar-primary-foreground'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          }
        `}
      >
        <Database className="w-5 h-5 shrink-0" />
        <span
          className={`
            flex-1 text-left text-sm whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-200 ease-in-out
            ${collapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100'}
          `}
        >
          Data Manager
        </span>
        {!collapsed ? (
          sectionsCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          )
        ) : null}
      </button>

      {!collapsed && !sectionsCollapsed && (
        <ul className="ml-4 border-l border-sidebar-border pl-2">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  className={`
                    w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors
                    ${isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    }
                  `}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
