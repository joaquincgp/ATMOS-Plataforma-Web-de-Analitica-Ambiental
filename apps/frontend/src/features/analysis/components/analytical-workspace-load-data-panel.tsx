import {
  Calendar,
  Database,
  FileSpreadsheet,
  Loader2,
  MapPin,
  Search,
  ShieldCheck,
  Upload,
} from 'lucide-react';

import type { AnalyticsSourceOption } from '@/api/modules/analytics';
import type { ManualDatasetResponse } from '@/api/modules/etl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAnalyticalWorkspaceState } from '@/features/analysis/contexts/analytical-workspace-context';
import { RANGE_PRESETS } from '@/features/analysis/lib/analytical-workspace-config';

interface StationOption {
  code: string;
  name: string;
}

// Atribución de la fuente ("a quién le pertenece"): las fuentes automáticas
// provienen de la red oficial REMMAQ; las demás son cargas del usuario.
function getSourceAttribution(kind: string): { label: string; full: string } {
  const normalized = kind.toLowerCase();
  if (normalized === 'automatic' || normalized === 'remmaq') {
    return { label: 'REMMAQ', full: 'Red de Monitoreo Atmosférico de Quito · Secretaría de Ambiente' };
  }
  if (normalized === 'github_raw') {
    return { label: 'GitHub', full: 'Fuente enlazada desde un repositorio GitHub' };
  }
  return { label: 'Carga manual', full: 'Archivo cargado manualmente por el usuario' };
}

// Rango de fechas cubierto por la fuente, como referencia para el filtro de fechas.
function formatSourcePeriod(start: string | null, end: string | null): string | null {
  if (!start || !end) {
    return null;
  }
  return `${start.slice(0, 10)} → ${end.slice(0, 10)}`;
}

function AttributionBadge({ kind }: { kind: string }) {
  const attribution = getSourceAttribution(kind);
  return (
    <span
      title={attribution.full}
      className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
    >
      <ShieldCheck className="h-3 w-3 shrink-0" />
      <span className="truncate">{attribution.label}</span>
    </span>
  );
}

interface AnalyticalWorkspaceLoadDataPanelProps {
  filteredSources: AnalyticsSourceOption[];
  filteredManualDatasets: ManualDatasetResponse[];
  manualDatasetsLoading: boolean;
  availableStations: StationOption[];
  sourceMaxRows: number;
  loading: boolean;
  viewportBoundToRows: boolean;
  effectiveRowWindow: {
    from: string;
    to: string;
  };
  onToggleSource: (sourceId: number) => void;
  onSelectManualDataset: (datasetId: string) => void;
  onToggleStation: (stationCode: string) => void;
  onApplyRangePreset: (presetId: string) => void;
  onRun: () => void;
  selectedManualDatasetKind?: string | null;
}

