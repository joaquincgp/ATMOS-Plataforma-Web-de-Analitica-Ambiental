import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Database, FileSpreadsheet, Link2, Loader2, Sparkles } from 'lucide-react';

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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ManualDataIngestionWizardProps {
  workspaceId: string | null;
  dataset?: ManualDatasetResponse | null;
  onDatasetChange?: (dataset: ManualDatasetResponse | null) => void;
  mode?: 'full' | 'load' | 'mapping';
  loadTitle?: string;
  loadDescription?: string;
  onNotify?: (message: { type: 'error' | 'success' | 'info'; text: string }) => void;
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

type CastDataType = 'original' | 'string' | 'int' | 'float' | 'double' | 'boolean' | 'date' | 'datetime';

const CAST_TYPE_OPTIONS: { value: CastDataType; label: string }[] = [
  { value: 'original', label: 'Keep original' },
  { value: 'string', label: 'String' },
  { value: 'int', label: 'Integer' },
  { value: 'float', label: 'Float' },
  { value: 'double', label: 'Double' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Datetime' },
];

const NUMERIC_CAST_TYPES = new Set<CastDataType>(['int', 'float', 'double']);
const CATEGORICAL_CAST_TYPES = new Set<CastDataType>(['string']);
const DATE_CAST_TYPES = new Set<CastDataType>(['date', 'datetime']);

export function ManualDataIngestionWizard({
  workspaceId,
  dataset: controlledDataset,
  onDatasetChange,
  mode = 'full',
  loadTitle = 'Input',
  loadDescription = 'File or raw CSV link.',
  onNotify,
}: ManualDataIngestionWizardProps) {
  const [sourceMode, setSourceMode] = useState<'file' | 'url'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [internalDataset, setInternalDataset] = useState<ManualDatasetResponse | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ManualDatasetRoleMapping>(EMPTY_MAPPING);
  const [columnCasts, setColumnCasts] = useState<Record<string, CastDataType>>({});
  const [selectedNumericColumns, setSelectedNumericColumns] = useState<string[]>([]);
  const [selectedCategoricalColumns, setSelectedCategoricalColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const dataset = controlledDataset ?? internalDataset;
  const isControlled = controlledDataset !== undefined;
  const showLoad = mode !== 'mapping';
  const showMapping = mode !== 'load';
  const availableColumns = useMemo(() => dataset?.columns.map((column) => column.name) ?? [], [dataset]);

  const showMessage = (nextMessage: { type: 'error' | 'success'; text: string }) => {
    onNotify?.(nextMessage);
    if (!onNotify) {
      setMessage(nextMessage);
      window.setTimeout(() => {
        setMessage((current) => (current?.text === nextMessage.text ? null : current));
      }, 4500);
    }
  };

  const hydrateDataset = (nextDataset: ManualDatasetResponse) => {
    const dateRoleColumns = new Set(
      [
        nextDataset.mapping.datetime_column,
        nextDataset.mapping.date_column,
        nextDataset.mapping.time_column,
      ].filter(Boolean),
    );
    setSelectedColumns(nextDataset.columns.map((column) => column.name));
    setMapping(nextDataset.mapping);
    setColumnCasts(buildColumnCastState(nextDataset));
    setSelectedNumericColumns(
      (nextDataset.mapping.numeric_columns.length
        ? nextDataset.mapping.numeric_columns
        : nextDataset.summary.numeric_columns
      ).filter((column) => nextDataset.columns.some((item) => item.name === column)),
    );
    setSelectedCategoricalColumns(
      (nextDataset.mapping.categorical_columns.length
        ? nextDataset.mapping.categorical_columns
        : nextDataset.summary.categorical_columns
      ).filter((column) => nextDataset.columns.some((item) => item.name === column) && !dateRoleColumns.has(column)),
    );
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
      showMessage({ type: 'error', text: 'Selecciona un workspace.' });
      return;
    }
    if (sourceMode === 'file' && !selectedFile) {
      showMessage({ type: 'error', text: 'Selecciona un archivo.' });
      return;
    }
    if (sourceMode === 'url' && sourceUrl.trim() === '') {
      showMessage({ type: 'error', text: 'Ingresa un link.' });
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
      showMessage({ type: 'success', text: 'Dataset loaded.' });
    } catch (error) {
      showMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo cargar.',
      });
    } finally {
      setLoading(false);
    }
  };

  const buildPayload = () => {
    const safeSelectedColumns = selectedColumns.filter((column) => availableColumns.includes(column));
    const typeMap = buildTypeMap(columnCasts, safeSelectedColumns);
    const castNumericColumns = safeSelectedColumns.filter((column) => NUMERIC_CAST_TYPES.has(typeMap[column] as CastDataType));
    const castCategoricalColumns = safeSelectedColumns.filter((column) =>
      CATEGORICAL_CAST_TYPES.has(typeMap[column] as CastDataType),
    );
    const explicitNumericColumns = selectedNumericColumns.filter((column) => safeSelectedColumns.includes(column));
    const explicitCategoricalColumns = selectedCategoricalColumns.filter(
      (column) => safeSelectedColumns.includes(column) && !explicitNumericColumns.includes(column),
    );
    const safeNumericColumns = Array.from(new Set([...explicitNumericColumns, ...castNumericColumns]));
    const safeCategoricalColumns = Array.from(
      new Set([...explicitCategoricalColumns, ...castCategoricalColumns.filter((column) => !safeNumericColumns.includes(column))]),
    );
    const castDatetimeColumns = safeSelectedColumns.filter((column) =>
      DATE_CAST_TYPES.has(typeMap[column] as CastDataType),
    );

    const operations: ManualDatasetOperation[] = [];
    if (safeSelectedColumns.length > 0 && safeSelectedColumns.length < availableColumns.length) {
      operations.push({ type: 'select_columns', columns: safeSelectedColumns });
    }
    if (Object.keys(typeMap).length > 0) {
      operations.push({
        type: 'cast_types',
        type_map: typeMap,
        numeric_columns: safeNumericColumns,
        categorical_columns: safeCategoricalColumns,
        dayfirst: true,
        fuzzy_parse: true,
        year_default: new Date().getFullYear(),
      });
    }

    const mappedDatetimeColumn = coerceOptionalColumn(mapping.datetime_column, safeSelectedColumns);
    const fallbackDatetimeColumn = castDatetimeColumns.includes(mappedDatetimeColumn ?? '')
      ? mappedDatetimeColumn
      : castDatetimeColumns[0] ?? mappedDatetimeColumn;

    const nextMapping: ManualDatasetRoleMapping = {
      ...mapping,
      numeric_columns: safeNumericColumns,
      categorical_columns: safeCategoricalColumns,
      datetime_column: fallbackDatetimeColumn,
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
      showMessage({ type: 'success', text: 'Dataset preview updated.' });
    } catch (error) {
      showMessage({
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
      showMessage({ type: 'success', text: 'Dataset saved.' });
    } catch (error) {
      showMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo guardar.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {message && !onNotify && <FloatingNotification message={message} onClose={() => setMessage(null)} />}

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

              <CollapsibleSection title="Variables to Insert" defaultOpen>
                <ScrollArea className="h-48 rounded-md border p-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    {availableColumns.map((column) => (
                      <CheckboxRow
                        key={column}
                        checked={selectedColumns.includes(column)}
                        label={column}
                        onCheckedChange={() => {
                          toggleColumnSelection(column, selectedColumns, setSelectedColumns);
                          if (selectedColumns.includes(column)) {
                            setSelectedNumericColumns((current) => current.filter((item) => item !== column));
                            setSelectedCategoricalColumns((current) => current.filter((item) => item !== column));
                          }
                        }}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </CollapsibleSection>

              <CollapsibleSection title="Numeric and Categorical Variables" defaultOpen>
                <div className="grid gap-4 md:grid-cols-2">
                  <VariableRolePicker
                    title="Numeric variables"
                    columns={availableColumns.filter((column) => selectedColumns.includes(column))}
                    selectedColumns={selectedNumericColumns}
                    onToggle={(column) => {
                      setSelectedNumericColumns((current) => toggleColumnValue(column, current));
                      setSelectedCategoricalColumns((current) => current.filter((item) => item !== column));
                    }}
                  />
                  <VariableRolePicker
                    title="Categorical variables"
                    columns={availableColumns.filter((column) => selectedColumns.includes(column))}
                    selectedColumns={selectedCategoricalColumns}
                    onToggle={(column) => {
                      setSelectedCategoricalColumns((current) => toggleColumnValue(column, current));
                      setSelectedNumericColumns((current) => current.filter((item) => item !== column));
                    }}
                  />
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Data Casting" defaultOpen>
                <div className="h-80 rounded-md border overflow-auto">
                  <Table className="w-full min-w-[680px] table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40%]">Column</TableHead>
                        <TableHead className="w-[25%]">Current type</TableHead>
                        <TableHead className="w-[35%]">Cast to</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dataset.columns.filter((column) => selectedColumns.includes(column.name)).map((column) => (
                        <TableRow key={`cast-${column.name}`}>
                          <TableCell className="font-medium" title={column.name}>
                            <div className="truncate">{column.name}</div>
                          </TableCell>
                          <TableCell title={`${column.inferred_kind} / ${column.pandas_dtype}`}>
                            <div className="truncate text-muted-foreground">
                              {column.inferred_kind} · {column.pandas_dtype}
                            </div>
                          </TableCell>
                          <TableCell>
                            <select
                              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              value={columnCasts[column.name] ?? 'original'}
                              onChange={(event) =>
                                setColumnCasts((current) => ({
                                  ...current,
                                  [column.name]: event.target.value as CastDataType,
                                }))
                              }
                            >
                              {CAST_TYPE_OPTIONS.map((option) => (
                                <option key={`${column.name}-${option.value}`} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                        </TableRow>
                      ))}
                      {selectedColumns.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground">
                            Select at least one column.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
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
              <div className="h-72 rounded-md border overflow-auto">
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
              </div>

              <div className="h-64 rounded-md border overflow-auto">
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
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function coerceOptionalColumn(value: string | null, allowedColumns: string[]): string | null {
  if (!value) {
    return null;
  }
  return allowedColumns.includes(value) ? value : null;
}

function toggleColumnSelection(value: string, current: string[], setter: (next: string[]) => void) {
  setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
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

function VariableRolePicker({
  title,
  columns,
  selectedColumns,
  onToggle,
}: {
  title: string;
  columns: string[];
  selectedColumns: string[];
  onToggle: (column: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">{title}</Label>
        <span className="text-[11px] text-muted-foreground">{selectedColumns.length} selected</span>
      </div>
      <ScrollArea className="h-44 rounded-md border p-3">
        <div className="space-y-2">
          {columns.map((column) => (
            <CheckboxRow
              key={`${title}-${column}`}
              checked={selectedColumns.includes(column)}
              label={column}
              onCheckedChange={() => onToggle(column)}
            />
          ))}
          {columns.length === 0 && <p className="text-sm text-muted-foreground">Select columns first.</p>}
        </div>
      </ScrollArea>
    </div>
  );
}

function toggleColumnValue(value: string, current: string[]): string[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function buildTypeMap(columnCasts: Record<string, CastDataType>, allowedColumns: string[]): Record<string, string> {
  return allowedColumns.reduce<Record<string, string>>((typeMap, column) => {
    const castType = columnCasts[column];
    if (castType && castType !== 'original') {
      typeMap[column] = castType;
    }
    return typeMap;
  }, {});
}

function buildColumnCastState(dataset: ManualDatasetResponse): Record<string, CastDataType> {
  const castOperation = dataset.operation_pipeline.find((operation) => operation.type === 'cast_types');
  const typeMap = castOperation?.type_map ?? {};
  const legacyNumericColumns = new Set(castOperation?.numeric_columns ?? []);
  const legacyCategoricalColumns = new Set(castOperation?.categorical_columns ?? []);

  return dataset.columns.reduce<Record<string, CastDataType>>((casts, column) => {
    const savedType = normalizeCastDataType(typeMap[column.name]);
    if (savedType) {
      casts[column.name] = savedType;
    } else if (legacyNumericColumns.has(column.name)) {
      casts[column.name] = 'double';
    } else if (legacyCategoricalColumns.has(column.name)) {
      casts[column.name] = 'string';
    } else {
      casts[column.name] = 'original';
    }
    return casts;
  }, {});
}

function normalizeCastDataType(value: string | undefined): CastDataType | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'str' || normalized === 'text') {
    return 'string';
  }
  if (normalized === 'integer' || normalized === 'int64') {
    return 'int';
  }
  if (normalized === 'float32') {
    return 'float';
  }
  if (normalized === 'float64') {
    return 'double';
  }
  if (normalized === 'bool') {
    return 'boolean';
  }
  if (normalized === 'timestamp') {
    return 'datetime';
  }
  return CAST_TYPE_OPTIONS.some((option) => option.value === normalized) ? (normalized as CastDataType) : null;
}

function FloatingNotification({
  message,
  onClose,
}: {
  message: { type: 'error' | 'success'; text: string };
  onClose: () => void;
}) {
  const isError = message.type === 'error';
  const Icon = isError ? AlertCircle : CheckCircle2;
  return (
    <div className="fixed right-5 top-5 z-50 w-[min(420px,calc(100vw-2.5rem))] rounded-lg border bg-white p-4 shadow-lg">
      <div className="flex gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${isError ? 'text-red-600' : 'text-green-600'}`} />
        <p className={`min-w-0 flex-1 text-sm ${isError ? 'text-red-700' : 'text-foreground'}`}>{message.text}</p>
        <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
          Close
        </button>
      </div>
    </div>
  );
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
