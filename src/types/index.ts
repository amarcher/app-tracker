export interface TrafficDataPoint {
  date: string;
  pageviews: number;
  sessions: number;
  users: number;
}

export interface TopPage {
  path: string;
  pageviews: number;
  sessions: number;
}

export interface TrafficSource {
  source: string;
  medium: string;
  sessions: number;
  users: number;
}

export interface GaTrafficResponse {
  timeseries: TrafficDataPoint[];
  topPages: TopPage[];
  sources: TrafficSource[];
  totals: {
    pageviews: number;
    sessions: number;
    users: number;
  };
}

export interface ElevenLabsUsagePoint {
  date: string;
  characters: number;
}

export interface ElevenLabsResponse {
  timeseries: ElevenLabsUsagePoint[];
  productBreakdown: Record<string, number>;
  subscription: {
    characterCount: number;
    characterLimit: number;
    tier: string;
    nextResetUnix: number;
  };
}

export interface ApiUsageTimeseriesRow {
  day: string;
  service: string;
  tokens_in: number;
  tokens_out: number;
  characters: number;
  requests: number;
}

export interface ApiUsageTotalRow {
  service: string;
  tokens_in: number;
  tokens_out: number;
  characters: number;
  requests: number;
}

export interface ApiUsageRecentCall {
  timestamp: string;
  service: string;
  endpoint: string;
  tokens_in: number;
  tokens_out: number;
  characters: number;
  model: string | null;
  metadata: Record<string, unknown>;
}

export interface ApiUsageResponse {
  timeseries: ApiUsageTimeseriesRow[];
  totals: ApiUsageTotalRow[];
  recentCalls: ApiUsageRecentCall[];
}

export interface CdnDataPoint {
  date: string;
  bytes: number;
  cachedBytes: number;
  requests: number;
  cachedRequests: number;
}

export interface CdnResponse {
  timeseries: CdnDataPoint[];
  totals: {
    bandwidth: number;
    cachedBandwidth: number;
    requests: number;
    cachedRequests: number;
    cacheHitRatio: number;
  };
  r2: {
    objectCount: number;
    storageSizeBytes: number;
    bucketName: string;
  } | null;
}

export type DateRange = '7d' | '14d' | '30d' | '90d';
