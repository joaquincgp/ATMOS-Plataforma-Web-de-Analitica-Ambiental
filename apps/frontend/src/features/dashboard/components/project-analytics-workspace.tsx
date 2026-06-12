import { Suspense, lazy, useState } from 'react';
import { Layers, TrendingUp } from 'lucide-react';

import { ProjectAnalyticsDashboard } from '@/features/dashboard/components/project-analytics-dashboard';

const AnalyticalWorkspace = lazy(async () => {
  const module = await import('@/features/analysis/components/analytical-workspace');
  return { default: module.AnalyticalWorkspace };
});

type ProjectAnalyticsTab = 'dashboard' | 'analytics';

export function ProjectAnalyticsWorkspace() {
  const [tab, setTab] = useState<ProjectAnalyticsTab>('dashboard');

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F8FAFC]">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
        <div className="flex items-center gap-4">
          <div className="flex gap-1 rounded-[9px] bg-slate-50 p-1">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: Layers },
              { id: 'analytics', label: 'Analytical Workspace', icon: TrendingUp },
            ].map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setTab(item.id as ProjectAnalyticsTab)}
                  className={`flex items-center gap-2 rounded-[7px] px-4 py-1.5 text-sm transition ${
                    active ? 'bg-white font-bold text-slate-950 shadow-sm' : 'font-medium text-slate-400 hover:text-slate-700'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="h-6 w-px bg-slate-100" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'dashboard' ? (
          <div className="h-full overflow-y-auto">
            <ProjectAnalyticsDashboard />
          </div>
        ) : (
          <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading analytical workspace...</div>}>
            <AnalyticalWorkspace />
          </Suspense>
        )}
      </div>
    </div>
  );
}
