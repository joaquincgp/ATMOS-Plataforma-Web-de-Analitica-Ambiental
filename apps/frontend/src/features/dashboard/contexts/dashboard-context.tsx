import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type DashboardCardSize = 'sm' | 'md' | 'lg';
export type DashboardChartKind = 'line' | 'bar' | 'scatter' | 'heatmap' | 'histogram' | 'box' | 'violin' | 'kpi' | 'plotly';

export interface DashboardFigure {
  data?: unknown[];
  layout?: Record<string, unknown>;
  frames?: unknown[];
}

export interface DashboardCard {
  id: string;
  title: string;
  description?: string;
  kind: DashboardChartKind;
  size: DashboardCardSize;
  color?: string;
  createdAt: string;
  sourceLabel?: string;
  figure?: DashboardFigure;
  config?: Record<string, unknown>;
}

interface DashboardContextValue {
  cards: DashboardCard[];
  addCard: (card: Omit<DashboardCard, 'id' | 'createdAt'> & { id?: string }) => DashboardCard;
  updateCard: (id: string, patch: Partial<Omit<DashboardCard, 'id' | 'createdAt'>>) => void;
  removeCard: (id: string) => void;
  resizeCard: (id: string, size: DashboardCardSize) => void;
  moveCard: (id: string, direction: 'left' | 'right') => void;
}

const DashboardContext = createContext<DashboardContextValue | undefined>(undefined);

function storageKey(projectId: string | null) {
  return `atmos:bi-dashboard:${projectId ?? 'global'}`;
}

function safeParseCards(value: string | null): DashboardCard[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function DashboardProvider({ projectId, children }: { projectId: string | null; children: ReactNode }) {
  const [cards, setCards] = useState<DashboardCard[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setCards([]);
      return;
    }
    setCards(safeParseCards(window.localStorage.getItem(storageKey(projectId))));
  }, [projectId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(cards));
  }, [cards, projectId]);

  const addCard = useCallback<DashboardContextValue['addCard']>((card) => {
    const next: DashboardCard = {
      ...card,
      id: card.id ?? `dash-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
    };
    setCards((current) => [next, ...current]);
    return next;
  }, []);

  const updateCard = useCallback<DashboardContextValue['updateCard']>((id, patch) => {
    setCards((current) => current.map((card) => (card.id === id ? { ...card, ...patch } : card)));
  }, []);

  const removeCard = useCallback((id: string) => {
    setCards((current) => current.filter((card) => card.id !== id));
  }, []);

  const resizeCard = useCallback((id: string, size: DashboardCardSize) => {
    updateCard(id, { size });
  }, [updateCard]);

  const moveCard = useCallback((id: string, direction: 'left' | 'right') => {
    setCards((current) => {
      const index = current.findIndex((card) => card.id === id);
      if (index === -1) return current;
      const targetIndex = direction === 'left' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      const [card] = next.splice(index, 1);
      next.splice(targetIndex, 0, card);
      return next;
    });
  }, []);

  const value = useMemo<DashboardContextValue>(
    () => ({ cards, addCard, updateCard, removeCard, resizeCard, moveCard }),
    [addCard, cards, moveCard, removeCard, resizeCard, updateCard],
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within DashboardProvider');
  }
  return context;
}

export function useOptionalDashboard() {
  return useContext(DashboardContext);
}
