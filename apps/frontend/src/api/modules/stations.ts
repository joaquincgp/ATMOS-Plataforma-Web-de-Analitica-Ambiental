import { apiRequest } from '@/api/http-client';

export interface StationSummary {
  id: number;
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
}

export interface StationListResponse {
  items: StationSummary[];
  total: number;
}

export function listStations(): Promise<StationListResponse> {
  return apiRequest<StationListResponse>('/api/v1/stations/');
}
