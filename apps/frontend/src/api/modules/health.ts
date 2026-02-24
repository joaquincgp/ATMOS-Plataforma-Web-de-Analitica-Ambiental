import { apiRequest } from '@/api/http-client';

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  environment: string;
}

export function getHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/api/v1/health');
}
