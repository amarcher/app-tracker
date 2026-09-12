import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('dry-runs a mixed-app report for Fable only, preserving suppressed values and both report types', () => {
  const dir = mkdtempSync(join(tmpdir(), 'business-import-'));
  try {
    const file = join(dir, 'report.csv');
    writeFileSync(file, 'Date,App ASIN,App Name,Device Type,Marketplace,Daily Installs (unique),Daily Active Users\n09-11-2026,B0HGTXJ7QQ,Fable,all,all,,5\n09-11-2026,B0GXHBHD78,Space,all,all,900,800\n');
    const run = spawnSync(process.execPath, ['scripts/ingest-amazon-reports.mjs', '--project', 'fable-designer', '--dry-run', file], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DOTENV_CONFIG_PATH: join(dir, 'absent.env'), DOTENV_CONFIG_QUIET: 'true', DATABASE_URL: '' } });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('1/2 rows');
    expect(run.stdout).toContain('2026-09-11');
    expect(run.stdout).toContain('null');
    expect(run.stdout).toContain('engagement');
    expect(run.stdout).toContain('B0HGTXJ7QQ');
    expect(run.stdout).not.toContain('B0GXHBHD78');
    expect(run.stdout).not.toContain('900');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
