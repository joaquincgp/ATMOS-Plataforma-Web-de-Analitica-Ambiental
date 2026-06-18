import { Play, Loader2, CheckCircle2, AlertTriangle, History } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { useMemo, useState } from 'react';

import type { MLExperimentRunRequest, MLTargetVariable } from '@/api/modules/ml-experiments';
import { useWorkspace } from '@/contexts/workspace-context';
import { useMLExperiments } from '@/hooks/use-ml-experiments';

const TARGET_VARIABLE_OPTIONS: { label: string; code: MLTargetVariable }[] = [
  { label: 'PM2.5 Concentration', code: 'PM25' },
  { label: 'PM10 Concentration', code: 'PM10' },
  { label: 'NO2 Level', code: 'NO2' },
  { label: 'Ozone Level', code: 'O3' },
];

// Only LSTM is implemented server-side today; the rest stay visible per the fixed
// mockup UI and will surface the backend's "not implemented yet" error if selected.
const ALGORITHM_OPTIONS: { label: string; code: MLExperimentRunRequest['algorithm'] }[] = [
  { label: 'LSTM', code: 'lstm' },
  { label: 'Prophet', code: undefined },
  { label: 'XGBoost', code: undefined },
  { label: 'Random Forest', code: undefined },
  { label: 'GRU', code: 'gru' },
];

const SPLIT_RATIO_TO_TRAIN_SPLIT: Record<string, number> = {
  '70/30': 0.7,
  '80/20': 0.8,
  '90/10': 0.9,
};

const TARGET_VARIABLE_UNIT = 'µg/m³';

