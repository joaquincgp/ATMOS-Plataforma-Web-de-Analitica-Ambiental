import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Box,
  Circle,
  Edit3,
  GripVertical,
  Hash,
  Grid3X3,
  LineChart,
  MoreHorizontal,
  Plus,
  Save,
  ScatterChart,
  Trash2,
  X,
} from 'lucide-react';

import { PlotlyChart } from '@/components/common/plotly-chart';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { runEdaPlot, type EdaChartType, type EdaPlotRequest } from '@/api/modules/eda';
import { useAnalyticalWorkspaceState } from '@/features/analysis/contexts/analytical-workspace-context';
import {
  useDashboard,
  type DashboardCard,
  type DashboardCardSize,
  type DashboardChartKind,
  type DashboardFigure,
} from '@/features/dashboard/contexts/dashboard-context';

const PALETTE = ['#509EE3', '#F97316', '#22C55E', '#8B5CF6', '#EF4444', '#EAB308', '#06B6D4', '#EC4899'];

const CHART_TYPES: {
  kind: DashboardChartKind;
  chartType: EdaChartType;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  { kind: 'line', chartType: 'line', label: 'Linea', icon: <LineChart size={20} />, description: 'Tendencias temporales' },
  { kind: 'bar', chartType: 'bar', label: 'Barras', icon: <BarChart3 size={20} />, description: 'Comparacion entre grupos' },
  { kind: 'scatter', chartType: 'scatter', label: 'Dispersion', icon: <ScatterChart size={20} />, description: 'Relacion entre variables' },
  { kind: 'heatmap', chartType: 'heatmap', label: 'Mapa de calor', icon: <Grid3X3 size={20} />, description: 'Intensidad por eje' },
  { kind: 'histogram', chartType: 'histogram', label: 'Histograma', icon: <Circle size={20} />, description: 'Distribucion de valores' },
  { kind: 'box', chartType: 'box', label: 'Caja', icon: <Box size={20} />, description: 'Rangos y outliers' },
  { kind: 'kpi', chartType: 'line', label: 'Indicador', icon: <Hash size={20} />, description: 'Numero destacado' },
];

const SIZE_OPTIONS: { value: DashboardCardSize; label: string; description: string; columns: string }[] = [
  { value: 'sm', label: 'Pequeno', description: '1/3 del ancho', columns: '4' },
  { value: 'md', label: 'Mediano', description: '1/2 del ancho', columns: '6' },
  { value: 'lg', label: 'Completo', description: 'Ancho total', columns: '12' },
];

function cardColumnClass(size: DashboardCardSize) {
  if (size === 'sm') return 'xl:col-span-4';
  if (size === 'md') return 'xl:col-span-6';
  return 'xl:col-span-12';
}

function figureWithColor(figure: DashboardFigure, color: string): DashboardFigure {
  return {
    ...figure,
    data: (figure.data ?? []).map((trace) => {
      if (!trace || typeof trace !== 'object') return trace;
      const base = trace as Record<string, unknown>;
      return {
        ...base,
        marker: { ...((base.marker as Record<string, unknown> | undefined) ?? {}), color },
        line: { ...((base.line as Record<string, unknown> | undefined) ?? {}), color },
      };
    }),
  };
}


