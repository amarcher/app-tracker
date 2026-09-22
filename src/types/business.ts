export type BusinessDay = {
  date: string;
  booksCreated: number;
  paidFinishes: number;
  subscriptionFinishes: number;
  complimentaryFinishes: number;
  printedCopies: number;
  revenueCents: number | null;
  providerSpendCents: number | null;
  marginCents: number | null;
};
export type BusinessTotals = Omit<BusinessDay, 'date'>;
export type StoreName = 'apple' | 'amazon' | 'google';
export type StoreDay = { date: string; downloads: number; updates?: number; redownloads?: number; reportAvailable?: boolean; deviceInstalls?: number | null; activeDeviceInstalls?: number | null };
export type BusinessStore = {
  store: StoreName;
  source?: string;
  available: boolean;
  reason?: string;
  timeseries: StoreDay[];
  downloads: number | null;
  latest: StoreDay | null;
  complete: boolean;
  reportingTimezone: string;
  recordedSince: string | null;
  recordedDownloads: number | null;
  /** Recorded history reaches back before the app's first release, so recordedDownloads is an all-time total. */
  recordedFromStart?: boolean;
};
export type SocialPlatform = 'instagram' | 'facebook';
export type ReelStat = { id: string; platform: SocialPlatform; title: string; url: string | null; publishedAt: string;
  views: number | null; reach: number | null; interactions: number | null };
/** Totals are lifetime sums over the listed reels; viewsInRange is growth across the report range from daily snapshots. */
export type SocialPlatformSummary = { platform: SocialPlatform; available: boolean; reason?: string; account?: string;
  reels: ReelStat[]; views: number | null; reach: number | null; interactions: number | null; viewsInRange: number | null };
export type BusinessSummary = {
  version: 1;
  generatedAt: string;
  stale?: boolean;
  range: { from: string; through: string; timezone: string };
  fable: null | {
    generatedAt: string;
    totals: BusinessTotals;
    previous: BusinessTotals;
    timeseries: BusinessDay[];
    definitions: Record<string, string>;
    caveats: string[];
  };
  fableReason?: string;
  apps: { project: string; name: string; stores: BusinessStore[] }[];
  social?: { project: string; name: string; platforms: SocialPlatformSummary[] }[];
};
