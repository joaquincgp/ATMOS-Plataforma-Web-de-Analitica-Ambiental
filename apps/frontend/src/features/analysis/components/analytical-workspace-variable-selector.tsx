import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface VariableOption {
  code: string;
  name: string;
}

interface AnalyticalWorkspaceVariableSelectorProps {
  availableVariables: VariableOption[];
  selectedVariables: string[];
  useMulti: boolean;
  title?: string;
  helperText?: string;
  multiToggleDisabled?: boolean;
  onUseMultiChange: (value: boolean) => void;
  onSelectSingle: (value: string) => void;
  onToggleVariable: (value: string) => void;
}

export function AnalyticalWorkspaceVariableSelector({
  availableVariables,
  selectedVariables,
  useMulti,
  title = 'Variables',
  helperText,
  multiToggleDisabled = false,
  onUseMultiChange,
  onSelectSingle,
  onToggleVariable,
}: AnalyticalWorkspaceVariableSelectorProps) {
  const selectedSingle = selectedVariables[0] ?? '';

  return (
    <div className="rounded-xl border bg-[#fbfdff] p-4 space-y-3">
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
        <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto rounded-md border bg-white p-2">
          {availableVariables.map((variable) => {
            const active = selectedVariables.includes(variable.code);
            return (
              <button
                key={variable.code}
                type="button"
                onClick={() => onToggleVariable(variable.code)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  active
                    ? 'border-[#509EE3] bg-[#509EE3] text-white'
                    : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/60'
                }`}
              >
                {variable.name}
              </button>
            );
          })}
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
