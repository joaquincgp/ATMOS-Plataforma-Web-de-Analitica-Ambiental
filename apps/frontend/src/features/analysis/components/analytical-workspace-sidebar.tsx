import { PanelLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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

const SELECTED_VARIABLE_COLORS = [
  { bg: '#eef6ff', border: '#0B5EA8', text: '#0B5EA8' },
  { bg: '#fff3ed', border: '#F05A28', text: '#C2410C' },
  { bg: '#ecfeff', border: '#0B7285', text: '#0B7285' },
  { bg: '#f0fdf4', border: '#16A34A', text: '#15803D' },
  { bg: '#f5f3ff', border: '#7C3AED', text: '#6D28D9' },
  { bg: '#fffbeb', border: '#A16207', text: '#92400E' },
  { bg: '#fdf2f8', border: '#DB2777', text: '#BE185D' },
  { bg: '#f8fafc', border: '#475569', text: '#334155' },
];

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
        ${collapsed ? 'w-16' : 'w-72'} h-full min-h-0 shrink-0 border-r border-gray-200 bg-white
        flex flex-col transition-[width] duration-300 ease-in-out overflow-hidden
      `}
    >
      {/* Header */}
      <div
        className={`
          border-b border-gray-200 flex gap-2
          ${collapsed ? 'justify-center px-2 py-3' : 'justify-between px-4 py-4'}
          transition-[padding] duration-300 ease-in-out
        `}
      >
        <div
          className={`
            min-w-0 flex-1
            transition-[max-width,opacity] duration-200 ease-in-out
            ${collapsed ? 'max-w-0 overflow-hidden opacity-0' : 'max-w-none opacity-100'}
          `}
        >
          <h2 className="mb-1 whitespace-nowrap font-semibold text-foreground">Analysis Section</h2>
          <p className="max-w-[220px] text-xs leading-snug text-muted-foreground">
            Select analysis type and keep charts in focus
          </p>
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
      <div className="min-h-0 flex-1 basis-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        <div className="p-2 pb-5 space-y-1">
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
      </div>

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
                {selectedVariables.map((code, index) => {
                  const label = availableVariables.find((v) => v.code === code)?.name ?? code;
                  const color = SELECTED_VARIABLE_COLORS[index % SELECTED_VARIABLE_COLORS.length];
                  return (
                    <span
                      key={code}
                      className="rounded-full border text-[10px] px-2 py-0.5"
                      style={{ backgroundColor: color.bg, borderColor: color.border, color: color.text }}
                    >
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
