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
};
