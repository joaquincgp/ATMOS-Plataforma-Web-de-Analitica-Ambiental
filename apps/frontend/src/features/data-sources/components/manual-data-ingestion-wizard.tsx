import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Database, FileSpreadsheet, Link2, Loader2, Sparkles } from 'lucide-react';

import {
  createManualDatasetFromUrl,
  finalizeManualDataset,
  previewManualDataset,
  type ManualDatasetOperation,
  type ManualDatasetResponse,
  type ManualDatasetRoleMapping,
  uploadManualDataset,
} from '@/api/modules/etl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ManualDataIngestionWizardProps {
  workspaceId: string | null;
  dataset?: ManualDatasetResponse | null;
  onDatasetChange?: (dataset: ManualDatasetResponse | null) => void;
  mode?: 'full' | 'load' | 'mapping';
  loadTitle?: string;
  loadDescription?: string;
}

const EMPTY_MAPPING: ManualDatasetRoleMapping = {
  numeric_columns: [],
  categorical_columns: [],
  datetime_column: null,
  date_column: null,
  time_column: null,
  station_code_column: null,
  variable_code_column: null,
  value_column: null,
  unit_column: null,
  normalized_datetime_column_name: 'observed_at',
};

export function ManualDataIngestionWizard({
  workspaceId,
  dataset: controlledDataset,
  onDatasetChange,
  mode = 'full',
  loadTitle = 'Input',
  loadDescription = 'File or raw CSV link.',
}: ManualDataIngestionWizardProps) {
  const [sourceMode, setSourceMode] = useState<'file' | 'url'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [internalDataset, setInternalDataset] = useState<ManualDatasetResponse | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [numericColumns, setNumericColumns] = useState<string[]>([]);
  const [categoricalColumns, setCategoricalColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ManualDatasetRoleMapping>(EMPTY_MAPPING);
  const [samplePct, setSamplePct] = useState(100);
  const [meltEnabled, setMeltEnabled] = useState(false);
  const [meltIdVars, setMeltIdVars] = useState<string[]>([]);
  const [dateFeaturesEnabled, setDateFeaturesEnabled] = useState(false);
  const [dateFeatureColumn, setDateFeatureColumn] = useState('');
  const [dateFeatureDayFirst, setDateFeatureDayFirst] = useState(true);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const dataset = controlledDataset ?? internalDataset;
  const isControlled = controlledDataset !== undefined;
  const showLoad = mode !== 'mapping';
  const showMapping = mode !== 'load';
  const availableColumns = useMemo(() => dataset?.columns.map((column) => column.name) ?? [], [dataset]);

  const hydrateDataset = (nextDataset: ManualDatasetResponse) => {
    setSelectedColumns(nextDataset.columns.map((column) => column.name));
    setNumericColumns(nextDataset.mapping.numeric_columns);
    setCategoricalColumns(nextDataset.mapping.categorical_columns);
    setMapping(nextDataset.mapping);
    setSamplePct(extractSamplePct(nextDataset.operation_pipeline));

    const meltOperation = nextDataset.operation_pipeline.find((operation) => operation.type === 'melt');
    setMeltEnabled(Boolean(meltOperation));
    setMeltIdVars(meltOperation?.id_vars ?? []);

    const dateFeatureOperation = nextDataset.operation_pipeline.find((operation) => operation.type === 'date_features');
    setDateFeaturesEnabled(Boolean(dateFeatureOperation));
    setDateFeatureColumn(dateFeatureOperation?.date_column ?? nextDataset.mapping.datetime_column ?? '');
    setDateFeatureDayFirst(dateFeatureOperation?.dayfirst ?? true);
  };

  const syncLocalState = (nextDataset: ManualDatasetResponse) => {
    if (!isControlled) {
      setInternalDataset(nextDataset);
    }
    onDatasetChange?.(nextDataset);
    hydrateDataset(nextDataset);
  };

  useEffect(() => {
    if (!dataset) {
      return;
    }
    hydrateDataset(dataset);
  }, [dataset]);

  const handleLoad = async () => {
    if (!workspaceId) {
      setMessage({ type: 'error', text: 'Selecciona un workspace.' });
      return;
    }
    if (sourceMode === 'file' && !selectedFile) {
      setMessage({ type: 'error', text: 'Selecciona un archivo.' });
      return;
    }
    if (sourceMode === 'url' && sourceUrl.trim() === '') {
      setMessage({ type: 'error', text: 'Ingresa un link.' });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const nextDataset =
        sourceMode === 'file' && selectedFile
          ? await uploadManualDataset(workspaceId, selectedFile)
          : await createManualDatasetFromUrl({ workspace_id: workspaceId, source_url: sourceUrl.trim() });
      syncLocalState(nextDataset);
      setMessage({ type: 'success', text: 'Cargado.' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo cargar.',
      });
    } finally {
      setLoading(false);
    }
  };

  const buildPayload = () => {
    const safeSelectedColumns = selectedColumns.filter((column) => availableColumns.includes(column));
    const safeNumericColumns = numericColumns.filter((column) => safeSelectedColumns.includes(column));
    const safeCategoricalColumns = categoricalColumns.filter((column) => safeSelectedColumns.includes(column));

    const operations: ManualDatasetOperation[] = [];
    if (safeSelectedColumns.length > 0 && safeSelectedColumns.length < availableColumns.length) {
      operations.push({ type: 'select_columns', columns: safeSelectedColumns });
    }
    operations.push({
      type: 'cast_types',
      numeric_columns: safeNumericColumns,
      categorical_columns: safeCategoricalColumns,
    });
    if (samplePct < 100) {
      operations.push({ type: 'subsample', sample_pct: samplePct });
    }
    if (meltEnabled && meltIdVars.length > 0) {
      operations.push({
        type: 'melt',
        id_vars: meltIdVars.filter((column) => safeSelectedColumns.includes(column)),
        var_name: 'variable',
        value_name: 'value',
      });
    }
    if (dateFeaturesEnabled && dateFeatureColumn) {
      operations.push({
        type: 'date_features',
        date_column: dateFeatureColumn,
        dayfirst: dateFeatureDayFirst,
      });
    }

    const nextMapping: ManualDatasetRoleMapping = {
      ...mapping,
      numeric_columns: safeNumericColumns,
      categorical_columns: safeCategoricalColumns,
      datetime_column: coerceOptionalColumn(mapping.datetime_column, safeSelectedColumns),
      date_column: coerceOptionalColumn(mapping.date_column, safeSelectedColumns),
      time_column: coerceOptionalColumn(mapping.time_column, safeSelectedColumns),
      station_code_column: coerceOptionalColumn(mapping.station_code_column, safeSelectedColumns),
      variable_code_column: coerceOptionalColumn(mapping.variable_code_column, safeSelectedColumns),
      value_column: coerceOptionalColumn(mapping.value_column, safeSelectedColumns),
      unit_column: coerceOptionalColumn(mapping.unit_column, safeSelectedColumns),
    };

    return { operation_pipeline: operations, mapping: nextMapping };
  };

  const handleApply = async () => {
    if (!dataset) {
      return;
    }

    setPreviewing(true);
    setMessage(null);
    try {
      const nextDataset = await previewManualDataset(dataset.id, buildPayload());
      syncLocalState(nextDataset);
      setMessage({ type: 'success', text: 'Actualizado.' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo actualizar.',
      });
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    if (!dataset) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const nextDataset = await finalizeManualDataset(dataset.id, buildPayload());
      syncLocalState(nextDataset);
      setMessage({ type: 'success', text: 'Guardado.' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo guardar.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {showLoad && (
        <Card className="bg-white border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-[#509EE3]" />
              {loadTitle}
            </CardTitle>
            <CardDescription>{loadDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!workspaceId && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Select a workspace.
              </div>
            )}

          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setSourceMode('file')}
              className={`rounded-2xl border p-5 text-left transition-colors ${
                sourceMode === 'file' ? 'border-[#509EE3] bg-[#509EE3]/5' : 'border-border bg-white'
              }`}
            >
              <div className="mb-3 inline-flex rounded-2xl bg-[#509EE3]/10 p-3">
                <FileSpreadsheet className="h-6 w-6 text-[#509EE3]" />
              </div>
              <div className="text-sm font-medium text-foreground">File</div>
              <p className="mt-1 text-sm text-muted-foreground">CSV, XLSX or TXT.</p>
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('url')}
              className={`rounded-2xl border p-5 text-left transition-colors ${
                sourceMode === 'url' ? 'border-[#509EE3] bg-[#509EE3]/5' : 'border-border bg-white'
              }`}
            >
              <div className="mb-3 inline-flex rounded-2xl bg-[#509EE3]/10 p-3">
                <Link2 className="h-6 w-6 text-[#509EE3]" />
              </div>
              <div className="text-sm font-medium text-foreground">Link</div>
              <p className="mt-1 text-sm text-muted-foreground">Raw CSV.</p>
            </button>
          </div>

            {sourceMode === 'file' ? (
              <div className="space-y-2">
                <Label htmlFor="manual-dataset-file">File</Label>
                <Input
                  id="manual-dataset-file"
                  type="file"
                  accept=".csv,.xlsx,.xls,.txt"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
                {selectedFile && <p className="text-xs text-muted-foreground">{selectedFile.name}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="manual-dataset-url">Link</Label>
                <Input
                  id="manual-dataset-url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://raw.githubusercontent.com/.../dataset.csv"
                />
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={() => void handleLoad()}
                disabled={loading || !workspaceId}
                className="bg-[#509EE3] text-white hover:bg-[#509EE3]/90"
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                {loading ? 'Loading...' : 'Load'}
              </Button>
            </div>

          </CardContent>
        </Card>
      )}

      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            message.type === 'error'
              ? 'border border-red-200 bg-red-50 text-red-700'
              : 'border border-green-200 bg-green-50 text-green-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {showMapping && dataset && (
        <>
          <Card className="bg-white border-border">
            <CardHeader>
              <CardTitle className="text-base">Mapping</CardTitle>
              <CardDescription>Columns, roles and options.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Metric label="Rows" value={String(dataset.summary.row_count)} />
                <Metric label="Columns" value={String(dataset.summary.column_count)} />
              </div>

              <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                {dataset.source_url ?? dataset.original_file_name}
              </div>

              <CollapsibleSection title="Columns" defaultOpen>
                <div className="space-y-4">
                  <ScrollArea className="h-44 rounded-md border p-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      {availableColumns.map((column) => (
                        <CheckboxRow
                          key={column}
                          checked={selectedColumns.includes(column)}
                          label={column}
                          onCheckedChange={() => toggleItem(column, selectedColumns, setSelectedColumns)}
                        />
                      ))}
                    </div>
                  </ScrollArea>

                  <div className="grid gap-4 md:grid-cols-2">
                    <ColumnPicker
                      title="Numeric"
                      columns={selectedColumns}
                      selected={numericColumns}
                      onToggle={(column) => {
                        toggleItem(column, numericColumns, setNumericColumns);
                        setCategoricalColumns((current) => current.filter((item) => item !== column));
                      }}
                    />
                    <ColumnPicker
                      title="Categorical"
                      columns={selectedColumns}
                      selected={categoricalColumns}
                      onToggle={(column) => {
                        toggleItem(column, categoricalColumns, setCategoricalColumns);
                        setNumericColumns((current) => current.filter((item) => item !== column));
                      }}
                    />
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Roles">
                <div className="grid gap-4 md:grid-cols-2">
                  <MappingSelect
                    label="Datetime"
                    value={mapping.datetime_column}
                    options={selectedColumns}
                    onChange={(value) => setMapping((current) => ({ ...current, datetime_column: value }))}
                  />
                  <MappingSelect
                    label="Date"
                    value={mapping.date_column}
                    options={selectedColumns}
                    onChange={(value) => setMapping((current) => ({ ...current, date_column: value }))}
                  />
                  <MappingSelect
                    label="Time"
                    value={mapping.time_column}
                    options={selectedColumns}
                    onChange={(value) => setMapping((current) => ({ ...current, time_column: value }))}
                  />
                  <MappingSelect
                    label="Station"
                    value={mapping.station_code_column}
                    options={selectedColumns}
                    onChange={(value) => setMapping((current) => ({ ...current, station_code_column: value }))}
                  />
                  <MappingSelect
                    label="Variable"
                    value={mapping.variable_code_column}
                    options={selectedColumns}
                    onChange={(value) => setMapping((current) => ({ ...current, variable_code_column: value }))}
                  />
                  <MappingSelect
                    label="Value"
                    value={mapping.value_column}
                    options={selectedColumns}
                    onChange={(value) => setMapping((current) => ({ ...current, value_column: value }))}
                  />
                  <MappingSelect
                    label="Unit"
                    value={mapping.unit_column}
                    options={selectedColumns}
                    onChange={(value) => setMapping((current) => ({ ...current, unit_column: value }))}
                  />
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Options">
                <div className="grid gap-6 lg:grid-cols-3">
                  <div className="space-y-3">
                    <SectionTitle title="Subsample" />
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={samplePct}
                      onChange={(event) => setSamplePct(Math.max(1, Math.min(100, Number(event.target.value) || 100)))}
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <SectionTitle title="Melt" />
                      <Switch checked={meltEnabled} onCheckedChange={setMeltEnabled} />
                    </div>
                    <ScrollArea className="h-28 rounded-md border p-3">
                      <div className="grid gap-2">
                        {selectedColumns.map((column) => (
                          <CheckboxRow
                            key={`melt-${column}`}
                            checked={meltIdVars.includes(column)}
                            label={column}
                            onCheckedChange={() => toggleItem(column, meltIdVars, setMeltIdVars)}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <SectionTitle title="Date Features" />
                      <Switch checked={dateFeaturesEnabled} onCheckedChange={setDateFeaturesEnabled} />
                    </div>
                    <MappingSelect
                      label="Source"
                      value={dateFeatureColumn || null}
                      options={selectedColumns}
                      onChange={(value) => setDateFeatureColumn(value ?? '')}
                    />
                    <div className="flex items-center gap-2">
                      <Checkbox checked={dateFeatureDayFirst} onCheckedChange={(checked) => setDateFeatureDayFirst(checked === true)} />
                      <span className="text-sm text-muted-foreground">Day first</span>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>

              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => void handleApply()} disabled={previewing}>
                  {previewing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Apply
                </Button>
                <Button onClick={() => void handleSave()} disabled={saving} className="bg-[#509EE3] text-white hover:bg-[#509EE3]/90">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-border">
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
              <CardDescription>Filas y columnas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <ScrollArea className="h-72 rounded-md border">
                <Table className="w-max min-w-full table-fixed">
                  <TableHeader>
                    <TableRow>
                      {dataset.columns.map((column) => (
                        <TableHead key={column.name} className="min-w-[180px] max-w-[220px]">
                          {column.name}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dataset.preview_rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={Math.max(1, dataset.columns.length)} className="text-center text-muted-foreground">
                          No rows.
                        </TableCell>
                      </TableRow>
                    ) : (
                      dataset.preview_rows.map((row, index) => (
                        <TableRow key={`preview-${index}`}>
                          {dataset.columns.map((column) => (
                            <TableCell
                              key={`${index}-${column.name}`}
                              className="max-w-[220px]"
                              title={stringifyCell(row[column.name])}
                            >
                              <div className="max-w-[220px] truncate whitespace-nowrap">
                                {stringifyCell(row[column.name])}
                              </div>
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>

              <ScrollArea className="h-64 rounded-md border">
                <Table className="w-max min-w-full table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Column</TableHead>
                      <TableHead className="w-[120px]">Kind</TableHead>
                      <TableHead className="w-[140px]">Dtype</TableHead>
                      <TableHead className="w-[90px]">Nulls</TableHead>
                      <TableHead className="w-[90px]">Unique</TableHead>
                      <TableHead className="w-[260px]">Samples</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dataset.columns.map((column) => (
                      <TableRow key={`profile-${column.name}`}>
                        <TableCell className="font-medium" title={column.name}>
                          <div className="max-w-[180px] truncate">{column.name}</div>
                        </TableCell>
                        <TableCell title={column.inferred_kind}>
                          <div className="max-w-[120px] truncate">{column.inferred_kind}</div>
                        </TableCell>
                        <TableCell title={column.pandas_dtype}>
                          <div className="max-w-[140px] truncate">{column.pandas_dtype}</div>
                        </TableCell>
                        <TableCell>{column.null_count}</TableCell>
                        <TableCell>{column.unique_count}</TableCell>
                        <TableCell title={column.sample_values.join(', ') || '—'}>
                          <div className="max-w-[260px] truncate">{column.sample_values.join(', ') || '—'}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function extractSamplePct(operations: ManualDatasetOperation[]): number {
  const subsample = operations.find((operation) => operation.type === 'subsample');
  return subsample?.sample_pct ?? 100;
}

function coerceOptionalColumn(value: string | null, allowedColumns: string[]): string | null {
  if (!value) {
    return null;
  }
  return allowedColumns.includes(value) ? value : null;
}

function toggleItem(value: string, current: string[], setter: (next: string[]) => void) {
  setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <p className="text-sm font-medium text-foreground">{title}</p>;
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="rounded-md border px-4 py-3">
      <summary className="cursor-pointer list-none text-sm font-medium text-foreground">{title}</summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

function CheckboxRow({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <Checkbox checked={checked} onCheckedChange={() => onCheckedChange()} />
      <span>{label}</span>
    </label>
  );
}

function ColumnPicker({
  title,
  columns,
  selected,
  onToggle,
}: {
  title: string;
  columns: string[];
  selected: string[];
  onToggle: (column: string) => void;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-3 text-sm font-medium text-foreground">{title}</p>
      <ScrollArea className="h-40">
        <div className="grid gap-2">
          {columns.map((column) => (
            <CheckboxRow
              key={`${title}-${column}`}
              checked={selected.includes(column)}
              label={column}
              onCheckedChange={() => onToggle(column)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function MappingSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <select
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        value={value ?? '__none__'}
        onChange={(event) => onChange(event.target.value === '__none__' ? null : event.target.value)}
      >
        <option value="__none__">None</option>
        {options.map((option) => (
          <option key={`${label}-${option}`} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
