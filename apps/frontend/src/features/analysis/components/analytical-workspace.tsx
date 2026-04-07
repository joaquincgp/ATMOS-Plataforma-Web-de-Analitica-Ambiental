import { AnalyticalWorkspaceProvider } from '@/features/analysis/contexts/analytical-workspace-context';
import { AnalyticalWorkspaceScreen } from '@/features/analysis/components/analytical-workspace-screen';

export function AnalyticalWorkspace() {
  return (
    <AnalyticalWorkspaceProvider>
      <AnalyticalWorkspaceScreen />
    </AnalyticalWorkspaceProvider>
  );
}
