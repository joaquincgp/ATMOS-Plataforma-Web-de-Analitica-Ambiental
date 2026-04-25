import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

import type { TimeAggregationMode, TimeGranularity } from '@/features/analysis/lib/analytical-workspace-config';

export interface PlotViewport {
  from: string | null;
  to: string | null;
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
  const [rowLimit, setRowLimit] = useState(50000);
  const [plotViewport, setPlotViewport] = useState<PlotViewport>({ from: null, to: null });
  const [granularity, setGranularity] = useState<TimeGranularity>('day');
  const [timeAggregation, setTimeAggregation] = useState<TimeAggregationMode>('mean');

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
