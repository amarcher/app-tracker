export interface TrafficDataPoint {
  date: string;
  pageviews: number;
  sessions: number;
  users: number;
  newUsers: number;
  engagementRate: number;
  avgSessionDuration: number;
  bounceRate: number;
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
  engagementRate: number;
  avgSessionDuration: number;
}

export interface GaTrafficResponse {
  timeseries: TrafficDataPoint[];
  topPages: TopPage[];
  sources: TrafficSource[];
  totals: {
    pageviews: number;
    sessions: number;
    users: number;
    newUsers: number;
    engagementRate: number;
    avgSessionDuration: number;
    bounceRate: number;
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
  estimatedCost: number;
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
  totalCost: number;
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

export interface PortfolioProject {
  project: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  characters: number;
  estimatedCost: number;
}

export interface PortfolioResponse {
  projects: PortfolioProject[];
}

export interface TrafficOverviewProjectTotals {
  pageviews: number;
  sessions: number;
  users: number;
  newUsers: number;
  engagementRate: number;
  avgSessionDuration: number;
}

export interface TrafficOverviewProject {
  project: string;
  current: TrafficOverviewProjectTotals;
  previous: TrafficOverviewProjectTotals | null;
  usersChangePct: number;
  pageviewsChangePct: number;
}

export interface TrafficOverviewResponse {
  projects: TrafficOverviewProject[];
  range: string;
}

export interface AgentStatsConversation {
  conversationId: string;
  agentName: string;
  startTimeUnix: number;
  durationSecs: number;
  messageCount: number;
  callSuccessful: string;
  summaryTitle: string | null;
}

export interface AgentStatsResponse {
  hasAgents: boolean;
  totals: {
    conversations: number;
    totalDurationSecs: number;
    avgDurationSecs: number;
    messages: number;
    successRate: number;
    successful?: number;
    failed?: number;
  };
  recentConversations: AgentStatsConversation[];
}

export interface PosthogEventTotal {
  event: string;
  label: string;
  count: number;
}

export interface PosthogTimeseriesPoint {
  date: string;
  [event: string]: string | number;
}

export interface PosthogTopItem {
  name: string;
  count: number;
}

export interface PosthogResponse {
  totals: PosthogEventTotal[];
  timeseries: PosthogTimeseriesPoint[];
  topItems: PosthogTopItem[];
}

export interface SearchConsoleMetric {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchConsoleQuery extends SearchConsoleMetric {
  query: string;
}

export interface SearchConsolePage extends SearchConsoleMetric {
  page: string;
}

export interface SearchConsoleOpportunity extends SearchConsoleMetric {
  type: 'striking-distance' | 'low-ctr';
  label: string;
  detail: string;
}

export interface SearchConsoleResponse {
  connected: boolean;
  setupError?: string;
  siteUrl: string | null;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  totals: SearchConsoleMetric;
  queries: SearchConsoleQuery[];
  pages: SearchConsolePage[];
  timeseries?: Array<{ date: string } & SearchConsoleMetric>;
  opportunities: SearchConsoleOpportunity[];
}

export interface SearchConsoleProjectStatus {
  project: string;
  domain: string;
  status: 'active' | 'connected-no-data' | 'missing-property' | 'query-error';
  siteUrl: string | null;
  permissionLevel?: string;
  clicks: number;
  impressions: number;
  error?: string;
}

export interface SearchConsoleSitesResponse {
  setupError?: string;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  sites: Array<{
    siteUrl: string;
    permissionLevel?: string;
  }>;
  projects: SearchConsoleProjectStatus[];
}

export type DateRange = '1d' | '7d' | '30d' | '90d';
