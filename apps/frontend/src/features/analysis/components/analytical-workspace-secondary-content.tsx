import { BarChart3, LineChart as LineChartIcon, TrendingUp } from 'lucide-react';

import type { EdaPlotResponse } from '@/api/modules/eda';
import { PlotlyChart } from '@/components/common/plotly-chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AnalyticalWorkspaceKpiCard as KpiCard } from '@/features/analysis/components/analytical-workspace-kpi-card';
import { round, type LabSection } from '@/features/analysis/lib/analytical-workspace-config';

interface AnalyticalWorkspaceSecondaryContentProps {
  labSection: LabSection;
  plotResponse: EdaPlotResponse | null;
  plotStats: Record<string, unknown>;
  plotVariableSummary: Record<string, unknown>[];
}

export function AnalyticalWorkspaceSecondaryContent({
  labSection,
  plotResponse,
  plotStats,
  plotVariableSummary,
}: AnalyticalWorkspaceSecondaryContentProps) {
  const secondaryFigures = plotResponse?.secondary_figures ?? [];
  const trendDirection = typeof plotStats.trendDirection === 'string' ? plotStats.trendDirection : null;
  const trendSlope = typeof plotStats.linearSlope === 'number' ? plotStats.linearSlope : null;
  const trendR2 = typeof plotStats.linearR2 === 'number' ? plotStats.linearR2 : null;
  const changepointThreshold =
    typeof plotStats.changepoint_threshold === 'number' ? plotStats.changepoint_threshold : null;
  const changepointCount = typeof plotStats.changepoint_count === 'number' ? plotStats.changepoint_count : null;

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
                <div className="h-[320px] w-full">
                  <PlotlyChart figure={figure.figure_json} height={320} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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
