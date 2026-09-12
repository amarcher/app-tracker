import { describe, it, expect, vi, afterEach } from 'vitest';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { parseCsv, pick, unpackReport, isoDate, fetchDownloads, summarizeIngestedStats } from '../amazon-appstore';

// Amazon hands back a zipped CSV; build one the way a zip writer would so the
// hand-rolled reader is exercised against a real local file header.
function makeZip(name: string, content: string, method: 0 | 8 = 8): Buffer {
  const body = method === 0 ? Buffer.from(content) : deflateRawSync(Buffer.from(content));
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(method, 8);
  header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(Buffer.byteLength(content), 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, Buffer.from(name), body]);
}

describe('unpackReport', () => {
  it('reads a deflated zip entry', () => {
    expect(unpackReport(makeZip('sales.csv', 'a,b\n1,2\n'))).toBe('a,b\n1,2\n');
  });

  it('reads a stored (uncompressed) zip entry', () => {
    expect(unpackReport(makeZip('sales.csv', 'a,b\n1,2\n', 0))).toBe('a,b\n1,2\n');
  });

  it('falls back to gzip', () => {
    expect(unpackReport(gzipSync(Buffer.from('x,y\n')))).toBe('x,y\n');
  });

  it('falls back to plain text', () => {
    expect(unpackReport(Buffer.from('x,y\n'))).toBe('x,y\n');
  });

  it('inflates to the end when a streamed zip leaves the size at 0', () => {
    const zip = makeZip('sales.csv', 'a,b\n1,2\n');
    zip.writeUInt32LE(0, 18);
    expect(unpackReport(zip)).toBe('a,b\n1,2\n');
  });
});

