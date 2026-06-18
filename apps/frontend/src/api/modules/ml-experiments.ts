import { apiRequest } from '@/api/http-client';

export type MLAlgorithm = 'lstm' | 'gru' | 'timesfm' | 'chronos' | 'moirai';
export type MLTargetVariable = 'PM25' | 'PM10' | 'NO2' | 'O3';
export type MLRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface MLExperimentRunRequest {
  workspace_id: string;
  algorithm?: MLAlgorithm;
  target_variable: MLTargetVariable;
  station_codes?: string[];
  date_from?: string;
  date_to?: string;
  epochs?: number;
  learning_rate?: number;
  train_split?: number;
}

export interface MLLossPoint {
  epoch: number;
  train_loss: number;
  val_loss: number;
}

export interface MLRmsePoint {
  epoch: number;
  rmse: number;
}

export interface MLFeatureImportance {
  feature: string;
  importance: number;
}

export interface MLPredictionPoint {
  actual: number;
  predicted: number;
}

export interface MLExperimentRunSummary {
  id: string;
  algorithm: string;
  target_variable: string;
  status: MLRunStatus;
  epochs: number;
  learning_rate: number;
  train_split: number;
  final_rmse: number | null;
  r_squared: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

export interface MLExperimentRunDetail extends MLExperimentRunSummary {
  progress_epoch: number;
  loss_curve: MLLossPoint[];
  rmse_curve: MLRmsePoint[];
  feature_importance: MLFeatureImportance[];
  predictions: MLPredictionPoint[];
  dataset_stats: Record<string, unknown>;
}

export function submitMLExperimentRun(payload: MLExperimentRunRequest): Promise<MLExperimentRunDetail> {
  return apiRequest<MLExperimentRunDetail>('/api/v1/ml-experiments/runs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getMLExperimentRun(runId: string): Promise<MLExperimentRunDetail> {
  return apiRequest<MLExperimentRunDetail>(`/api/v1/ml-experiments/runs/${runId}`);
}

export function listMLExperimentRuns(workspaceId: string, limit = 20): Promise<MLExperimentRunSummary[]> {
  return apiRequest<MLExperimentRunSummary[]>(
    `/api/v1/ml-experiments/runs?workspace_id=${workspaceId}&limit=${limit}`,
  );
}
