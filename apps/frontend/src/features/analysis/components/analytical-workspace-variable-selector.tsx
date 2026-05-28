import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AnalysisHelpCard } from '@/features/analysis/components/analysis-help-card';

interface VariableOption {
  code: string;
  name: string;
}

type MappingSlot = 'x' | 'y' | 'fill' | 'color' | 'size' | 'group' | 'facet';

interface AnalyticalWorkspaceVariableSelectorProps {
  availableVariables: VariableOption[];
  selectedVariables: string[];
  useMulti: boolean;
  title?: string;
  helperText?: string;
  multiToggleDisabled?: boolean;
  mappingValues?: Partial<Record<MappingSlot, string>>;
  onMappingChange?: (slot: MappingSlot, value: string) => void;
  onUseMultiChange: (value: boolean) => void;
  onSelectSingle: (value: string) => void;
  onToggleVariable: (value: string) => void;
}

const VARIABLE_COLORS = [
  { bg: '#0B5EA8', border: '#0B5EA8', soft: '#eef6ff', text: '#0B5EA8' },
  { bg: '#F05A28', border: '#F05A28', soft: '#fff3ed', text: '#C2410C' },
  { bg: '#0B7285', border: '#0B7285', soft: '#ecfeff', text: '#0B7285' },
  { bg: '#16A34A', border: '#16A34A', soft: '#f0fdf4', text: '#15803D' },
  { bg: '#7C3AED', border: '#7C3AED', soft: '#f5f3ff', text: '#6D28D9' },
  { bg: '#A16207', border: '#A16207', soft: '#fffbeb', text: '#92400E' },
  { bg: '#DB2777', border: '#DB2777', soft: '#fdf2f8', text: '#BE185D' },
  { bg: '#475569', border: '#475569', soft: '#f8fafc', text: '#334155' },
];

const SLOT_HELP: Record<MappingSlot, { label: string; description: string; enabled: boolean }> = {
  x: {
    label: 'X',
    enabled: true,
    description: 'Define la variable horizontal. En series temporales normalmente es fecha; en dispersión puede ser cualquier variable numérica.',
  },
  y: {
    label: 'Y',
    enabled: true,
    description: 'Define la variable vertical o valor principal del gráfico. Para histogramas univariados se usa como variable de análisis.',
  },
  fill: {
    label: 'Fill',
    enabled: false,
    description: 'Reservado para relleno de barras, áreas o histogramas. En esta implementación Plotly usa Color como canal equivalente de agrupación/relleno.',
  },
  color: {
    label: 'Color',
    enabled: true,
    description: 'Agrupa o colorea marcas, líneas o barras mediante una variable. Funciona como Hue en Plotly Express.',
  },
  size: {
    label: 'Size',
    enabled: false,
    description: 'Reservado para tamaño por variable. Actualmente el tamaño de puntos se controla con el ajuste global Marker size para evitar escalas engañosas.',
  },
  group: {
    label: 'Group',
    enabled: false,
    description: 'Reservado para agrupar trazas sin colorearlas. Actualmente el agrupamiento inferido se obtiene con Color y Facet.',
  },
  facet: {
    label: 'Facet',
    enabled: true,
    description: 'Divide el gráfico en paneles por categorías. Se conecta al control Facet Col para comparar subconjuntos lado a lado.',
  },
};

export function AnalyticalWorkspaceVariableSelector({
  availableVariables,
  selectedVariables,
  useMulti,
  title = 'Variables',
  helperText,
  multiToggleDisabled = false,
  mappingValues,
  onMappingChange,
  onUseMultiChange,
  onSelectSingle,
  onToggleVariable,
}: AnalyticalWorkspaceVariableSelectorProps) {
  const selectedSingle = selectedVariables[0] ?? '';
  const getVariableLabel = (code: string) => availableVariables.find((item) => item.code === code)?.name ?? code;

  return (
    <div className="rounded-lg border bg-[#fbfdff] p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label className="text-xs">{title}</Label>
          {helperText && <p className="text-[11px] text-muted-foreground">{helperText}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground">Multiple</span>
          <Switch
            checked={useMulti}
            onCheckedChange={onUseMultiChange}
            disabled={multiToggleDisabled || availableVariables.length <= 1}
          />
        </div>
      </div>

      {useMulti ? (
        <div className="space-y-2">
          <div className="flex min-h-10 flex-wrap gap-1.5 rounded-md border border-dashed border-[#9cc9f2] bg-white p-2">
            {selectedVariables.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">Select variables for this analysis</span>
            ) : (
              selectedVariables.map((code, index) => {
                const variableColor = VARIABLE_COLORS[index % VARIABLE_COLORS.length];
                return (
                  <button
                    key={`selected-${code}`}
                    type="button"
                    onClick={() => onToggleVariable(code)}
                    className="rounded-full border px-2.5 py-1 text-[11px] font-medium text-white shadow-sm"
                    style={{ borderColor: variableColor.border, backgroundColor: variableColor.bg }}
                    title="Click to remove"
                  >
                    {getVariableLabel(code)} x
                  </button>
                );
              })
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4 xl:grid-cols-7">
            {(Object.keys(SLOT_HELP) as MappingSlot[]).map((slot) => {
              const slotInfo = SLOT_HELP[slot];
              const slotValue = mappingValues?.[slot] ?? '';
              const enabled = slotInfo.enabled && Boolean(onMappingChange);
              return (
                <div
                  key={slot}
                  className={`min-h-12 rounded-md border border-dashed px-2 py-2 ${
                    enabled ? 'border-[#9cc9f2] bg-white' : 'border-[#d8e2ee] bg-[#f8fafc]'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#1F2937]">{slotInfo.label}</span>
                    <AnalysisHelpCard title={slotInfo.label} description={slotInfo.description} />
                  </div>
                  {enabled ? (
                    <Select value={slotValue || '__none__'} onValueChange={(value) => onMappingChange?.(slot, value === '__none__' ? '' : value)}>
                      <SelectTrigger className="h-7 border-0 bg-transparent px-0 text-[11px] shadow-none focus:ring-0">
                        <SelectValue placeholder="Drop" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Drop</SelectItem>
                        {availableVariables.map((variable) => (
                          <SelectItem key={`${slot}-${variable.code}`} value={variable.code}>
                            {variable.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="block truncate text-muted-foreground">Not used</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex max-h-[78px] flex-wrap gap-1.5 overflow-y-auto rounded-md border bg-white p-2">
            {availableVariables.map((variable) => {
              const active = selectedVariables.includes(variable.code);
              const activeIndex = selectedVariables.indexOf(variable.code);
              const variableColor = activeIndex >= 0 ? VARIABLE_COLORS[activeIndex % VARIABLE_COLORS.length] : null;
              return (
                <button
                  key={variable.code}
                  type="button"
                  onClick={() => onToggleVariable(variable.code)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors hover:border-[#509EE3]/60 ${
                    active ? '' : 'border-gray-300 bg-white text-foreground'
                  }`}
                  style={
                    active && variableColor
                      ? { borderColor: variableColor.border, backgroundColor: variableColor.soft, color: variableColor.text }
                      : undefined
                  }
                >
                  {variable.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <Select value={selectedSingle} onValueChange={onSelectSingle} disabled={availableVariables.length === 0}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Select variable" />
          </SelectTrigger>
          <SelectContent>
            {availableVariables.map((variable) => (
              <SelectItem key={variable.code} value={variable.code}>
                {variable.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
