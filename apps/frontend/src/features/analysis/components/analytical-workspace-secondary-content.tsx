import { BarChart3, LineChart as LineChartIcon, TrendingUp } from 'lucide-react';

import type { EdaPlotResponse } from '@/api/modules/eda';
import { PlotlyFigurePanel } from '@/components/common/plotly-figure-panel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AnalyticalWorkspaceKpiCard as KpiCard } from '@/features/analysis/components/analytical-workspace-kpi-card';
import { round, type LabSection } from '@/features/analysis/lib/analytical-workspace-config';

interface AnalyticalWorkspaceSecondaryContentProps {
  labSection: LabSection;
  plotResponse: EdaPlotResponse | null;
  plotStats: Record<string, unknown>;
  plotDataFrameSummary: Record<string, unknown>[];
  plotVariableSummary: Record<string, unknown>[];
  plotQualitySummary: Record<string, unknown>[];
}

export function AnalyticalWorkspaceSecondaryContent({
  labSection,
  plotResponse,
  plotStats,
  plotDataFrameSummary,
  plotVariableSummary,
  plotQualitySummary,
}: AnalyticalWorkspaceSecondaryContentProps) {
  const secondaryFigures = plotResponse?.secondary_figures ?? [];
  const trendDirection = typeof plotStats.trendDirection === 'string' ? plotStats.trendDirection : null;
  const trendSlope = typeof plotStats.linearSlope === 'number' ? plotStats.linearSlope : null;
  const trendR2 = typeof plotStats.linearR2 === 'number' ? plotStats.linearR2 : null;
  const changepointThreshold =
    typeof plotStats.changepoint_threshold === 'number' ? plotStats.changepoint_threshold : null;
  const changepointCount = typeof plotStats.changepoint_count === 'number' ? plotStats.changepoint_count : null;

  const renderMiniGraph = (values: unknown) => {
    const numericValues = Array.isArray(values)
      ? values.map((value) => Number(value)).filter((value) => Number.isFinite(value)).slice(0, 28)
      : [];
    if (numericValues.length === 0) {
      return <div className="h-5 rounded border bg-[#f8fafc]" />;
    }
    const max = Math.max(...numericValues.map((value) => Math.abs(value)), 1);
    return (
      <div className="flex h-10 items-end gap-[2px] rounded border bg-[#f8fafc] px-1 py-1">
        {numericValues.map((value, index) => (
          <div
            key={`mini-bar-${index}`}
            className="w-1.5 bg-[#9db9d3]"
            style={{ height: `${Math.max(8, Math.min(100, (Math.abs(value) / max) * 100))}%` }}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {secondaryFigures.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {secondaryFigures.map((figure) => (
            <Card key={figure.key} className="bg-white border-[#dce5f1]">
              <CardHeader>
                <CardTitle className="text-lg">{figure.title}</CardTitle>
                {figure.description && <CardDescription>{figure.description}</CardDescription>}
              </CardHeader>
              <CardContent>
                <PlotlyFigurePanel
                  figure={figure.figure_json}
                  title={figure.title}
                  description={figure.description}
                  height={320}
                  uirevision={`secondary-${figure.key}`}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {labSection === 'summary' && plotDataFrameSummary.length > 0 && (
        <Card className="bg-white border-[#dce5f1]">
          <CardHeader>
            <CardTitle className="text-lg">Data Frame Summary</CardTitle>
            <CardDescription>Dimensions, valid values, missing values and compact distributions by column.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
              <div className="rounded-md border bg-[#f8fbff] px-3 py-2">
                <span className="text-muted-foreground">Rows</span>
                <p className="font-semibold text-[#1F5A8A]">{Number(plotStats.row_count ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded-md border bg-[#f8fbff] px-3 py-2">
                <span className="text-muted-foreground">Columns</span>
                <p className="font-semibold text-[#1F5A8A]">{Number(plotStats.column_count ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded-md border bg-[#f8fbff] px-3 py-2">
                <span className="text-muted-foreground">Numeric</span>
                <p className="font-semibold text-[#1F5A8A]">
                  {Array.isArray(plotStats.numeric_columns) ? plotStats.numeric_columns.length : 0}
                </p>
              </div>
              <div className="rounded-md border bg-[#f8fbff] px-3 py-2">
                <span className="text-muted-foreground">Datetime</span>
                <p className="font-semibold text-[#1F5A8A]">
                  {Array.isArray(plotStats.datetime_columns) ? plotStats.datetime_columns.length : 0}
                </p>
              </div>
            </div>
            <div className="max-h-[560px] overflow-auto rounded-md border">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#F9FBFC]">
                  <tr>
                    <th className="border border-gray-200 p-2 text-left font-medium">No</th>
                    <th className="border border-gray-200 p-2 text-left font-medium">Variable</th>
                    <th className="border border-gray-200 p-2 text-left font-medium">Stats / Values</th>
                    <th className="border border-gray-200 p-2 text-left font-medium">Freqs</th>
                    <th className="border border-gray-200 p-2 text-left font-medium">Graph</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Valid</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Missing</th>
                  </tr>
                </thead>
                <tbody>
                  {plotDataFrameSummary.map((item, index) => (
                    <tr key={`data-frame-summary-${index}`} className="hover:bg-[#F9FBFC]">
                      <td className="border border-gray-200 p-2">{String(item.no ?? index + 1)}</td>
                      <td className="border border-gray-200 p-2 font-medium">{String(item.variable ?? '--')}</td>
                      <td className="whitespace-pre-line border border-gray-200 p-2 leading-relaxed">
                        {String(item.stats_values ?? '--')}
                      </td>
                      <td className="border border-gray-200 p-2">{String(item.freqs ?? '--')}</td>
                      <td className="border border-gray-200 p-2">{renderMiniGraph(item.graph_values)}</td>
                      <td className="border border-gray-200 p-2 text-right">
                        {Number(item.valid ?? 0).toLocaleString()} ({round(Number(item.valid_pct ?? 0) * 100, 1)}%)
                      </td>
                      <td className="border border-gray-200 p-2 text-right">
                        {Number(item.missing ?? 0).toLocaleString()} ({round(Number(item.missing_pct ?? 0) * 100, 1)}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {labSection === 'summary' && plotVariableSummary.length > 0 && (
        <Card className="bg-white border-[#dce5f1]">
          <CardHeader>
            <CardTitle className="text-lg">Statistical Summary</CardTitle>
            <CardDescription>Descriptive statistics for the filtered variables.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F9FBFC]">
                    <th className="border border-gray-200 p-2 text-left font-medium">Variable</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Count</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Mean</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Std</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Min</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Median</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {plotVariableSummary.map((item, index) => (
                    <tr key={`summary-row-${index}`} className="hover:bg-[#F9FBFC]">
                      <td className="border border-gray-200 p-2 font-medium">{String(item.label ?? item.code ?? '--')}</td>
                      <td className="border border-gray-200 p-2 text-right">{String(item.count ?? '--')}</td>
                      <td className="border border-gray-200 p-2 text-right">{round(Number(item.mean ?? 0))}</td>
                      <td className="border border-gray-200 p-2 text-right">{round(Number(item.std ?? 0))}</td>
                      <td className="border border-gray-200 p-2 text-right">{round(Number(item.min ?? 0))}</td>
                      <td className="border border-gray-200 p-2 text-right">{round(Number(item.median ?? 0))}</td>
                      <td className="border border-gray-200 p-2 text-right">{round(Number(item.max ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {labSection === 'summary' && plotQualitySummary.length > 0 && (
        <Card className="bg-white border-[#dce5f1]">
          <CardHeader>
            <CardTitle className="text-lg">Load Summary</CardTitle>
            <CardDescription>Valid, missing and distinct values by variable.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F9FBFC]">
                    <th className="border border-gray-200 p-2 text-left font-medium">Variable</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Valid</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Valid %</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Missing</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Missing %</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Distinct</th>
                  </tr>
                </thead>
                <tbody>
                  {plotQualitySummary.map((item, index) => (
                    <tr key={`quality-row-${index}`} className="hover:bg-[#F9FBFC]">
                      <td className="border border-gray-200 p-2 font-medium">{String(item.label ?? item.variable_code ?? '--')}</td>
                      <td className="border border-gray-200 p-2 text-right">{Number(item.valid ?? 0).toLocaleString()}</td>
                      <td className="border border-gray-200 p-2 text-right">{round(Number(item.valid_pct ?? 0) * 100, 1)}%</td>
                      <td className="border border-gray-200 p-2 text-right">{Number(item.missing ?? 0).toLocaleString()}</td>
                      <td className="border border-gray-200 p-2 text-right">{round(Number(item.missing_pct ?? 0) * 100, 1)}%</td>
                      <td className="border border-gray-200 p-2 text-right">{Number(item.distinct ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {labSection === 'trend' && trendDirection && trendSlope !== null && trendR2 !== null && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KpiCard label="Slope" value={round(trendSlope, 6).toString()} icon={TrendingUp} />
          <KpiCard label="R2" value={round(trendR2, 4).toString()} icon={BarChart3} />
          <KpiCard
            label="Direction"
            value={trendDirection}
            icon={LineChartIcon}
            badgeTone={trendDirection === 'Rising' ? 'green' : trendDirection === 'Falling' ? 'amber' : 'blue'}
          />
        </div>
      )}

      {labSection === 'changepoints' && changepointThreshold !== null && changepointCount !== null && (
        <div className="rounded-md border bg-[#f8fbff] px-3 py-2 text-xs text-muted-foreground">
          Threshold: {round(changepointThreshold, 4)} · Detected changepoints: {changepointCount}
        </div>
      )}
    </div>
  );
}
