/** Public store identities; credentials remain in server environment variables. */
export const STORE_APPS: Record<string, { name: string; appleId: string; asin: string; packageName: string; ascPrefix: string }> = {
  'space-race': { name: 'Space Race: 1000 Light-Years', appleId: '6788064058', asin: 'B0GXHBHD78', packageName: 'tech.spaceexplorer.spacerace', ascPrefix: 'ASC' },
  'fable-designer': { name: 'Fable Reader by Fable Designer', appleId: '6807123917', asin: 'B0HGTXJ7QQ', packageName: 'com.fabledesigner.reader', ascPrefix: 'FABLE_ASC' },
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
