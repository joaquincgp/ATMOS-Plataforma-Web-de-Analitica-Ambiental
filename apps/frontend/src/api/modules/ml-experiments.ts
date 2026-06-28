import { apiRequest } from '@/api/http-client';

export type MLAlgorithm = 'lstm' | 'gru' | 'transformer';
export type MLTargetVariable = 'PM25' | 'PM10' | 'NO2' | 'O3';
export type MLRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface MLExperimentRunRequest {
  workspace_id: string;
  algorithm?: MLAlgorithm;
  target_variable: MLTargetVariable;
  station_codes?: string[];
  date_from?: string;
  date_to?: string;
  // When set, training reads exclusively from this ML-Experiments-owned
  // isolated source instead of the shared REMMAQ measurement pool.
  manual_dataset_id?: string;
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
  manual_dataset_id: string | null;
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
  // 95% bootstrap confidence intervals for final_rmse / r_squared.
  final_rmse_ci_low: number | null;
  final_rmse_ci_high: number | null;
  r_squared_ci_low: number | null;
  r_squared_ci_high: number | null;
}

export interface MLAlgorithmsResponse {
  algorithms: MLAlgorithm[];
}

export function listMLAlgorithms(): Promise<MLAlgorithmsResponse> {
  return apiRequest<MLAlgorithmsResponse>('/api/v1/ml-experiments/algorithms');
}

export interface MLModelSourceFile {
  key: string;
  filename: string;
  label: string;
  content: string;
}

export interface MLModelSourcesResponse {
  files: MLModelSourceFile[];
}

export function getMLModelSources(): Promise<MLModelSourcesResponse> {
  return apiRequest<MLModelSourcesResponse>('/api/v1/ml-experiments/model-sources');
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

export function deleteMLExperimentRun(runId: string): Promise<void> {
  return apiRequest<void>(`/api/v1/ml-experiments/runs/${runId}`, { method: 'DELETE' });
}

export function clearMLExperimentRunHistory(workspaceId: string): Promise<{ cleared: number }> {
  return apiRequest<{ cleared: number }>(`/api/v1/ml-experiments/runs?workspace_id=${workspaceId}`, {
    method: 'DELETE',
  });
}

// --- ML-Experiments-exclusive REMMAQ sources -------------------------------
// Isolated from Data Manager / Advanced Analytics: a source synced here never
// appears there, and vice versa (see backend ManualDataset.created_for).

export type MLExperimentSourceStatus = 'syncing' | 'draft' | 'failed';

export interface MLExperimentSourceMetadata {
  target_variable_code?: string;
  variable_codes?: string[];
  station_codes?: string[];
  date_from?: string | null;
  date_to?: string | null;
  // Present only while status === 'syncing': how many of the REMMAQ archives
  // (target variable + covariates) have finished downloading/parsing so far.
  archives_done?: number;
  archives_total?: number;
  rows_collected?: number;
}

export interface MLExperimentSource {
  id: string;
  name: string;
  status: MLExperimentSourceStatus;
  row_count: number;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  source_metadata: MLExperimentSourceMetadata;
}

export interface MLExperimentSourceSyncRequest {
  workspace_id: string;
  target_variable_code: MLTargetVariable;
  date_from?: string;
  date_to?: string;
}

export function syncMLExperimentSource(payload: MLExperimentSourceSyncRequest): Promise<MLExperimentSource> {
  return apiRequest<MLExperimentSource>('/api/v1/ml-experiments/sources/sync', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function listMLExperimentSources(workspaceId: string): Promise<MLExperimentSource[]> {
  return apiRequest<MLExperimentSource[]>(`/api/v1/ml-experiments/sources?workspace_id=${workspaceId}`);
}

export function getMLExperimentSource(sourceId: string): Promise<MLExperimentSource> {
  return apiRequest<MLExperimentSource>(`/api/v1/ml-experiments/sources/${sourceId}`);
}

export function deleteMLExperimentSource(sourceId: string): Promise<void> {
  return apiRequest<void>(`/api/v1/ml-experiments/sources/${sourceId}`, { method: 'DELETE' });
}
