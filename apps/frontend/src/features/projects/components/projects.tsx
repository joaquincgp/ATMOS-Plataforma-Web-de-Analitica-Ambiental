import { useMemo, useState } from 'react';
import { FolderOpen, Plus, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWorkspace } from '@/contexts/workspace-context';

interface ProjectsProps {
  onSelectProject: (projectId: string) => void;
}

export function Projects({ onSelectProject }: ProjectsProps) {
  const { workspaces, isLoading, createNewWorkspace, refreshWorkspaces } = useWorkspace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const orderedWorkspaces = useMemo(
    () => [...workspaces].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [workspaces],
  );

  const handleCreateWorkspace = async () => {
    if (!name.trim()) {
      setError('Workspace name is required.');
      return;
    }

    setError(null);
    try {
      const workspace = await createNewWorkspace({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setName('');
      setDescription('');
      onSelectProject(workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create workspace.');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#F9FBFC]">
      <div className="px-8 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground mb-2">Workspaces</h1>
          <p className="text-muted-foreground">Schema-isolated project environments per account.</p>
        </div>

        <Card className="bg-white border-[#dce5f1]">
          <CardHeader>
            <CardTitle className="text-lg">Create Workspace</CardTitle>
            <CardDescription>Creates dedicated PostgreSQL schema and isolated storage paths.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="workspace-name">Name</Label>
                <Input
                  id="workspace-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Quito South Analysis"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="workspace-description">Description</Label>
                <Input
                  id="workspace-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional description"
                />
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex items-center gap-2">
              <Button
                onClick={() => void handleCreateWorkspace()}
                className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create
              </Button>

              <Button variant="outline" onClick={() => void refreshWorkspaces()} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {orderedWorkspaces.map((workspace) => (
            <Card key={workspace.id} className="bg-white border-border hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle className="text-lg mb-1">{workspace.name}</CardTitle>
                <CardDescription className="text-xs">Schema: {workspace.schema_name}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground line-clamp-2">{workspace.description || 'No description provided.'}</p>
                <p className="text-xs text-muted-foreground">
                  Updated: {new Date(workspace.updated_at).toLocaleString()}
                </p>
                <Button
                  onClick={() => onSelectProject(workspace.id)}
                  className="w-full bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Open Workspace
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {orderedWorkspaces.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground">No workspaces yet. Create one to start analyzing data.</p>
        )}
      </div>
    </div>
  );
}