export function MLExperimentRunner() {
  const { activeWorkspaceId } = useWorkspace();
  const { currentRun, runs, isTraining, error, submitRun, loadRun } = useMLExperiments(activeWorkspaceId);

  const [targetVariable, setTargetVariable] = useState<MLTargetVariable>('PM25');
  const [algorithm, setAlgorithm] = useState('LSTM');
  const [epochs, setEpochs] = useState(50);
  const [learningRate, setLearningRate] = useState('0.01');
  const [splitRatio, setSplitRatio] = useState('80/20');

  const targetVariableLabel = useMemo(
    () => TARGET_VARIABLE_OPTIONS.find((option) => option.code === targetVariable)?.label ?? targetVariable,
    [targetVariable],
  );

  const parsedLearningRate = Number(learningRate);
  const isLearningRateValid = Number.isFinite(parsedLearningRate) && parsedLearningRate > 0 && parsedLearningRate <= 1;

  const lossData = (currentRun?.loss_curve ?? []).map((point) => ({
    epoch: point.epoch,
    training: point.train_loss,
    validation: point.val_loss,
  }));
  const metricsData = (currentRun?.rmse_curve ?? []).map((point) => ({ epoch: point.epoch, rmse: point.rmse }));
  const featureImportance = currentRun?.feature_importance ?? [];
  const predictionData = currentRun?.predictions ?? [];

  const predictionRange = predictionData.length
    ? {
        min: Math.min(...predictionData.map((point) => Math.min(point.actual, point.predicted))),
        max: Math.max(...predictionData.map((point) => Math.max(point.actual, point.predicted))),
      }
    : { min: 0, max: 50 };
  const referenceLineData = [
    { actual: predictionRange.min, predicted: predictionRange.min },
    { actual: predictionRange.max, predicted: predictionRange.max },
  ];

  const datasetStats = currentRun?.dataset_stats ?? {};
  const trainRows = typeof datasetStats.train_rows === 'number' ? datasetStats.train_rows : null;
  const testRows = typeof datasetStats.test_rows === 'number' ? datasetStats.test_rows : null;
  const featureNames = Array.isArray(datasetStats.feature_names) ? datasetStats.feature_names : null;
  const trainingTimeSeconds =
    typeof datasetStats.training_time_seconds === 'number' ? datasetStats.training_time_seconds : null;

  const handleTrain = () => {
    if (!activeWorkspaceId || !isLearningRateValid) {
      return;
    }
    const algorithmOption = ALGORITHM_OPTIONS.find((option) => option.label === algorithm);
    void submitRun({
      workspace_id: activeWorkspaceId,
      algorithm: algorithmOption?.code ?? 'lstm',
      target_variable: targetVariable,
      epochs,
      learning_rate: parsedLearningRate,
      train_split: SPLIT_RATIO_TO_TRAIN_SPLIT[splitRatio] ?? 0.8,
    });
  };

  const getBarColor = (importance: number) => {
    if (importance > 0.3) return '#509EE3';
    if (importance > 0.15) return '#10b981';
    return '#f59e0b';
  };

  const status = currentRun?.status ?? null;
  const statusLabel =
    status === 'completed'
      ? 'Training Completed'
      : status === 'failed'
        ? 'Training Failed'
        : status === 'running' || status === 'pending'
          ? 'Training in Progress...'
          : 'No experiments yet';
  const statusClassName =
    status === 'failed'
      ? 'bg-red-500/10 text-red-600'
      : status === 'completed'
        ? 'bg-green-500/10 text-green-600'
        : isTraining
          ? 'bg-primary/10 text-primary'
          : 'bg-secondary text-muted-foreground';

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
          <select
            value={targetVariable}
            onChange={(e) => setTargetVariable(e.target.value as MLTargetVariable)}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm cursor-pointer hover:bg-secondary/80 transition-colors"
          >
            {TARGET_VARIABLE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
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
            {ALGORITHM_OPTIONS.map((option) => (
              <option key={option.label}>{option.label}</option>
            ))}
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
            className={`w-full px-3 py-2 bg-secondary border rounded-lg text-sm focus:outline-none transition-colors ${
              isLearningRateValid ? 'border-border focus:border-primary' : 'border-red-400'
            }`}
            placeholder="0.01"
          />
          {!isLearningRateValid && (
            <p className="text-xs text-red-500 mt-1">Debe ser un número mayor a 0 y menor o igual a 1.</p>
          )}
        </div>

        {/* Test/Train Split */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Test/Train Split</label>
          <div className="flex gap-2">
            {(['70/30', '80/20', '90/10'] as const).map((ratio) => (
              <button
                key={ratio}
                onClick={() => setSplitRatio(ratio)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                  splitRatio === ratio ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/80'
                }`}
              >
                {ratio}
              </button>
            ))}
          </div>
        </div>

        {/* Train Button */}
        <button
          onClick={handleTrain}
          disabled={isTraining || !activeWorkspaceId || !isLearningRateValid}
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
            <span className="font-medium">
              {trainRows !== null && testRows !== null ? `${trainRows + testRows} rows` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Features</span>
            <span className="font-medium">{featureNames ? `${featureNames.length} variables` : '—'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Training Time</span>
            <span className="font-medium">{trainingTimeSeconds !== null ? `~${trainingTimeSeconds}s` : '—'}</span>
          </div>
        </div>

        {/* Recent Experiments */}
        {runs.length > 0 && (
          <div className="pt-4 border-t border-border space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <History className="w-4 h-4" />
              Recent Experiments
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => void loadRun(run.id)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors ${
                    currentRun?.id === run.id ? 'bg-secondary' : 'hover:bg-secondary/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {run.algorithm.toUpperCase()} · {run.target_variable}
                    </span>
                    <span
                      className={
                        run.status === 'failed'
                          ? 'text-red-500'
                          : run.status === 'completed'
                            ? 'text-green-600'
                            : 'text-primary'
                      }
                    >
                      {run.status}
                    </span>
                  </div>
                  {run.final_rmse !== null && (
                    <div className="text-muted-foreground">RMSE: {run.final_rmse.toFixed(2)}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main Area - Results */}
      <div className="flex-1 space-y-6 overflow-y-auto">
        {/* Status Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">Experiment Results</h1>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${statusClassName}`}>
            {isTraining ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : status === 'failed' ? (
              <AlertTriangle className="w-4 h-4" />
            ) : status === 'completed' ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : null}
            <span className="text-sm font-medium">{statusLabel}</span>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-500/10 text-red-600 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

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
                <span className="text-lg font-semibold text-green-600">
                  {currentRun?.final_rmse !== null && currentRun?.final_rmse !== undefined
                    ? `${currentRun.final_rmse.toFixed(2)} ${TARGET_VARIABLE_UNIT}`
                    : '—'}
                </span>
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
                    label={{ value: `Actual ${targetVariableLabel} (${TARGET_VARIABLE_UNIT})`, position: 'insideBottom', offset: -5, fill: '#6b7280' }}
                  />
                  <YAxis
                    type="number"
                    dataKey="predicted"
                    name="Predicted"
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    stroke="#e5e7eb"
                    label={{ value: `Predicted ${targetVariableLabel} (${TARGET_VARIABLE_UNIT})`, angle: -90, position: 'insideLeft', fill: '#6b7280' }}
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
                    data={referenceLineData}
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
                <span className="text-lg font-semibold text-primary">
                  {currentRun?.r_squared !== null && currentRun?.r_squared !== undefined
                    ? currentRun.r_squared.toFixed(3)
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
