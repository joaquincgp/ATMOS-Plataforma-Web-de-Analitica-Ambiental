import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, FileCode, Folder, FolderOpen, Copy, Check, Loader2, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getMLModelSources, type MLModelSourceFile } from '@/api/modules/ml-experiments';

interface FileNode {
  name: string;
  type: 'file' | 'folder';
  path: string;
  children?: FileNode[];
}

const fileTree: FileNode[] = [
  {
    name: 'ml_experiments',
    type: 'folder',
    path: '/ml_experiments',
    children: [
      { name: 'dataset.py', type: 'file', path: '/ml_experiments/dataset.py' },
      {
        name: 'models',
        type: 'folder',
        path: '/ml_experiments/models',
        children: [
          { name: 'lstm.py', type: 'file', path: '/ml_experiments/models/lstm.py' },
          { name: 'gru.py', type: 'file', path: '/ml_experiments/models/gru.py' },
          { name: 'transformer.py', type: 'file', path: '/ml_experiments/models/transformer.py' },
        ],
      },
    ],
  },
];

function keyFromPath(path: string): string {
  const filename = path.split('/').pop() ?? '';
  return filename.replace(/\.py$/, '');
}

interface TreeNodeProps {
  node: FileNode;
  level: number;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
}

function TreeNode({ node, level, selectedFile, onSelectFile, expandedFolders, onToggleFolder }: TreeNodeProps) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedFile === node.path;

  if (node.type === 'folder') {
    return (
      <div>
        <button
          onClick={() => onToggleFolder(node.path)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[#F9FBFC] rounded transition-colors text-foreground"
          style={{ paddingLeft: `${level * 12 + 12}px` }}
        >
          {isExpanded ? (
            <>
              <ChevronDown className="w-4 h-4 flex-shrink-0" />
              <FolderOpen className="w-4 h-4 flex-shrink-0 text-[#509EE3]" />
            </>
          ) : (
            <>
              <ChevronRight className="w-4 h-4 flex-shrink-0" />
              <Folder className="w-4 h-4 flex-shrink-0 text-[#509EE3]" />
            </>
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                level={level + 1}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelectFile(node.path)}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[#F9FBFC] rounded transition-colors ${
        isSelected ? 'bg-[#509EE3]/10 text-[#509EE3] font-medium' : 'text-foreground'
      }`}
      style={{ paddingLeft: `${level * 12 + 24}px` }}
    >
      <FileCode className="w-4 h-4 flex-shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function ModelViewer() {
  const [files, setFiles] = useState<MLModelSourceFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>('/ml_experiments/dataset.py');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(['/ml_experiments', '/ml_experiments/models']),
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMLModelSources()
      .then((response) => {
        if (!cancelled) setFiles(response.files);
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo cargar el código de los modelos. Intenta de nuevo en unos segundos.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedKey = selectedFile ? keyFromPath(selectedFile) : null;
  const selectedSourceFile = useMemo(
    () => files?.find((file) => file.key === selectedKey) ?? null,
    [files, selectedKey],
  );

  const handleToggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  };

  const handleCopyCode = () => {
    if (!selectedSourceFile) return;
    void navigator.clipboard.writeText(selectedSourceFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full overflow-hidden bg-[#F9FBFC] flex flex-col">
      {/* Breadcrumbs */}
      <div className="px-6 py-3 bg-white border-b border-border">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>ML Experiments</span>
          <ChevronRight className="w-4 h-4" />
          <span>Código de los modelos</span>
          {selectedSourceFile && (
            <>
              <ChevronRight className="w-4 h-4" />
              <span className="text-foreground font-medium">{selectedSourceFile.filename}</span>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Explorer Sidebar */}
        <div className="w-64 bg-white border-r border-border overflow-y-auto">
          <div className="p-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Archivos del modelo</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Pipeline real de entrenamiento (REMMAQ)</p>
          </div>
          <div className="py-2">
            {fileTree.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                level={0}
                selectedFile={selectedFile}
                onSelectFile={setSelectedFile}
                expandedFolders={expandedFolders}
                onToggleFolder={handleToggleFolder}
              />
            ))}
          </div>
        </div>

        {/* Code Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Read-only banner */}
          <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span className="text-sm text-blue-900">
              Solo lectura — este es el código real que entrena cada modelo en producción. Si detectas un error o
              quieres sugerir un cambio, coméntalo con el equipo de investigación.
            </span>
          </div>

          {/* Editor Toolbar */}
          <div className="bg-[#1E1E1E] border-b border-[#3E3E42] px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileCode className="w-4 h-4 text-[#509EE3]" />
              <span className="text-sm text-white font-mono">{selectedSourceFile?.filename ?? '—'}</span>
              {selectedSourceFile && (
                <span className="text-xs text-white/50">{selectedSourceFile.label}</span>
              )}
              <Badge variant="outline" className="text-xs text-white border-white/20">
                Python
              </Badge>
              <Badge variant="outline" className="text-xs text-green-400 border-green-400/40">
                Read-Only
              </Badge>
            </div>
            <Button
              onClick={handleCopyCode}
              size="sm"
              variant="outline"
              disabled={!selectedSourceFile}
              className="bg-transparent border-white/20 text-white hover:bg-white/10"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Copiado!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copiar código
                </>
              )}
            </Button>
          </div>

          {/* Code Display Area */}
          <div className="flex-1 overflow-auto bg-[#1E1E1E]">
            {error ? (
              <p className="p-4 text-sm text-red-400">{error}</p>
            ) : !files ? (
              <div className="p-4 flex items-center gap-2 text-sm text-white/70">
                <Loader2 className="w-4 h-4 animate-spin" />
                Cargando código...
              </div>
            ) : selectedSourceFile ? (
              <pre className="p-4 text-sm font-mono text-white leading-relaxed">
                <code className="language-python">{selectedSourceFile.content}</code>
              </pre>
            ) : (
              <p className="p-4 text-sm text-white/70">Selecciona un archivo para ver su código.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