describe('parseCsv', () => {
  it('maps rows onto header columns', () => {
    const rows = parseCsv('Marketplace,Units\nAmazon.com,1\n');
    expect(rows).toEqual([{ Marketplace: 'Amazon.com', Units: '1' }]);
  });

  it('keeps commas inside quoted fields', () => {
    const rows = parseCsv('Title,Units\n"Space Race: 1000 Light Years, Deluxe",1\n');
    expect(rows[0].Title).toBe('Space Race: 1000 Light Years, Deluxe');
    expect(rows[0].Units).toBe('1');
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('Title\n"He said ""hi"""\n')[0].Title).toBe('He said "hi"');
  });

  it('handles CRLF line endings and a missing trailing newline', () => {
    const rows = parseCsv('A,B\r\n1,2\r\n3,4');
    expect(rows).toEqual([{ A: '1', B: '2' }, { A: '3', B: '4' }]);
  });

  it('returns nothing for an empty report', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('pick', () => {
  it('matches a column regardless of case, spacing and punctuation', () => {
    const row = { 'Daily Installs (unique)': '7' };
    expect(pick(row, 'daily_installs_unique')).toBe('7');
  });

  it('falls through to the next candidate spelling', () => {
    expect(pick({ 'Transaction Date': '2026-08-05' }, 'Transaction Time', 'Transaction Date')).toBe('2026-08-05');
  });

  it('returns undefined when no candidate matches', () => {
    expect(pick({ Units: '1' }, 'ASIN')).toBeUndefined();
  });
});

describe('isoDate', () => {
  it('takes the date part of an ISO timestamp', () => {
    expect(isoDate('2026-08-05T14:23:11Z')).toBe('2026-08-05');
  });

  it('converts US-style dates', () => {
    expect(isoDate('8/5/2026 14:23:11 PDT')).toBe('2026-08-05');
  });

  it('rejects anything else', () => {
    expect(isoDate('n/a')).toBeNull();
    expect(isoDate(undefined)).toBeNull();
  });
});

describe('fetchDownloads', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Dated relative to now so the row always falls inside the 30-day window —
  // a hardcoded date would silently start failing next month.
  const SALE_DATE = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const THIS_MONTH = new Date().toISOString().slice(0, 7);
  const SALES_CSV = [
    'Marketplace,Transaction Time,Asin,Title,Item Type,Units,Sales Price (Marketplace Currency)',
    `Amazon.com,${SALE_DATE}T09:14:02Z,B0FAKE1234,Space Race,Apps,1,0`,
  ].join('\n');

  // Any month Amazon has no report for answers 400 "Report not found" rather
  // than 404 — that is the default here, since a 30-day range routinely spans
  // a month the app was not yet live in.
  function stubFetch(monthResponses: Record<string, { status: number; body: string }>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const month = String(url).match(/sales\/(\d{4})\/(\d{2})/);
      if (month) {
        const r = monthResponses[`${month[1]}-${month[2]}`] ?? { status: 400, body: 'Report not found' };
        return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => r.body };
      }
      return { status: 200, ok: true, arrayBuffer: async () => Buffer.from(SALES_CSV) };
    }));
  }

  const withReport = { [THIS_MONTH]: { status: 200, body: 'https://s3.example.com/report.zip' } };

  it('skips empty months and still counts the month that has data', async () => {
    stubFetch(withReport);
    const result = await fetchDownloads('B0FAKE1234', 'token', 30);
    expect(result.available).toBe(true);
    expect(result.totals.downloads).toBe(1);
    expect(result.timeseries.find((d) => d.date === SALE_DATE)?.downloads).toBe(1);
  });

  it('surfaces a 400 that is not "Report not found"', async () => {
    stubFetch({ [THIS_MONTH]: { status: 400, body: 'Invalid vendor' } });
    await expect(fetchDownloads('B0FAKE1234', 'token', 30)).rejects.toThrow(/Invalid vendor/);
  });

  it('ignores rows for a different ASIN', async () => {
    stubFetch(withReport);
    expect((await fetchDownloads('B0OTHER000', 'token', 30)).totals.downloads).toBe(0);
  });

  it('excludes IAP and subscription rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const month = String(url).match(/sales\/(\d{4})\/(\d{2})/);
      if (month) {
        // Only the current month serves a report, so the one CSV is not
        // counted once per month spanned by the range.
        return `${month[1]}-${month[2]}` === THIS_MONTH
          ? { status: 200, ok: true, text: async () => 'https://s3.example.com/report.zip' }
          : { status: 400, ok: false, text: async () => 'Report not found' };
      }
      return {
        status: 200,
        ok: true,
        arrayBuffer: async () => Buffer.from([
          'Marketplace,Transaction Time,Asin,Item Type,Units',
          `Amazon.com,${SALE_DATE}T09:14:02Z,B0FAKE1234,Apps,1`,
          `Amazon.com,${SALE_DATE}T10:00:00Z,B0FAKE1234,IAP,5`,
          `Amazon.com,${SALE_DATE}T11:00:00Z,B0FAKE1234,Subscription,3`,
        ].join('\n')),
      };
    }));
    expect((await fetchDownloads('B0FAKE1234', 'token', 30)).totals.downloads).toBe(1);
  });
});

describe('safe Amazon attribution and totals', () => {
  it('refuses an account-wide download query', async () => {
    await expect(fetchDownloads(undefined, 'token', 7)).rejects.toThrow(/explicit app ASIN/);
  });
  it('keeps absent monthly reports unavailable rather than reporting zero', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 404 })));
    const result = await fetchDownloads('B0FAKE1234', 'token', 7);
    expect(result.complete).toBe(false);
    expect(result.timeseries.every(day => !day.reportAvailable)).toBe(true);
    vi.unstubAllGlobals();
  });
  it('uses the explicit rollup without adding its segments', () => {
    const rows = [
      { date: '2026-09-09', device_type: 'all', marketplace: 'all', daily_installs_unique: 4, dau: 7, mau: 11 },
      { date: '2026-09-09', device_type: 'Fire tablet', marketplace: 'Amazon.com', daily_installs_unique: 3, dau: 5, mau: 9 },
    ];
    const report = summarizeIngestedStats(rows);
    expect(report.totals.installs).toBe(4);
    expect(report.totals.latestDau).toBe(7);
    expect(report.totals.currentInstalls).toBeNull();
  });
  it('does not invent unique-user totals from overlapping or suppressed segments', () => {
    const report = summarizeIngestedStats([
      { date: '2026-09-09', device_type: 'Fire tablet', marketplace: 'Amazon.com', dau: 5 },
      { date: '2026-09-09', device_type: 'Fire TV', marketplace: 'Amazon.com', dau: 3 },
    ]);
    expect(report.totals.latestDau).toBeNull();
    expect(report.totals.installs).toBeNull();
  });
});
