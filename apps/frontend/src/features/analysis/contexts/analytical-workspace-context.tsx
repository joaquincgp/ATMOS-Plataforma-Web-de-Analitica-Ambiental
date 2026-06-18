import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

import { getAppConfig } from '@/api/modules/app-config';
import type { TimeAggregationMode, TimeGranularity } from '@/features/analysis/lib/analytical-workspace-config';

export interface PlotViewport {
  from: string | null;
  to: string | null;
}

export interface WorkspaceVariableOption {
  code: string;
  name: string;
  inferredKind?: string;
}

interface AnalyticalWorkspaceStateValue {
  selectedSourceIds: number[];
  setSelectedSourceIds: Dispatch<SetStateAction<number[]>>;
  selectedManualDatasetId: string | null;
  setSelectedManualDatasetId: Dispatch<SetStateAction<string | null>>;
  selectedStations: string[];
  setSelectedStations: Dispatch<SetStateAction<string[]>>;
  selectedVariables: string[];
  setSelectedVariables: Dispatch<SetStateAction<string[]>>;
  dateFrom: string;
  setDateFrom: Dispatch<SetStateAction<string>>;
  dateTo: string;
  setDateTo: Dispatch<SetStateAction<string>>;
  rangePreset: string;
  setRangePreset: Dispatch<SetStateAction<string>>;
  sourceSearch: string;
  setSourceSearch: Dispatch<SetStateAction<string>>;
  rowLimit: number;
  setRowLimit: Dispatch<SetStateAction<number>>;
  plotViewport: PlotViewport;
  setPlotViewport: Dispatch<SetStateAction<PlotViewport>>;
  granularity: TimeGranularity;
  setGranularity: Dispatch<SetStateAction<TimeGranularity>>;
  timeAggregation: TimeAggregationMode;
  setTimeAggregation: Dispatch<SetStateAction<TimeAggregationMode>>;
  availableVariables: WorkspaceVariableOption[];
  setAvailableVariables: Dispatch<SetStateAction<WorkspaceVariableOption[]>>;
}

const AnalyticalWorkspaceContext = createContext<AnalyticalWorkspaceStateValue | undefined>(undefined);

export function AnalyticalWorkspaceProvider({ children }: { children: ReactNode }) {
  const [selectedSourceIds, setSelectedSourceIds] = useState<number[]>([]);
  const [selectedManualDatasetId, setSelectedManualDatasetId] = useState<string | null>(null);
  const [selectedStations, setSelectedStations] = useState<string[]>([]);
  const [selectedVariables, setSelectedVariables] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rangePreset, setRangePreset] = useState('all');
  const [sourceSearch, setSourceSearch] = useState('');
  const [rowLimit, setRowLimit] = useState(5000);
  const [plotViewport, setPlotViewport] = useState<PlotViewport>({ from: null, to: null });
  const [granularity, setGranularity] = useState<TimeGranularity>('day');
  const [timeAggregation, setTimeAggregation] = useState<TimeAggregationMode>('mean');
  const [availableVariables, setAvailableVariables] = useState<WorkspaceVariableOption[]>([]);

  useEffect(() => {
    const loadQueryLimit = async () => {
      try {
        const response = await getAppConfig();
        const defaultLimit = response.items.find((item) => item.key === 'analytics.default_query_limit')?.value;
        if (typeof defaultLimit === 'number') {
          setRowLimit(Math.max(100, Math.floor(defaultLimit)));
        }
      } catch {
        // Keep the compiled default when configuration cannot be loaded.
      }
    };
    void loadQueryLimit();
  }, []);

  return (
    <AnalyticalWorkspaceContext.Provider
      value={{
        selectedSourceIds,
        setSelectedSourceIds,
        selectedManualDatasetId,
        setSelectedManualDatasetId,
        selectedStations,
        setSelectedStations,
        selectedVariables,
        setSelectedVariables,
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
        plotViewport,
        setPlotViewport,
        granularity,
        setGranularity,
        timeAggregation,
        setTimeAggregation,
        availableVariables,
        setAvailableVariables,
      }}
    >
      {children}
    </AnalyticalWorkspaceContext.Provider>
  );
}

export function useAnalyticalWorkspaceState() {
  const context = useContext(AnalyticalWorkspaceContext);
  if (!context) {
    throw new Error('useAnalyticalWorkspaceState must be used within AnalyticalWorkspaceProvider');
  }
  return context;
}
