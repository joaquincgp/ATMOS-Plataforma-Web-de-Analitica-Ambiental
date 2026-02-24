import { Play, Save, Database, FileCode, Terminal } from 'lucide-react';
import { useState } from 'react';

export function CodeEditor() {
  const [activeTab, setActiveTab] = useState('table');
  const [isRunning, setIsRunning] = useState(false);

  // Sample Python code
  const pythonCode = `import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor

def train_model(data, params):
    """
    Train a Random Forest model for PM2.5 prediction
    
    Args:
        data: DataFrame with air quality measurements
        params: Dictionary with model hyperparameters
    
    Returns:
        Trained model and metrics
    """
    # Feature engineering
    features = ['temp', 'humidity', 'wind_speed', 'hour', 'day_of_week']
    target = 'pm25'
    
    X = data[features]
    y = data[target]
    
    # Initialize model
    model = RandomForestRegressor(
        n_estimators=params.get('n_estimators', 100),
        max_depth=params.get('max_depth', 10),
        random_state=42
    )
    
    # Train
    model.fit(X, y)
    
    # Calculate metrics
    predictions = model.predict(X)
    rmse = np.sqrt(np.mean((y - predictions) ** 2))
    
    return {
        'model': model,
        'rmse': rmse,
        'feature_importance': dict(zip(features, model.feature_importances_))
    }`;

  const tableOutput = [
    { feature: 'temp', importance: 0.342, rank: 1 },
    { feature: 'hour', importance: 0.256, rank: 2 },
    { feature: 'humidity', importance: 0.187, rank: 3 },
    { feature: 'wind_speed', importance: 0.143, rank: 4 },
    { feature: 'day_of_week', importance: 0.072, rank: 5 },
  ];

  const jsonOutput = {
    status: 'success',
    execution_time: '2.34s',
    model: {
      type: 'RandomForestRegressor',
      n_estimators: 100,
      max_depth: 10,
    },
    metrics: {
      rmse: 8.432,
      r2_score: 0.847,
    },
    feature_importance: {
      temp: 0.342,
      hour: 0.256,
      humidity: 0.187,
      wind_speed: 0.143,
      day_of_week: 0.072,
    },
  };

  const logs = [
    { level: 'INFO', message: 'Loading dataset: remmaq_stations_2024.csv', time: '14:32:01' },
    { level: 'INFO', message: 'Dataset loaded: 125,432 rows, 8 columns', time: '14:32:02' },
    { level: 'INFO', message: 'Feature engineering completed', time: '14:32:03' },
    { level: 'INFO', message: 'Training Random Forest model...', time: '14:32:03' },
    { level: 'SUCCESS', message: 'Model trained successfully', time: '14:32:05' },
    { level: 'INFO', message: 'RMSE: 8.432', time: '14:32:05' },
    { level: 'INFO', message: 'R² Score: 0.847', time: '14:32:05' },
  ];

  const handleRun = () => {
    setIsRunning(true);
    setTimeout(() => setIsRunning(false), 2000);
  };

  return (
    <div className="p-8 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Native Model Code Editor</h1>
        <p className="text-muted-foreground mt-1">Write and execute custom Python algorithms for air quality analysis</p>
      </div>

      {/* Editor Controls */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {isRunning ? 'Running...' : 'Run'}
          </button>
          
          <button className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-secondary transition-colors">
            <Save className="w-4 h-4" />
            Save as Snippet
          </button>

          <div className="relative ml-2">
            <select className="appearance-none bg-secondary border border-border rounded-lg px-4 py-2 pr-10 text-sm cursor-pointer hover:bg-secondary/80 transition-colors">
              <option>Variables</option>
              <option>→ remmaq_stations</option>
              <option>→ meteorology_2024</option>
              <option>→ pollutants_dataset</option>
              <option>→ trained_models</option>
            </select>
            <Database className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileCode className="w-4 h-4" />
          <span>Python 3.11</span>
        </div>
      </div>

      {/* Split Pane */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Left Pane - Code Editor */}
        <div className="flex-1 bg-[#1e1e1e] rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-2 bg-[#252526] border-b border-[#3e3e42] flex items-center justify-between">
            <span className="text-xs text-gray-400">train_model.py</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">UTF-8</span>
              <span className="text-xs text-gray-400">Python</span>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <div className="flex">
              {/* Line Numbers */}
              <div className="bg-[#1e1e1e] text-gray-600 text-right pr-3 pl-4 py-4 select-none" style={{ fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6' }}>
                {pythonCode.split('\n').map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>

              {/* Code Area with Syntax Highlighting */}
              <pre className="flex-1 p-4 text-sm" style={{ fontFamily: 'monospace', lineHeight: '1.6', tabSize: 4 }}>
                <code>
                  {pythonCode.split('\n').map((line, i) => (
                    <div key={i}>
                      <span
                        dangerouslySetInnerHTML={{
                          __html: highlightPython(line),
                        }}
                      />
                    </div>
                  ))}
                </code>
              </pre>
            </div>
          </div>
        </div>

        {/* Right Pane - Live Preview */}
        <div className="w-1/2 bg-card border border-border rounded-lg overflow-hidden flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab('table')}
              className={`px-4 py-2 text-sm transition-colors ${
                activeTab === 'table'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Table Output
            </button>
            <button
              onClick={() => setActiveTab('json')}
              className={`px-4 py-2 text-sm transition-colors ${
                activeTab === 'json'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              JSON Response
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-4 py-2 text-sm transition-colors ${
                activeTab === 'logs'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4" />
                Logs
              </div>
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-auto p-4">
            {activeTab === 'table' && (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold border-b border-border">Feature</th>
                      <th className="px-4 py-2 text-left font-semibold border-b border-border">Importance</th>
                      <th className="px-4 py-2 text-left font-semibold border-b border-border">Rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableOutput.map((row) => (
                      <tr key={row.feature} className="hover:bg-secondary/50">
                        <td className="px-4 py-2 border-b border-border font-mono text-xs">{row.feature}</td>
                        <td className="px-4 py-2 border-b border-border">{row.importance.toFixed(3)}</td>
                        <td className="px-4 py-2 border-b border-border">{row.rank}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'json' && (
              <pre className="bg-secondary p-4 rounded-lg overflow-auto text-xs font-mono">
                {JSON.stringify(jsonOutput, null, 2)}
              </pre>
            )}

            {activeTab === 'logs' && (
              <div className="space-y-1">
                {logs.map((log, i) => (
                  <div key={i} className="flex items-start gap-3 text-xs font-mono">
                    <span className="text-muted-foreground">{log.time}</span>
                    <span
                      className={`font-semibold ${
                        log.level === 'SUCCESS'
                          ? 'text-green-600'
                          : log.level === 'ERROR'
                          ? 'text-destructive'
                          : 'text-primary'
                      }`}
                    >
                      {log.level}
                    </span>
                    <span className="flex-1">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Simple syntax highlighting function
function highlightPython(line: string): string {
  // Keywords
  const keywords = ['import', 'from', 'def', 'return', 'for', 'if', 'in', 'as'];
  let highlighted = line;

  keywords.forEach((keyword) => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'g');
    highlighted = highlighted.replace(regex, `<span style="color: #C586C0">${keyword}</span>`);
  });

  // Strings
  highlighted = highlighted.replace(/'([^']*)'/g, '<span style="color: #CE9178">\'$1\'</span>');
  highlighted = highlighted.replace(/"([^"]*)"/g, '<span style="color: #CE9178">"$1"</span>');

  // Comments
  highlighted = highlighted.replace(/#(.*)$/, '<span style="color: #6A9955">#$1</span>');
  highlighted = highlighted.replace(/"""(.*?)"""/g, '<span style="color: #6A9955">"""$1"""</span>');

  // Function names
  highlighted = highlighted.replace(/\bdef\s+(\w+)/, 'def <span style="color: #DCDCAA">$1</span>');

  // Numbers
  highlighted = highlighted.replace(/\b(\d+)\b/g, '<span style="color: #B5CEA8">$1</span>');

  // Default color for remaining text
  if (!highlighted.includes('<span')) {
    return `<span style="color: #D4D4D4">${line}</span>`;
  }

  return highlighted.replace(/^([^<]+)/, '<span style="color: #D4D4D4">$1</span>');
}
