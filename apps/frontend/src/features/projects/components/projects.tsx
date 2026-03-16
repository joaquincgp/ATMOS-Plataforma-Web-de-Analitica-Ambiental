import { useMemo, useState } from 'react';
import { Check, FolderOpen, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWorkspace } from '@/contexts/workspace-context';

interface ProjectsProps {
  onSelectProject: (projectId: string) => void;
}

export function Projects({ onSelectProject }: ProjectsProps) {
  const {
    workspaces,
    isLoading,
    createNewWorkspace,
    updateExistingWorkspace,
    deleteExistingWorkspace,
    refreshWorkspaces,
  } = useWorkspace();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [busyWorkspaceId, setBusyWorkspaceId] = useState<string | null>(null);

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

  const startEditing = (workspaceId: string, workspaceName: string, workspaceDescription: string | null) => {
    setError(null);
    setEditingWorkspaceId(workspaceId);
    setEditName(workspaceName);
    setEditDescription(workspaceDescription ?? '');
  };

  const cancelEditing = () => {
    setEditingWorkspaceId(null);
    setEditName('');
    setEditDescription('');
  };

  const saveEdit = async (workspaceId: string) => {
    if (!editName.trim()) {
      setError('Workspace name is required.');
      return;
    }

    setError(null);
    setBusyWorkspaceId(workspaceId);
    try {
      await updateExistingWorkspace(workspaceId, {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
      });
      cancelEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update workspace.');
    } finally {
      setBusyWorkspaceId(null);
    }
  };

  const removeWorkspace = async (workspaceId: string, workspaceName: string) => {
    const confirmed = window.confirm(`Delete workspace "${workspaceName}"? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setError(null);
    setBusyWorkspaceId(workspaceId);
    try {
      await deleteExistingWorkspace(workspaceId);
      if (editingWorkspaceId === workspaceId) {
        cancelEditing();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete workspace.');
    } finally {
      setBusyWorkspaceId(null);
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
          {orderedWorkspaces.map((workspace) => {
            const isEditing = editingWorkspaceId === workspace.id;
            const isBusy = busyWorkspaceId === workspace.id;

            return (
              <Card key={workspace.id} className="bg-white border-border hover:shadow-lg transition-shadow">
                <CardHeader className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-lg mb-1 truncate">{workspace.name}</CardTitle>
                      <CardDescription className="text-xs">Schema: {workspace.schema_name}</CardDescription>
                    </div>
                    <div className="flex items-center gap-1">
                      {!isEditing && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Edit workspace"
                          onClick={() =>
                            startEditing(workspace.id, workspace.name, workspace.description)
                          }
                        >
                          <Pencil className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        title="Delete workspace"
                        disabled={isBusy}
                        onClick={() => void removeWorkspace(workspace.id, workspace.name)}
                      >
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isEditing ? (
                    <div className="space-y-2">
                      <Input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        placeholder="Workspace name"
                      />
                      <Input
                        value={editDescription}
                        onChange={(event) => setEditDescription(event.target.value)}
                        placeholder="Description"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white h-8 px-3"
                          disabled={isBusy}
                          onClick={() => void saveEdit(workspace.id)}
                        >
                          <Check className="w-3.5 h-3.5 mr-1" />
                          Save
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 px-3" onClick={cancelEditing}>
                          <X className="w-3.5 h-3.5 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {workspace.description || 'No description provided.'}
                      </p>
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
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {orderedWorkspaces.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground">No workspaces yet. Create one to start analyzing data.</p>
        )}
      </div>
    </div>
  );
}