function ChartBuilder({ onClose, editingCard }: { onClose: () => void; editingCard?: DashboardCard | null }) {
  const { addCard, updateCard } = useDashboard();
  const {
    selectedSourceIds,
    selectedManualDatasetId,
    selectedStations,
    selectedVariables,
    dateFrom,
    dateTo,
    rowLimit,
    granularity,
    timeAggregation,
  } = useAnalyticalWorkspaceState();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [kind, setKind] = useState<DashboardChartKind>(editingCard?.kind ?? 'line');
  const [size, setSize] = useState<DashboardCardSize>(editingCard?.size ?? 'md');
  const [color, setColor] = useState(editingCard?.color ?? PALETTE[0]);
  const [title, setTitle] = useState(editingCard?.title ?? '');
  const [description, setDescription] = useState(editingCard?.description ?? '');
  const [variables, setVariables] = useState<string[]>(selectedVariables.length > 0 ? selectedVariables : ['PM25']);
  const [preview, setPreview] = useState<DashboardFigure | null>(editingCard?.figure ?? null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chartType = CHART_TYPES.find((item) => item.kind === kind)?.chartType ?? 'line';
  const hasSource = selectedSourceIds.length > 0 || Boolean(selectedManualDatasetId);

  const buildPayload = (): EdaPlotRequest => ({
    section: kind === 'histogram' || kind === 'box' ? 'distribution' : kind === 'scatter' ? 'scatter' : 'data_trend',
    source_file_ids: selectedSourceIds,
    manual_dataset_id: selectedManualDatasetId,
    station_codes: selectedStations,
    variable_codes: variables,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    limit: rowLimit,
    granularity,
    time_aggregation: timeAggregation,
    chart_type: chartType,
    show_markers: kind === 'scatter',
  });

  const handlePreview = async () => {
    if (!hasSource) {
      setError('Primero selecciona una fuente de datos en la pestana Analytical Workspace.');
      return;
    }
    setLoadingPreview(true);
    setError(null);
    try {
      const response = await runEdaPlot(buildPayload());
      setPreview(figureWithColor(response.figure_json, color));
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'No se pudo construir la vista previa.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleSave = async () => {
    let figure = preview;
    if (!figure && hasSource) {
      const response = await runEdaPlot(buildPayload());
      figure = figureWithColor(response.figure_json, color);
    }
    const nextTitle = title.trim() || `${CHART_TYPES.find((item) => item.kind === kind)?.label ?? 'Visualizacion'} ${variables.join(', ')}`;
    const payload = {
      title: nextTitle,
      description: description.trim(),
      kind,
      size,
      color,
      sourceLabel: selectedManualDatasetId ? 'Dataset manual' : `${selectedSourceIds.length} fuente(s) ETL`,
      figure: figure ?? undefined,
      config: buildPayload() as unknown as Record<string, unknown>,
    };
    if (editingCard) {
      updateCard(editingCard.id, payload);
    } else {
      addCard(payload);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-[20px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-extrabold text-slate-950">{editingCard ? 'Editar visualizacion' : 'Nueva visualizacion'}</h2>
            <p className="mt-1 text-xs text-slate-400">Paso {step} de 3</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="h-1 bg-slate-100">
          <div className="h-full rounded-full bg-[#509EE3] transition-all" style={{ width: `${(step / 3) * 100}%` }} />
        </div>

        <div className="max-h-[calc(92vh-128px)] overflow-y-auto p-6">
          {step === 1 ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-700">Tipo de grafico</h3>
                <p className="text-xs text-slate-400">Elige primero la forma de visualizacion y la fuente activa del workspace.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {CHART_TYPES.map((item) => (
                  <button
                    type="button"
                    key={item.kind}
                    onClick={() => setKind(item.kind)}
                    className={`rounded-xl border-2 p-4 text-left transition ${kind === item.kind ? 'border-[#509EE3] bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                  >
                    <div className={kind === item.kind ? 'text-[#509EE3]' : 'text-slate-500'}>{item.icon}</div>
                    <p className="mt-3 text-sm font-bold text-slate-800">{item.label}</p>
                    <p className="mt-1 text-xs text-slate-400">{item.description}</p>
                  </button>
                ))}
              </div>
              <div className={`rounded-xl border px-4 py-3 text-sm ${hasSource ? 'border-green-100 bg-green-50 text-green-800' : 'border-amber-100 bg-amber-50 text-amber-800'}`}>
                Fuente de datos: {hasSource ? `${selectedSourceIds.length} fuente(s) ETL ${selectedManualDatasetId ? '+ dataset manual' : ''}` : 'sin fuente seleccionada'}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-5 md:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-3">
                <Label>Variables para construir la visualizacion</Label>
                <Input value={variables.join(', ')} onChange={(event) => setVariables(event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} placeholder="PM25, PM10, NO2" />
                <p className="text-xs text-slate-400">Puedes escribir varias variables separadas por coma. Se usa la misma fuente y rango cargado en Analytical Workspace.</p>
              </div>
              <div className="space-y-3">
                <Label>Tamano en dashboard</Label>
                <div className="grid gap-2">
                  {SIZE_OPTIONS.map((item) => (
                    <button
                      type="button"
                      key={item.value}
                      onClick={() => setSize(item.value)}
                      className={`rounded-lg border px-3 py-2 text-left ${size === item.value ? 'border-[#509EE3] bg-blue-50' : 'border-slate-200 bg-white'}`}
                    >
                      <p className="text-sm font-bold text-slate-800">{item.label}</p>
                      <p className="text-xs text-slate-400">{item.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Titulo</Label>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Tendencia PM2.5" />
                </div>
                <div className="space-y-2">
                  <Label>Descripcion</Label>
                  <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe que decision o lectura habilita esta visualizacion." />
                </div>
                <div className="space-y-2">
                  <Label>Color</Label>
                  <div className="flex flex-wrap gap-2">
                    {PALETTE.map((item) => (
                      <button
                        type="button"
                        key={item}
                        onClick={() => setColor(item)}
                        className="h-8 w-8 rounded-full border-2 border-white shadow"
                        style={{ backgroundColor: item, outline: color === item ? `2px solid ${item}` : 'none' }}
                        aria-label={`Color ${item}`}
                      />
                    ))}
                  </div>
                </div>
                <Button type="button" variant="outline" onClick={() => void handlePreview()} disabled={loadingPreview} className="w-full">
                  {loadingPreview ? 'Construyendo vista previa...' : 'Actualizar vista previa'}
                </Button>
                {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
              </div>
              <div className="min-h-[320px] rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-400">Vista previa</p>
                {preview ? (
                  <PlotlyChart figure={preview} height={290} uirevision="dashboard-builder-preview" />
                ) : (
                  <div className="flex h-[290px] items-center justify-center rounded-lg bg-white text-center text-sm text-slate-400">
                    Genera una vista previa con la fuente y variables seleccionadas.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          {step > 1 ? (
            <Button type="button" variant="outline" onClick={() => setStep((current) => (current - 1) as 1 | 2 | 3)} className="flex-1">
              Atras
            </Button>
          ) : null}
          {step < 3 ? (
            <Button type="button" onClick={() => setStep((current) => (current + 1) as 1 | 2 | 3)} className="flex-[2] bg-[#509EE3] text-white hover:bg-[#509EE3]/90">
              Continuar
            </Button>
          ) : (
            <Button type="button" onClick={() => void handleSave()} className="flex-[2] bg-[#509EE3] text-white hover:bg-[#509EE3]/90">
              <Save className="mr-2 h-4 w-4" />
              Guardar visualizacion
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardCardView({ card }: { card: DashboardCard }) {
  const { removeCard, resizeCard, moveCard } = useDashboard();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const height = card.size === 'sm' ? 230 : card.size === 'md' ? 300 : 360;

  return (
    <>
      {editing ? <ChartBuilder editingCard={card} onClose={() => setEditing(false)} /> : null}
      <div className={`col-span-12 ${cardColumnClass(card.size)} overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm transition hover:shadow-md`}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex min-w-0 gap-2">
            <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-slate-900">{card.title}</h3>
              {card.description ? <p className="mt-1 line-clamp-2 text-xs text-slate-400">{card.description}</p> : null}
            </div>
          </div>
          <div className="relative flex shrink-0 items-center gap-1">
            {SIZE_OPTIONS.map((item) => (
              <button
                type="button"
                key={item.value}
                onClick={() => resizeCard(card.id, item.value)}
                className={`h-6 w-6 rounded-md text-[10px] font-bold ${card.size === item.value ? 'bg-[#509EE3] text-white' : 'bg-slate-50 text-slate-400'}`}
                title={item.label}
              >
                {item.columns}
              </button>
            ))}
            <button type="button" onClick={() => setMenuOpen((current) => !current)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100">
              <MoreHorizontal className="h-4 w-4 text-slate-400" />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <button type="button" onClick={() => { setEditing(true); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50">
                  <Edit3 className="h-3.5 w-3.5" /> Editar
                </button>
                <button type="button" onClick={() => moveCard(card.id, 'left')} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50">
                  <ArrowLeft className="h-3.5 w-3.5" /> Mover antes
                </button>
                <button type="button" onClick={() => moveCard(card.id, 'right')} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50">
                  <ArrowRight className="h-3.5 w-3.5" /> Mover despues
                </button>
                <button type="button" onClick={() => removeCard(card.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="p-3">
          {card.figure ? (
            <PlotlyChart figure={card.figure} height={height} uirevision={`dashboard-${card.id}`} />
          ) : (
            <div className="flex items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-400" style={{ height }}>
              Esta tarjeta no tiene una figura renderizable.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function ProjectAnalyticsDashboard() {
  const { cards } = useDashboard();
  const [showBuilder, setShowBuilder] = useState(false);
  const totalCards = cards.length;
  const wideCards = useMemo(() => cards.filter((card) => card.size === 'lg').length, [cards]);

  return (
    <div className="min-h-full bg-[#F8FAFC] p-5">
      {showBuilder ? <ChartBuilder onClose={() => setShowBuilder(false)} /> : null}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-950">Dashboard BI</h1>
          <p className="mt-1 text-sm text-slate-500">Construye un grid fluido con visualizaciones guardadas del proyecto activo.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            {totalCards} bloques · {wideCards} completos
          </div>
          <Button onClick={() => setShowBuilder(true)} className="bg-[#509EE3] text-white hover:bg-[#509EE3]/90">
            <Plus className="mr-2 h-4 w-4" />
            Agregar visualizacion
          </Button>
        </div>
      </div>

      {cards.length === 0 ? (
        <button
          type="button"
          onClick={() => setShowBuilder(true)}
          className="flex min-h-[360px] w-full flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-slate-300 bg-white/60 text-center transition hover:border-[#509EE3] hover:bg-blue-50"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-[#509EE3]">
            <BarChart3 className="h-8 w-8" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-800">Dashboard vacio</p>
            <p className="mt-1 max-w-md text-sm text-slate-400">Agrega una visualizacion nueva o envia una grafica desde el ambiente de analítica</p>
          </div>
        </button>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {cards.map((card) => (
            <DashboardCardView key={card.id} card={card} />
          ))}
          <button
            type="button"
            onClick={() => setShowBuilder(true)}
            className="col-span-12 flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-slate-300 bg-transparent text-sm font-semibold text-slate-400 transition hover:border-[#509EE3] hover:bg-blue-50 xl:col-span-4"
          >
            <Plus className="h-5 w-5" />
            Agregar visualizacion
          </button>
        </div>
      )}
    </div>
  );
}
