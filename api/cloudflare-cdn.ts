import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN?.trim();
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();

const ZONES: Record<string, { zoneId: string; cdnHost: string }> = {
  'animal-penpals': {
    zoneId: process.env.CLOUDFLARE_ZONE_ID_ANIMAL_PENPALS || '',
    cdnHost: 'videos.animalpenpals.tech',
  },
  'periodic-table': {
    zoneId: process.env.CLOUDFLARE_ZONE_ID_PERIODIC_TABLE || '',
    cdnHost: 'videos.periodictable.tech',
  },
  'space-explorer': {
    zoneId: process.env.CLOUDFLARE_ZONE_ID_SPACE_EXPLORER || '',
    cdnHost: 'assets.spaceexplorer.tech',
  },
};

const R2_BUCKETS: Record<string, string> = {
  'periodic-table': 'periodic-table-elements',
  'animal-penpals': 'animal-penpals-videos',
  'space-explorer': 'solar-system-textures',
};

function daysAgoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

async function queryGraphQL(query: string, variables: Record<string, unknown>) {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cloudflare GraphQL error ${res.status}: ${text}`);
  }
  return res.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const range = (req.query.range as string) || '30d';
    const days = parseInt(range.replace('d', ''), 10) || 30;
    const project = (req.query.project as string) || '';

    const zone = ZONES[project];
    if (zone) {
      zone.zoneId = zone.zoneId.trim();
    }
    if (!zone || !zone.zoneId) {
      return res.status(400).json({ error: `No Cloudflare zone configured for project: ${project}` });
    }

    const since = daysAgoDate(days);
    const until = daysAgoDate(0);

    // Fetch HTTP stats and R2 storage in parallel
    // Cloudflare GraphQL uses inline filter values, not standard variables
    const httpQuery = `{
      viewer {
        zones(filter: { zoneTag: "${zone.zoneId}" }) {
          httpRequests1dGroups(
            filter: { date_geq: "${since}", date_leq: "${until}" }
            orderBy: [date_ASC]
            limit: 1000
          ) {
            dimensions { date }
            sum {
              bytes
              requests
              cachedBytes
              cachedRequests
            }
          }
        }
      }
    }`;

    const bucketName = R2_BUCKETS[project];
    const yesterday = daysAgoDate(1);

    const r2Query = `{
      viewer {
        accounts(filter: { accountTag: "${CLOUDFLARE_ACCOUNT_ID}" }) {
          r2StorageAdaptiveGroups(
            filter: { date: "${yesterday}", bucketName: "${bucketName}" }
            limit: 1
          ) {
            max {
              objectCount
              payloadSize
              metadataSize
            }
          }
        }
      }
    }`;

    const [httpResult, r2Result] = await Promise.all([
      queryGraphQL(httpQuery, {}),
      bucketName && CLOUDFLARE_ACCOUNT_ID
        ? queryGraphQL(r2Query, {}).catch(() => null)
        : Promise.resolve(null),
    ]);

      const httpGroups = httpResult?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];

    const timeseries = httpGroups.map((g: any) => ({
      date: g.dimensions.date.replace(/-/g, ''),
      bytes: g.sum.bytes,
      cachedBytes: g.sum.cachedBytes,
      requests: g.sum.requests,
      cachedRequests: g.sum.cachedRequests,
    }));

    const totals = timeseries.reduce(
      (acc: any, d: any) => ({
        bandwidth: acc.bandwidth + d.bytes,
        cachedBandwidth: acc.cachedBandwidth + d.cachedBytes,
        requests: acc.requests + d.requests,
        cachedRequests: acc.cachedRequests + d.cachedRequests,
      }),
      { bandwidth: 0, cachedBandwidth: 0, requests: 0, cachedRequests: 0 }
    );
    totals.cacheHitRatio = totals.requests > 0
      ? (totals.cachedRequests / totals.requests) * 100
      : 0;

    let r2 = null;
    const r2Groups = r2Result?.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups;
    if (r2Groups && r2Groups.length > 0) {
      r2 = {
        objectCount: r2Groups[0].max.objectCount,
        storageSizeBytes: r2Groups[0].max.payloadSize + (r2Groups[0].max.metadataSize || 0),
        bucketName: bucketName,
      };
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ timeseries, totals, r2 });
  } catch (error) {
    console.error('Cloudflare CDN API error:', error);
    res.status(500).json({ error: 'Failed to fetch Cloudflare CDN data' });
  }
}
