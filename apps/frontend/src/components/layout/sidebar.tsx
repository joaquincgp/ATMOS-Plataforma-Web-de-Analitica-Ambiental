import { Home, BarChart3, Database, Search, Settings, FileText, Upload, Code, Cpu, Layers } from 'lucide-react';

interface SidebarProps {
  activeView: string;
  onNavigate: (view: string) => void;
}

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'query', icon: Search, label: 'Query Builder' },
    { id: 'dashboard', icon: BarChart3, label: 'Analytics' },
    { id: 'data-sources', icon: Layers, label: 'Data Sources' },
    { id: 'ingestion', icon: Upload, label: 'Data Ingestion' },
    { id: 'code-editor', icon: Code, label: 'Code Editor' },
    { id: 'ml-runner', icon: Cpu, label: 'ML Experiments' },
    { id: 'data', icon: Database, label: 'Data Manager' },
    { id: 'reports', icon: FileText, label: 'Reports' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col h-screen">
      <div className="p-6 border-b border-sidebar-border">
        <h1 className="text-xl font-semibold text-sidebar-foreground">ATMOS</h1>
        <p className="text-xs text-sidebar-foreground/70 mt-1">Air Quality Analytics</p>
      </div>
      
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
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
      </nav>
    </aside>
  );
}