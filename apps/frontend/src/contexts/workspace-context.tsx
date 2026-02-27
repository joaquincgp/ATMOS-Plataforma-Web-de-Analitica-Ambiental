import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  createWorkspace,
  listWorkspaces,
  listWorkspaceDashboards,
  saveWorkspaceDashboard,
  type DashboardResponse,
  type WorkspaceResponse,
} from '@/api/modules/workspaces';
import { useAuth } from '@/contexts/auth-context';

interface WorkspaceContextValue {
  workspaces: WorkspaceResponse[];
  activeWorkspace: WorkspaceResponse | null;
  activeWorkspaceId: string | null;
  isLoading: boolean;
  refreshWorkspaces: () => Promise<void>;
  createNewWorkspace: (payload: { name: string; description?: string }) => Promise<WorkspaceResponse>;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  getDashboards: (workspaceId: string, limit?: number) => Promise<DashboardResponse[]>;
  saveDashboard: (
    workspaceId: string,
    payload: {
      dashboard_id?: string;
      name: string;
      description?: string;
      blocks: Record<string, unknown>[];
      filters: Record<string, unknown>;
    },
  ) => Promise<DashboardResponse>;
}

const ACTIVE_WORKSPACE_KEY = 'atmos.workspace.active';
const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  });

  const setActiveWorkspaceId = useCallback((workspaceId: string | null) => {
    setActiveWorkspaceIdState(workspaceId);
    if (typeof window === 'undefined') {
      return;
    }
    if (!workspaceId) {
      window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
    }
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    if (!isAuthenticated || user?.role === 'generic') {
      setWorkspaces([]);
      setActiveWorkspaceId(null);
      return;
    }

    setIsLoading(true);
    try {
      const list = await listWorkspaces();
      setWorkspaces(list);

      if (list.length === 0) {
        setActiveWorkspaceId(null);
        return;
      }

      const activeExists = activeWorkspaceId && list.some((item) => item.id === activeWorkspaceId);
      if (!activeExists) {
        setActiveWorkspaceId(list[0].id);
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeWorkspaceId, isAuthenticated, setActiveWorkspaceId, user?.role]);

  useEffect(() => {
    if (!isAuthenticated) {
      setWorkspaces([]);
      setActiveWorkspaceId(null);
      return;
    }
    void refreshWorkspaces();
  }, [isAuthenticated, refreshWorkspaces, setActiveWorkspaceId]);

  const createNewWorkspace = useCallback(
    async (payload: { name: string; description?: string }) => {
      const workspace = await createWorkspace(payload);
      setWorkspaces((current) => [workspace, ...current]);
      setActiveWorkspaceId(workspace.id);
      return workspace;
    },
    [setActiveWorkspaceId],
  );

  const getDashboards = useCallback(async (workspaceId: string, limit = 100) => {
    return listWorkspaceDashboards(workspaceId, limit);
  }, []);

  const saveDashboardForWorkspace = useCallback(
    async (
      workspaceId: string,
      payload: {
        dashboard_id?: string;
        name: string;
        description?: string;
        blocks: Record<string, unknown>[];
        filters: Record<string, unknown>;
      },
    ) => {
      return saveWorkspaceDashboard(workspaceId, payload);
    },
    [],
  );

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspace,
      activeWorkspaceId,
      isLoading,
      refreshWorkspaces,
      createNewWorkspace,
      setActiveWorkspaceId,
      getDashboards,
      saveDashboard: saveDashboardForWorkspace,
    }),
    [
      workspaces,
      activeWorkspace,
      activeWorkspaceId,
      isLoading,
      refreshWorkspaces,
      createNewWorkspace,
      setActiveWorkspaceId,
      getDashboards,
      saveDashboardForWorkspace,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return context;
}
