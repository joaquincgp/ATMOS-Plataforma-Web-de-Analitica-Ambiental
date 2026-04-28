import { PanelLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ANALYSIS_SECTIONS,
  type LabSection,
} from '@/features/analysis/lib/analytical-workspace-config';

interface VariableOption {
  code: string;
  name: string;
}

interface AnalyticalWorkspaceSidebarProps {
  collapsed: boolean;
  labSection: LabSection;
  selectedDataSourceCount: number;
  availableVariables: VariableOption[];
  selectedVariables: string[];
  selectedStationsCount: number;
  rowCount: number;
  viewportBoundToRows: boolean;
  onSelectSection: (section: LabSection) => void;
  onToggleCollapsed: () => void;
}

export function AnalyticalWorkspaceSidebar({
  collapsed,
  labSection,
  selectedDataSourceCount,
  availableVariables,
  selectedVariables,
  selectedStationsCount,
  rowCount,
  viewportBoundToRows,
  onSelectSection,
  onToggleCollapsed,
}: AnalyticalWorkspaceSidebarProps) {
  return (
    <aside
      className={`
        ${collapsed ? 'w-16' : 'w-72'} shrink-0 border-r border-gray-200 bg-white
        flex flex-col transition-[width] duration-300 ease-in-out overflow-hidden
      `}
    >
      {/* Header */}
      <div
        className={`
          border-b border-gray-200 flex items-center gap-2
          ${collapsed ? 'justify-center px-2 py-3' : 'justify-between px-4 py-4'}
          transition-[padding] duration-300 ease-in-out
        `}
      >
        <div
          className={`
            overflow-hidden whitespace-nowrap min-w-0
            transition-[max-width,opacity] duration-200 ease-in-out
            ${collapsed ? 'max-w-0 opacity-0' : 'max-w-xs opacity-100'}
          `}
        >
          <h2 className="font-semibold text-foreground mb-1">Analysis Section</h2>
          <p className="text-xs text-muted-foreground">Select analysis type and keep charts in focus</p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 shrink-0 text-gray-400 hover:text-gray-600"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          title={collapsed ? 'Expand panel' : 'Collapse panel'}
        >
          <PanelLeft
            className={`w-4 h-4 transition-transform duration-300 ease-in-out ${collapsed ? 'rotate-180' : 'rotate-0'}`}
          />
        </Button>
      </div>

      {/* Analysis section buttons */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {ANALYSIS_SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = labSection === section.value;
            const locked = section.value !== 'load-data' && selectedDataSourceCount === 0;

            return (
              <button
                key={section.value}
                type="button"
                onClick={() => onSelectSection(section.value)}
                className={`
                  w-full flex items-center py-2.5 rounded-lg text-sm transition-all duration-200
                  ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'}
                  ${isActive ? 'bg-[#509EE3] text-white shadow-md' : 'hover:bg-gray-100 text-foreground'}
                `}
                title={section.label}
              >
                <Icon className="w-4 h-4 shrink-0" style={{ color: isActive ? 'white' : section.color }} />
                <span
                  className={`
                    flex-1 text-left whitespace-nowrap overflow-hidden
                    transition-[max-width,opacity] duration-200 ease-in-out
                    ${collapsed ? 'max-w-0 opacity-0' : 'max-w-[200px] opacity-100'}
                  `}
                >
                  {section.label}
                </span>
                {locked && !collapsed && <div className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Variables & Current Selection panel */}
      <div
        className={`
          border-t border-gray-200 overflow-hidden
          transition-[max-height,opacity] duration-300 ease-in-out
          ${collapsed || labSection === 'load-data' ? 'max-h-0 opacity-0' : 'max-h-[460px] opacity-100'}
        `}
      >
        <div className="p-4 space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Variables For This View</Label>
              <span className="text-[10px] text-muted-foreground">{selectedVariables.length} selected</span>
            </div>
            {selectedVariables.length > 0 && (
              <div className="flex flex-wrap gap-1 rounded-md border bg-[#f8fbff] p-2">
                {selectedVariables.map((code) => {
                  const label = availableVariables.find((v) => v.code === code)?.name ?? code;
                  return (
                    <span key={code} className="rounded-full bg-[#509EE3]/10 border border-[#509EE3]/30 text-[#1F5A8A] text-[10px] px-2 py-0.5">
                      {label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Current Selection</Label>
            <div className="rounded-lg border bg-[#F9FBFC] p-3 space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Sources</span>
                <span className="font-medium text-foreground">{selectedDataSourceCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Stations</span>
                <span className="font-medium text-foreground">{selectedStationsCount || 'All'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{viewportBoundToRows ? 'Visible rows' : 'Rows'}</span>
                <span className="font-medium text-foreground">{rowCount.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
