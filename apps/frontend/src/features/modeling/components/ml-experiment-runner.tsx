import { Play, Loader2, CheckCircle2 } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { useState } from 'react';

export function MLExperimentRunner() {
  const [isTraining, setIsTraining] = useState(false);
  const [algorithm, setAlgorithm] = useState('LSTM');
  const [epochs, setEpochs] = useState(50);
  const [learningRate, setLearningRate] = useState('0.01');
  const [splitRatio, setSplitRatio] = useState('80/20');

  // Mock data for loss curve
  const lossData = [
    { epoch: 0, training: 0.95, validation: 0.98 },
    { epoch: 10, training: 0.72, validation: 0.78 },
    { epoch: 20, training: 0.54, validation: 0.62 },
    { epoch: 30, training: 0.38, validation: 0.49 },
    { epoch: 40, training: 0.25, validation: 0.38 },
    { epoch: 50, training: 0.18, validation: 0.32 },
  ];

  // Mock data for accuracy/RMSE
  const metricsData = [
    { epoch: 0, rmse: 15.2 },
    { epoch: 10, rmse: 12.8 },
    { epoch: 20, rmse: 10.3 },
    { epoch: 30, rmse: 8.7 },
    { epoch: 40, rmse: 7.4 },
    { epoch: 50, rmse: 6.8 },
  ];

  // Mock feature importance data
  const featureImportance = [
    { feature: 'Temperature', importance: 0.342 },
    { feature: 'Hour of Day', importance: 0.256 },
    { feature: 'Humidity', importance: 0.187 },
    { feature: 'Wind Speed', importance: 0.143 },
    { feature: 'Day of Week', importance: 0.072 },
  ];

  // Mock prediction vs actual data
  const predictionData = [
    { actual: 25, predicted: 26.5 },
    { actual: 32, predicted: 30.8 },
    { actual: 28, predicted: 28.2 },
    { actual: 35, predicted: 36.1 },
    { actual: 42, predicted: 40.5 },
    { actual: 38, predicted: 38.8 },
    { actual: 30, predicted: 29.2 },
    { actual: 45, predicted: 44.3 },
    { actual: 40, predicted: 41.2 },
    { actual: 33, predicted: 34.5 },
    { actual: 37, predicted: 36.8 },
    { actual: 29, predicted: 30.1 },
    { actual: 41, predicted: 39.9 },
    { actual: 36, predicted: 37.2 },
    { actual: 31, predicted: 31.8 },
  ];

  const handleTrain = () => {
    setIsTraining(true);
    setTimeout(() => setIsTraining(false), 3000);
  };

  const getBarColor = (importance: number) => {
    if (importance > 0.3) return '#509EE3';
    if (importance > 0.15) return '#10b981';
    return '#f59e0b';
  };

  return (
    <div className="p-8 h-full flex gap-6">
      {/* Left Sidebar - Configuration */}
      <div className="w-80 bg-card border border-border rounded-lg p-6 space-y-6 overflow-y-auto">
        <div>
          <h2 className="font-semibold text-foreground mb-1">Model Configuration</h2>
          <p className="text-xs text-muted-foreground">Configure hyperparameters for your experiment</p>
        </div>

        {/* Target Variable */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Target Variable</label>
          <select className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm cursor-pointer hover:bg-secondary/80 transition-colors">
            <option>PM2.5 Concentration</option>
            <option>PM10 Concentration</option>
            <option>NO2 Level</option>
            <option>Ozone Level</option>
          </select>
        </div>

        {/* Algorithm */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Algorithm</label>
          <select
            value={algorithm}
            onChange={(e) => setAlgorithm(e.target.value)}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm cursor-pointer hover:bg-secondary/80 transition-colors"
          >
            <option>LSTM</option>
            <option>Prophet</option>
            <option>XGBoost</option>
            <option>Random Forest</option>
            <option>GRU</option>
          </select>
        </div>

        {/* Epochs Slider */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Epochs: <span className="text-primary">{epochs}</span>
          </label>
          <input
            type="range"
            min="1"
            max="100"
            value={epochs}
            onChange={(e) => setEpochs(Number(e.target.value))}
            className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>1</span>
            <span>100</span>
          </div>
        </div>

        {/* Learning Rate */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Learning Rate</label>
          <input
            type="text"
            value={learningRate}
            onChange={(e) => setLearningRate(e.target.value)}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:border-primary focus:outline-none transition-colors"
            placeholder="0.01"
          />
        </div>

        {/* Test/Train Split */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Test/Train Split</label>
          <div className="flex gap-2">
            <button
              onClick={() => setSplitRatio('70/30')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                splitRatio === '70/30'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-secondary/80'
              }`}
            >
              70/30
            </button>
            <button
              onClick={() => setSplitRatio('80/20')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                splitRatio === '80/20'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-secondary/80'
              }`}
            >
              80/20
            </button>
            <button
              onClick={() => setSplitRatio('90/10')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                splitRatio === '90/10'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-secondary/80'
              }`}
            >
              90/10
            </button>
          </div>
        </div>

        {/* Train Button */}
        <button
          onClick={handleTrain}
          disabled={isTraining}
          className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isTraining ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Training Model...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Train Model
            </>
          )}
        </button>

        {/* Quick Stats */}
        <div className="pt-4 border-t border-border space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Dataset Size</span>
            <span className="font-medium">125,432 rows</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Features</span>
            <span className="font-medium">5 variables</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Training Time</span>
            <span className="font-medium">~45 seconds</span>
          </div>
        </div>
      </div>

      {/* Main Area - Results */}
      <div className="flex-1 space-y-6 overflow-y-auto">
        {/* Status Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">Experiment Results</h1>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
            isTraining ? 'bg-primary/10 text-primary' : 'bg-green-500/10 text-green-600'
          }`}>
            {isTraining ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm font-medium">Training in Progress...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm font-medium">Training Completed</span>
              </>
            )}
          </div>
        </div>

        {/* Top Row: Loss Curve and RMSE Evolution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Loss Curve */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="font-semibold text-foreground mb-4">Loss Curve (Training vs Validation)</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lossData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="epoch" 
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    stroke="#e5e7eb"
                    label={{ value: 'Epoch', position: 'insideBottom', offset: -5, fill: '#6b7280' }}
                  />
                  <YAxis 
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    stroke="#e5e7eb"
                    label={{ value: 'Loss', angle: -90, position: 'insideLeft', fill: '#6b7280' }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#ffffff', 
                      border: '1px solid #e5e7eb', 
                      borderRadius: '0.5rem',
                      fontSize: '12px'
                    }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="training" 
                    stroke="#509EE3" 
                    strokeWidth={2}
                    name="Training Loss"
                    dot={{ fill: '#509EE3', r: 4 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="validation" 
                    stroke="#f59e0b" 
                    strokeWidth={2}
                    name="Validation Loss"
                    dot={{ fill: '#f59e0b', r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RMSE Evolution */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="font-semibold text-foreground mb-4">RMSE Evolution</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metricsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="epoch" 
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    stroke="#e5e7eb"
                    label={{ value: 'Epoch', position: 'insideBottom', offset: -5, fill: '#6b7280' }}
                  />
                  <YAxis 
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    stroke="#e5e7eb"
                    label={{ value: 'RMSE', angle: -90, position: 'insideLeft', fill: '#6b7280' }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#ffffff', 
                      border: '1px solid #e5e7eb', 
                      borderRadius: '0.5rem',
                      fontSize: '12px'
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="rmse" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    name="RMSE"
                    dot={{ fill: '#10b981', r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 p-3 bg-secondary rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Final RMSE:</span>
                <span className="text-lg font-semibold text-green-600">6.8 µg/m³</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Row: Feature Importance and Prediction vs Actual */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Feature Importance */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="font-semibold text-foreground mb-4">Feature Importance</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={featureImportance} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    type="number" 
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    stroke="#e5e7eb"
                  />
                  <YAxis 
                    type="category" 
                    dataKey="feature" 
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    stroke="#e5e7eb"
                    width={100}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#ffffff', 
                      border: '1px solid #e5e7eb', 
                      borderRadius: '0.5rem',
                      fontSize: '12px'
                    }}
                  />
                  <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
                    {featureImportance.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getBarColor(entry.importance)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Prediction vs Actual */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="font-semibold text-foreground mb-4">Prediction vs Actual</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    type="number" 
                    dataKey="actual" 
                    name="Actual" 
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    stroke="#e5e7eb"
                    label={{ value: 'Actual PM2.5 (µg/m³)', position: 'insideBottom', offset: -5, fill: '#6b7280' }}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="predicted" 
                    name="Predicted" 
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    stroke="#e5e7eb"
                    label={{ value: 'Predicted PM2.5 (µg/m³)', angle: -90, position: 'insideLeft', fill: '#6b7280' }}
                  />
                  <Tooltip 
                    cursor={{ strokeDasharray: '3 3' }}
                    contentStyle={{ 
                      backgroundColor: '#ffffff', 
                      border: '1px solid #e5e7eb', 
                      borderRadius: '0.5rem',
                      fontSize: '12px'
                    }}
                  />
                  <Scatter name="Predictions" data={predictionData} fill="#509EE3" />
                  {/* Ideal line (y=x) */}
                  <Line 
                    type="linear" 
                    dataKey="actual" 
                    data={[{ actual: 20, predicted: 20 }, { actual: 50, predicted: 50 }]} 
                    stroke="#dc2626" 
                    strokeWidth={2} 
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 p-3 bg-secondary rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">R² Score:</span>
                <span className="text-lg font-semibold text-primary">0.847</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
