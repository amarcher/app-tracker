/** Public store identities; credentials remain in server environment variables. */
export const STORE_APPS: Record<string, { name: string; appleId: string; asin: string; packageName: string; ascPrefix: string; amazonPrefix: string }> = {
  'space-race': { name: 'Space Race: 1000 Light-Years', appleId: '6788064058', asin: 'B0GXHBHD78', packageName: 'tech.spaceexplorer.spacerace', ascPrefix: 'ASC', amazonPrefix: 'AMAZON_REPORTING' },
  'fable-designer': { name: 'Fable Reader by Fable Designer', appleId: '6807123917', asin: 'B0HGTXJ7QQ', packageName: 'com.fabledesigner.reader', ascPrefix: 'FABLE_ASC', amazonPrefix: 'FABLE_AMAZON_REPORTING' },
};

export async function mapBounded<T, R>(items: T[], worker: (item: T) => Promise<R>, concurrency = 3): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await worker(items[index]); }
  }));
  return results;
}

/** Never fall back across Apple developer teams. A missing Fable key is unavailable. */
export function appleCredentials(project: string, env = process.env) {
  const prefix = STORE_APPS[project]?.ascPrefix;
  const get = (key: string) => prefix ? env[`${prefix}_${key}`] : undefined;
  return { keyId: get('KEY_ID'), issuerId: get('ISSUER_ID'), privateKey: get('PRIVATE_KEY'),
    vendorNumber: get('VENDOR_NUMBER'), salesKeyId: get('SALES_KEY_ID'), salesPrivateKey: get('SALES_PRIVATE_KEY'),
    analyticsKeyId: get('ANALYTICS_KEY_ID'), analyticsPrivateKey: get('ANALYTICS_PRIVATE_KEY') };
}

/** These apps belong to separate Amazon developer accounts, too. */
export function amazonCredentials(project: string, env = process.env) {
  const prefix = STORE_APPS[project]?.amazonPrefix;
  return { clientId: prefix ? env[`${prefix}_CLIENT_ID`] : undefined,
    clientSecret: prefix ? env[`${prefix}_CLIENT_SECRET`] : undefined };
}

/** Public provenance, not a key or token. Legacy Fable/Amazon rows used the wrong account. */
export function storeSource(project: string, store: 'apple' | 'amazon') {
  const app = STORE_APPS[project];
  if (!app) throw new Error('Unknown store project');
  return `${store}:${store === 'apple' ? app.ascPrefix : app.amazonPrefix}:${store === 'apple' ? app.appleId : app.asin}`;
}

export const trustedLegacyStore = (project: string, store: 'apple' | 'amazon') =>
  !!STORE_APPS[project] && !(project === 'fable-designer' && store === 'amazon');
