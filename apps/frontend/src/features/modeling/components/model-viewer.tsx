import { useState } from 'react';
import { ChevronRight, ChevronDown, FileCode, Folder, FolderOpen, Copy, Check, Play, Terminal, Table, ScrollText, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

interface FileNode {
  name: string;
  type: 'file' | 'folder';
  path: string;
  children?: FileNode[];
}

const fileTree: FileNode[] = [
  {
    name: 'models',
    type: 'folder',
    path: '/models',
    children: [
      {
        name: 'air_quality',
        type: 'folder',
        path: '/models/air_quality',
        children: [
          { name: 'lstm_v1.py', type: 'file', path: '/models/air_quality/lstm_v1.py' },
          { name: 'lstm_v2.py', type: 'file', path: '/models/air_quality/lstm_v2.py' },
          { name: 'random_forest.py', type: 'file', path: '/models/air_quality/random_forest.py' },
          { name: 'gradient_boosting.py', type: 'file', path: '/models/air_quality/gradient_boosting.py' },
        ],
      },
      {
        name: 'meteorology',
        type: 'folder',
        path: '/models/meteorology',
        children: [
          { name: 'weather_predictor.py', type: 'file', path: '/models/meteorology/weather_predictor.py' },
          { name: 'wind_forecast.py', type: 'file', path: '/models/meteorology/wind_forecast.py' },
        ],
      },
    ],
  },
  {
    name: 'utils',
    type: 'folder',
    path: '/utils',
    children: [
      { name: 'data_preprocessing.py', type: 'file', path: '/utils/data_preprocessing.py' },
      { name: 'feature_engineering.py', type: 'file', path: '/utils/feature_engineering.py' },
      { name: 'metrics.py', type: 'file', path: '/utils/metrics.py' },
    ],
  },
];

const sampleCode = `"""
LSTM-based Air Quality Prediction Model v1
Project: Quito South Analysis
Author: ATMOS Research Team
Last Modified: 2026-01-22
"""

import numpy as np
import pandas as pd
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
from sklearn.preprocessing import MinMaxScaler
import matplotlib.pyplot as plt

class AirQualityLSTM:
    """
    Long Short-Term Memory model for predicting PM2.5 concentrations
    based on historical air quality and meteorological data.
    """
    
    def __init__(self, sequence_length=24, features=14):
        """
        Initialize LSTM model architecture.
        
        Parameters:
        -----------
        sequence_length : int
            Number of timesteps to use for prediction (default: 24 hours)
        features : int
            Number of input features (PM2.5, PM10, NO2, O3, CO, SO2, 
            TMP, HUM, VEL, DIR, PRE, IUV, RS, LLU)
        """
        self.sequence_length = sequence_length
        self.features = features
        self.model = None
        self.scaler = MinMaxScaler()
        
    def build_model(self):
        """
        Build LSTM neural network architecture.
        
        Architecture:
        - LSTM Layer 1: 128 units, return sequences
        - Dropout: 0.2
        - LSTM Layer 2: 64 units, return sequences
        - Dropout: 0.2
        - LSTM Layer 3: 32 units
        - Dense Output: 1 unit (PM2.5 prediction)
        """
        self.model = Sequential([
            LSTM(128, return_sequences=True, 
                 input_shape=(self.sequence_length, self.features)),
            Dropout(0.2),
            
            LSTM(64, return_sequences=True),
            Dropout(0.2),
            
            LSTM(32, return_sequences=False),
            Dropout(0.2),
            
            Dense(16, activation='relu'),
            Dense(1)  # PM2.5 prediction
        ])
        
        self.model.compile(
            optimizer='adam',
            loss='mse',
            metrics=['mae', 'mse']
        )
        
        return self.model
    
    def prepare_sequences(self, data):
        """
        Transform time series data into supervised learning sequences.
        
        Parameters:
        -----------
        data : pd.DataFrame
            Historical environmental data with REMMAQ variables
            
        Returns:
        --------
        X : np.array
            Input sequences (samples, timesteps, features)
        y : np.array
            Target values (PM2.5 at t+1)
        """
        # Scale features to [0, 1] range
        scaled_data = self.scaler.fit_transform(data)
        
        X, y = [], []
        
        for i in range(len(scaled_data) - self.sequence_length):
            # Input: last sequence_length timesteps
            X.append(scaled_data[i:i + self.sequence_length])
            # Target: PM2.5 at next timestep
            y.append(scaled_data[i + self.sequence_length, 0])
        
        return np.array(X), np.array(y)
    
    def train(self, X_train, y_train, X_val, y_val, epochs=50, batch_size=32):
        """
        Train the LSTM model.
        
        Parameters:
        -----------
        X_train, y_train : training data
        X_val, y_val : validation data
        epochs : int
            Number of training epochs
        batch_size : int
            Batch size for training
            
        Returns:
        --------
        history : training history object
        """
        if self.model is None:
            self.build_model()
        
        history = self.model.fit(
            X_train, y_train,
            validation_data=(X_val, y_val),
            epochs=epochs,
            batch_size=batch_size,
            verbose=1
        )
        
        return history
    
    def predict(self, X):
        """
        Make predictions on new data.
        
        Parameters:
        -----------
        X : np.array
            Input sequences
            
        Returns:
        --------
        predictions : np.array
            Predicted PM2.5 concentrations
        """
        if self.model is None:
            raise ValueError("Model must be built and trained before prediction")
        
        predictions = self.model.predict(X)
        
        # Inverse transform to get actual PM2.5 values
        predictions_reshaped = np.zeros((predictions.shape[0], self.features))
        predictions_reshaped[:, 0] = predictions.flatten()
        predictions_actual = self.scaler.inverse_transform(predictions_reshaped)[:, 0]
        
        return predictions_actual
    
    def evaluate_performance(self, y_true, y_pred):
        """
        Calculate performance metrics.
        
        Returns:
        --------
        metrics : dict
            MAE, RMSE, MAPE, R²
        """
        from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
        
        mae = mean_absolute_error(y_true, y_pred)
        rmse = np.sqrt(mean_squared_error(y_true, y_pred))
        mape = np.mean(np.abs((y_true - y_pred) / y_true)) * 100
        r2 = r2_score(y_true, y_pred)
        
        return {
            'MAE': mae,
            'RMSE': rmse,
            'MAPE': mape,
            'R²': r2
        }

# Example usage
if __name__ == "__main__":
    # Initialize model
    lstm_model = AirQualityLSTM(sequence_length=24, features=14)
    
    # Build architecture
    model = lstm_model.build_model()
    print(model.summary())
`;

const sampleTableOutput = [
  { timestamp: '2026-01-22 08:00', actual_pm25: 25.3, predicted_pm25: 24.8, error: 0.5, error_pct: 1.98 },
  { timestamp: '2026-01-22 09:00', actual_pm25: 28.1, predicted_pm25: 27.5, error: 0.6, error_pct: 2.14 },
  { timestamp: '2026-01-22 10:00', actual_pm25: 32.4, predicted_pm25: 31.9, error: 0.5, error_pct: 1.54 },
  { timestamp: '2026-01-22 11:00', actual_pm25: 35.2, predicted_pm25: 34.1, error: 1.1, error_pct: 3.12 },
  { timestamp: '2026-01-22 12:00', actual_pm25: 38.7, predicted_pm25: 37.8, error: 0.9, error_pct: 2.33 },
];

const sampleLogs = `[2026-01-22 08:15:23] INFO: Model initialization started
[2026-01-22 08:15:23] INFO: Loading LSTM architecture from /models/air_quality/lstm_v1.py
[2026-01-22 08:15:24] INFO: Model built successfully - 3 LSTM layers, 224,513 parameters
[2026-01-22 08:15:24] INFO: Loading training data from REMMAQ database
[2026-01-22 08:15:25] INFO: Retrieved 12,847 records (2026-01-15 to 2026-01-22)
[2026-01-22 08:15:25] INFO: Data preprocessing - scaling 14 features
[2026-01-22 08:15:26] INFO: Creating sequences (sequence_length=24)
[2026-01-22 08:15:26] INFO: Training samples: 8,532 | Validation samples: 2,133
[2026-01-22 08:15:26] INFO: Starting training - 50 epochs, batch_size=32
[2026-01-22 08:16:42] INFO: Epoch 50/50 - loss: 0.0032 - mae: 0.0421 - val_loss: 0.0041 - val_mae: 0.0487
[2026-01-22 08:16:42] INFO: Training completed successfully
[2026-01-22 08:16:43] INFO: Generating predictions for validation set
[2026-01-22 08:16:44] INFO: Performance metrics - MAE: 0.72 µg/m³, RMSE: 1.15 µg/m³, R²: 0.94
[2026-01-22 08:16:44] SUCCESS: Model execution completed - 168 predictions generated
[2026-01-22 08:16:44] INFO: Results saved to database table 'predictions_lstm_v1'
`;

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
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[#F9FBFC] rounded transition-colors ${
            isSelected ? 'bg-[#509EE3]/10 text-[#509EE3]' : 'text-foreground'
          }`}
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
  const [selectedFile, setSelectedFile] = useState<string | null>('/models/air_quality/lstm_v1.py');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(['/models', '/models/air_quality'])
  );
  const [copied, setCopied] = useState(false);

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
    navigator.clipboard.writeText(sampleCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full overflow-hidden bg-[#F9FBFC] flex flex-col">
      {/* Breadcrumbs */}
      <div className="px-6 py-3 bg-white border-b border-border">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="hover:text-foreground cursor-pointer">Projects</span>
          <ChevronRight className="w-4 h-4" />
          <span className="hover:text-foreground cursor-pointer">Quito South Analysis</span>
          <ChevronRight className="w-4 h-4" />
          <span className="hover:text-foreground cursor-pointer">Model Viewer</span>
          <ChevronRight className="w-4 h-4" />
          <span className="text-foreground font-medium">lstm_v1.py</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Explorer Sidebar */}
        <div className="w-64 bg-white border-r border-border overflow-y-auto">
          <div className="p-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Model Files</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Quito South Analysis</p>
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
          {/* Permissions Banner */}
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-900">
              ⚠️ VIEW-ONLY MODE - Contact Admin to request logic changes
            </span>
          </div>

          {/* Editor Toolbar */}
          <div className="bg-[#1E1E1E] border-b border-[#3E3E42] px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileCode className="w-4 h-4 text-[#509EE3]" />
              <span className="text-sm text-white font-mono">lstm_v1.py</span>
              <Badge variant="outline" className="text-xs text-white border-white/20">
                Python
              </Badge>
              <Badge variant="outline" className="text-xs text-green-400 border-green-400/40">
                Read-Only
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleCopyCode}
                size="sm"
                variant="outline"
                className="bg-transparent border-white/20 text-white hover:bg-white/10"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Code to Clipboard
                  </>
                )}
              </Button>
              <Button
                size="sm"
                className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
              >
                <Play className="w-4 h-4 mr-2" />
                Simulate in Sandbox
              </Button>
            </div>
          </div>

          {/* Code Display Area */}
          <div className="flex-1 overflow-auto bg-[#1E1E1E]">
            <pre className="p-4 text-sm font-mono text-white leading-relaxed">
              <code className="language-python" dangerouslySetInnerHTML={{ __html: highlightPython(sampleCode) }} />
            </pre>
          </div>
        </div>

        {/* Right Panel - Output & Logs */}
        <div className="w-96 bg-white border-l border-border flex flex-col overflow-hidden">
          <Tabs defaultValue="table" className="h-full flex flex-col">
            <div className="border-b border-border px-4 pt-3">
              <TabsList className="w-full">
                <TabsTrigger value="table" className="flex-1 gap-1.5">
                  <Table className="w-4 h-4" />
                  <span className="text-xs">Table Output</span>
                </TabsTrigger>
                <TabsTrigger value="logs" className="flex-1 gap-1.5">
                  <ScrollText className="w-4 h-4" />
                  <span className="text-xs">Console Logs</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="table" className="flex-1 overflow-auto p-4 m-0">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground">Prediction Results</h4>
                  <Badge className="bg-green-100 text-green-800 border-green-200">
                    Active Run
                  </Badge>
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-[#F9FBFC] border-b border-border">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium text-muted-foreground">Time</th>
                        <th className="px-2 py-2 text-right font-medium text-muted-foreground">Actual</th>
                        <th className="px-2 py-2 text-right font-medium text-muted-foreground">Pred</th>
                        <th className="px-2 py-2 text-right font-medium text-muted-foreground">Err%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sampleTableOutput.map((row, idx) => (
                        <tr key={idx} className="border-b border-border hover:bg-[#F9FBFC]/50">
                          <td className="px-2 py-2 text-muted-foreground">{row.timestamp.split(' ')[1]}</td>
                          <td className="px-2 py-2 text-right font-medium">{row.actual_pm25}</td>
                          <td className="px-2 py-2 text-right font-medium text-[#509EE3]">{row.predicted_pm25}</td>
                          <td className="px-2 py-2 text-right text-green-600">{row.error_pct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">MAE</p>
                    <p className="text-sm font-semibold">0.72 µg/m³</p>
                  </div>
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">R²</p>
                    <p className="text-sm font-semibold text-green-600">0.94</p>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="logs" className="flex-1 overflow-auto p-4 m-0">
              <div className="space-y-3 h-full flex flex-col">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground">Execution Logs</h4>
                  <Terminal className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 p-3 bg-[#1E1E1E] rounded-lg overflow-auto">
                  <pre className="text-xs font-mono text-green-400 leading-relaxed whitespace-pre-wrap">
                    {sampleLogs}
                  </pre>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// Simple Python syntax highlighter
function highlightPython(code: string): string {
  // Keywords
  let highlighted = code.replace(
    /\b(import|from|class|def|if|else|elif|for|while|return|self|try|except|with|as|in|is|not|and|or|None|True|False|raise|ValueError)\b/g,
    '<span style="color: #C586C0;">$1</span>'
  );

  // Strings
  highlighted = highlighted.replace(
    /("""[\s\S]*?"""|'''[\s\S]*?'''|"[^"]*"|'[^']*')/g,
    '<span style="color: #CE9178;">$1</span>'
  );

  // Comments
  highlighted = highlighted.replace(
    /(#.*$)/gm,
    '<span style="color: #6A9955;">$1</span>'
  );

  // Function names
  highlighted = highlighted.replace(
    /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
    '<span style="color: #DCDCAA;">$1</span>('
  );

  // Numbers
  highlighted = highlighted.replace(
    /\b(\d+\.?\d*)\b/g,
    '<span style="color: #B5CEA8;">$1</span>'
  );

  // Built-in functions
  highlighted = highlighted.replace(
    /\b(print|len|range|enumerate|zip|map|filter|str|int|float|list|dict|set|tuple|np|pd|tf|Sequential|LSTM|Dense|Dropout|MinMaxScaler)\b/g,
    '<span style="color: #4EC9B0;">$1</span>'
  );

  return highlighted;
}
