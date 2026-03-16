import { useEffect, useMemo, useState } from 'react';
import { GripVertical, Save } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/contexts/workspace-context';

interface DashboardBlock {
  id: string;
  type: 'line' | 'bar' | 'area' | 'kpi';
  title: string;
}

const MOCK_TIMESERIES = [
  { label: 'Jan', value: 31 },
  { label: 'Feb', value: 28 },
  { label: 'Mar', value: 36 },
  { label: 'Apr', value: 33 },
  { label: 'May', value: 40 },
  { label: 'Jun', value: 35 },
];

const DEFAULT_BLOCKS: DashboardBlock[] = [
  { id: 'b1', type: 'line', title: 'Trend by Month' },
  { id: 'b2', type: 'bar', title: 'Station Distribution' },
  { id: 'b3', type: 'area', title: 'Rolling Exposure' },
  { id: 'b4', type: 'kpi', title: 'KPI Snapshot' },
];

interface WorkspaceDashboardBuilderProps {
  workspaceId: string;
}

function reorderBlocks(items: DashboardBlock[], fromIndex: number, toIndex: number): DashboardBlock[] {
  const output = [...items];
  const [moved] = output.splice(fromIndex, 1);
  output.splice(toIndex, 0, moved);
  return output;
}

export function WorkspaceDashboardBuilder({ workspaceId }: WorkspaceDashboardBuilderProps) {
  const { getDashboards, saveDashboard } = useWorkspace();
  const [dashboardName, setDashboardName] = useState('Operational Dashboard');
  const [blocks, setBlocks] = useState<DashboardBlock[]>(DEFAULT_BLOCKS);
  const [activeDashboardId, setActiveDashboardId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const dashboards = await getDashboards(workspaceId, 10);
        if (dashboards.length > 0) {
          const first = dashboards[0];
          setDashboardName(first.name);
          setActiveDashboardId(first.id);
          const parsedBlocks = first.blocks
            .map((item) => {
              const id = typeof item.id === 'string' ? item.id : '';
              const type = item.type;
              const title = typeof item.title === 'string' ? item.title : '';
              if (!id || !title) {
                return null;
              }
              if (type === 'line' || type === 'bar' || type === 'area' || type === 'kpi') {
                return { id, type, title } as DashboardBlock;
              }
              return null;
            })
            .filter((item): item is DashboardBlock => item !== null);

          setBlocks(parsedBlocks.length > 0 ? parsedBlocks : DEFAULT_BLOCKS);
        } else {
          setBlocks(DEFAULT_BLOCKS);
          setActiveDashboardId(undefined);
          setDashboardName('Operational Dashboard');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load workspace dashboards.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [getDashboards, workspaceId]);

  const handleSave = async () => {
    setError(null);
    try {
      const saved = await saveDashboard(workspaceId, {
        dashboard_id: activeDashboardId,
        name: dashboardName,
        description: 'Workspace dashboard layout',
        blocks: blocks.map((block) => ({
          id: block.id,
          type: block.type,
          title: block.title,
        })),
        filters: {},
      });
      setActiveDashboardId(saved.id);
      setDashboardName(saved.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save dashboard layout.');
    }
  };

  const gridClasses = useMemo(
    () => 'grid grid-cols-1 lg:grid-cols-2 gap-4',
    [],
  );

  return (
    <Card className="bg-white border-[#dce5f1]">
      <CardHeader>
        <CardTitle className="text-lg">Dashboard Builder</CardTitle>
        <CardDescription>Drag blocks to reorganize charts and save the layout for this workspace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="space-y-1 w-full max-w-sm">
            <label className="text-xs text-muted-foreground">Dashboard name</label>
            <Input value={dashboardName} onChange={(event) => setDashboardName(event.target.value)} />
          </div>
          <Button onClick={() => void handleSave()} className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white">
            <Save className="w-4 h-4 mr-2" />
            Save layout
          </Button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading dashboard blocks...</p>
        ) : (
          <div className={gridClasses}>
            {blocks.map((block, index) => (
              <div
                key={block.id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragIndex === null || dragIndex === index) {
                    return;
                  }
                  setBlocks((current) => reorderBlocks(current, dragIndex, index));
                  setDragIndex(null);
                }}
                className="border rounded-lg bg-[#f8fbff] p-3"
              >
                <div className="flex items-center gap-2 mb-3">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-semibold text-foreground">{block.title}</p>
                </div>

                <div className="h-[220px] w-full">
                  {block.type === 'line' && (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={MOCK_TIMESERIES}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" />
                        <YAxis />
                        <Tooltip />
                        <Line dataKey="value" stroke="#509EE3" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}

                  {block.type === 'bar' && (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={MOCK_TIMESERIES}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" fill="#1F5A8A" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}

                  {block.type === 'area' && (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={MOCK_TIMESERIES}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" />
                        <YAxis />
                        <Tooltip />
                        <Area type="monotone" dataKey="value" stroke="#0EA5E9" fill="#e0f2fe" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}

                  {block.type === 'kpi' && (
                    <div className="h-full flex items-center justify-center border rounded-md bg-white">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground uppercase">Average AQI</p>
                        <p className="text-3xl font-semibold text-[#1F5A8A]">38.4</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