export function AnalyticalWorkspaceLoadDataPanel({
  filteredSources,
  filteredManualDatasets,
  manualDatasetsLoading,
  availableStations,
  sourceMaxRows,
  loading,
  viewportBoundToRows,
  effectiveRowWindow,
  onToggleSource,
  onSelectManualDataset,
  onToggleStation,
  onApplyRangePreset,
  onRun,
  selectedManualDatasetKind,
}: AnalyticalWorkspaceLoadDataPanelProps) {
  const {
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    rangePreset,
    setRangePreset,
    sourceSearch,
    setSourceSearch,
    rowLimit,
    setRowLimit,
    selectedSourceIds,
    selectedManualDatasetId,
    selectedStations,
  } = useAnalyticalWorkspaceState();

  const resetToCustomRange = (nextDate: string, setter: (value: string) => void) => {
    setter(nextDate);
    setRangePreset('custom');
  };

  const getManualDatasetSubtitle = (dataset: ManualDatasetResponse) => {
    const sourceLabel =
      dataset.source_kind === 'remmaq'
        ? 'REMMAQ'
        : dataset.source_kind === 'github_raw'
          ? 'GitHub raw'
          : 'manual dataset';
    const kindLabel = dataset.dataset_kind ? ` - ${dataset.dataset_kind}` : '';
    return `${sourceLabel}${kindLabel} - ${dataset.row_count.toLocaleString()} rows`;
  };

  return (
    <Card className="bg-white border-[#dce5f1]">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Upload className="w-5 h-5 text-[#509EE3]" />
          Load Data
        </CardTitle>
        <CardDescription>
          Select one or more source files and configure the analysis window before rendering charts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_0.9fr_0.8fr] gap-4">
          <div className="rounded-xl border bg-[#fbfdff] p-4">
            <Label className="text-xs text-muted-foreground">Sources</Label>
            <div className="relative mt-2">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={sourceSearch}
                onChange={(event) => setSourceSearch(event.target.value)}
                placeholder="Search source..."
                className="pl-9"
              />
            </div>
            <ScrollArea className="mt-3 h-[360px]">
              <div className="space-y-2 pr-3">
                {filteredSources.map((source) => {
                  const active = selectedSourceIds.includes(source.id);
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => onToggleSource(source.id)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                        active
                          ? 'border-[#509EE3] bg-[#e9f3fd]'
                          : 'border-gray-200 bg-white hover:border-[#509EE3]/35'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#509EE3]/10">
                          <FileSpreadsheet className="w-4 h-4 text-[#509EE3]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{source.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {source.source_type} - {source.row_count.toLocaleString()} rows
                          </p>
                          <div className="flex flex-col">
                            <AttributionBadge kind={source.source_type} />
                            {formatSourcePeriod(source.period_start, source.period_end) && (
                              <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Calendar className="h-3 w-3 shrink-0" />
                                Periodo disponible: {formatSourcePeriod(source.period_start, source.period_end)}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {filteredManualDatasets.map((dataset) => {
                  const active = selectedManualDatasetId === dataset.id;
                  return (
                    <button
                      key={dataset.id}
                      type="button"
                      onClick={() => onSelectManualDataset(dataset.id)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                        active
                          ? 'border-[#509EE3] bg-[#e9f3fd]'
                          : 'border-gray-200 bg-white hover:border-[#509EE3]/35'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#509EE3]/10">
                          <Database className="w-4 h-4 text-[#509EE3]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{dataset.name}</p>
                            {active && (
                              <Badge className="bg-[#509EE3] text-white border-[#509EE3]">selected</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">{getManualDatasetSubtitle(dataset)}</p>
                          <div className="flex flex-col">
                            <AttributionBadge kind={dataset.source_kind} />
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {manualDatasetsLoading && (
                  <p className="text-xs text-muted-foreground py-4 text-center">Loading datasets...</p>
                )}
                {filteredSources.length === 0 && filteredManualDatasets.length === 0 && !manualDatasetsLoading && (
                  <p className="text-xs text-muted-foreground py-6 text-center">No matching sources.</p>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border bg-[#fbfdff] p-4 space-y-3">
              <Label className="text-xs text-muted-foreground">Date Range</Label>
              <div className="relative">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => resetToCustomRange(event.target.value, setDateFrom)}
                  className="pr-8"
                />
                <Calendar className="w-4 h-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <div className="relative">
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(event) => resetToCustomRange(event.target.value, setDateTo)}
                  className="pr-8"
                />
                <Calendar className="w-4 h-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {RANGE_PRESETS.map((preset) => {
                  const active = rangePreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onApplyRangePreset(preset.id)}
                      className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                        active
                          ? 'border-[#509EE3] bg-[#509EE3] text-white'
                          : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/70'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border bg-[#fbfdff] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Stations</Label>
                <Badge variant="outline">{selectedStations.length || 'All'}</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-[184px] overflow-auto">
                {availableStations.map((station) => {
                  const active = selectedStations.includes(station.code);
                  return (
                    <button
                      key={station.code}
                      type="button"
                      onClick={() => onToggleStation(station.code)}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] border transition-colors ${
                        active
                          ? 'border-[#509EE3] bg-[#509EE3] text-white'
                          : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/70'
                      }`}
                      title={station.name}
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      {station.code}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border bg-[#fbfdff] p-4 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="row-limit" className="text-xs text-muted-foreground">
                  Rows to load
                </Label>
                <Input
                  id="row-limit"
                  type="number"
                  min={100}
                  max={sourceMaxRows}
                  step={100}
                  value={rowLimit}
                  onChange={(event) =>
                    setRowLimit(Math.min(sourceMaxRows, Math.max(100, Number(event.target.value || 100))))
                  }
                />
              </div>
              <Button className="w-full bg-[#509EE3] hover:bg-[#509EE3]/90 text-white" onClick={onRun} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
                {selectedManualDatasetKind === 'generic' ? 'Open Summary' : 'Load Analysis Data'}
              </Button>
              <div className="rounded-lg border bg-white p-3 text-xs text-muted-foreground space-y-1">
                <div className="flex items-center justify-between">
                  <span>Selection</span>
                  <span className="font-medium text-foreground">
                    {selectedManualDatasetId ? '1 dataset' : `${selectedSourceIds.length} files`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Dataset cap</span>
                  <span className="font-medium text-foreground">{sourceMaxRows.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{viewportBoundToRows ? 'Visible window' : 'Time window'}</span>
                  <span className="font-medium text-foreground">
                    {effectiveRowWindow.from || '--'} to {effectiveRowWindow.to || '--'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
