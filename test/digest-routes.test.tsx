import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const GOOD = '2026-10-28';
const EMPTY = '2026-10-27';
const BAD = '2026-10-26';
const MISSING = '2026-10-25';

const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error ? { error } : {}) });

// Written in non-sorted job order on purpose: the routes must show rows sorted by job.
const goodLines = [
  line('2026-10-28T01:00:00+01:00', 'zeta-sync', 'ok', null),
  line('2026-10-28T01:05:00+01:00', 'alpha-backup', 'retry', 'dana', 'timeout'),
  line('2026-10-28T01:10:00+01:00', 'alpha-backup', 'retry', 'dana', 'timeout'),
  line('2026-10-28T01:15:00+01:00', 'alpha-backup', 'retry', 'dana', 'timeout'),
  line('2026-10-28T01:20:00+01:00', 'alpha-backup', 'ok', 'dana'),
  line('2026-10-28T01:30:00+01:00', 'mid-build', 'fail', 'omar', 'exit 2'),
];
const JOBS_SORTED = ['alpha-backup', 'mid-build', 'zeta-sync'];

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, `${GOOD}.jsonl`), goodLines.join('\n') + '\n');
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(
    join(runsDir, `${BAD}.jsonl`),
    [
      line('2026-10-26T02:00:00+01:00', 'beta-report', 'ok', 'dana'),
      'this is not json',
      line('2026-10-26T02:10:00+01:00', 'gamma-clean', 'ok', 'omar'),
    ].join('\n') + '\n',
  );
  app = createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

const page = (night: string) => app.request(`/digest/${night}`);
const json = (night: string) => app.request(`/api/digest/${night}`);

// Order in which the given job names first appear in the html.
function orderIn(html: string, jobs: string[]) {
  return jobs
    .map((job) => ({ job, at: html.indexOf(job) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.job);
}

// The <tr> chunk that mentions a job.
function rowOf(html: string, job: string) {
  const chunk = html.split(/<tr[\s>]/).find((c) => c.includes(job));
  expect(chunk, `row for ${job}`).toBeDefined();
  return chunk as string;
}

describe('GET /digest/:night', () => {
  it('200 with one row per job, sorted by job', async () => {
    const res = await page(GOOD);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html.match(/<table[\s>]/g)).toHaveLength(1);
    expect(orderIn(html, JOBS_SORTED)).toEqual(JOBS_SORTED);
  });

  it('marks retries >= 3 and fail rows as warn, not the clean row', async () => {
    const html = await (await page(GOOD)).text();
    expect(rowOf(html, 'alpha-backup')).toContain('warn');
    expect(rowOf(html, 'mid-build')).toContain('warn');
    expect(rowOf(html, 'zeta-sync')).not.toContain('warn');
  });

  it('renders a null owner as an em dash', async () => {
    const html = await (await page(GOOD)).text();
    expect(rowOf(html, 'zeta-sync')).toContain('—');
  });

  it('404 for a night with no file', async () => {
    expect((await page(MISSING)).status).toBe(404);
  });

  it('says "nothing ran" for the empty night', async () => {
    const res = await page(EMPTY);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('still renders the good rows when a line is bad', async () => {
    const res = await page(BAD);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('beta-report');
    expect(html).toContain('gamma-clean');
  });
});

describe('GET /api/digest/:night', () => {
  it('200 with the Night object', async () => {
    const res = await json(GOOD);
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.night).toBe(GOOD);
    expect(night.badLines).toBe(0);
    expect(night.rows.map((r) => r.job)).toEqual(JOBS_SORTED);
    const alpha = night.rows.find((r) => r.job === 'alpha-backup');
    expect(alpha).toMatchObject({ owner: 'dana', runs: 4, retries: 3, lastStatus: 'ok' });
    const mid = night.rows.find((r) => r.job === 'mid-build');
    expect(mid).toMatchObject({ lastStatus: 'fail', lastError: 'exit 2' });
    expect(night.rows.find((r) => r.job === 'zeta-sync')?.owner).toBeNull();
  });

  it('404 for a night with no file', async () => {
    expect((await json(MISSING)).status).toBe(404);
  });

  it('returns rows: [] and badLines 0 for the empty night', async () => {
    const res = await json(EMPTY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: EMPTY, rows: [], badLines: 0 });
  });

  it('counts a bad line and still returns the good rows', async () => {
    const res = await json(BAD);
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.badLines).toBe(1);
    expect(night.rows.map((r) => r.job)).toEqual(['beta-report', 'gamma-clean']);
  });
});

describe('page and JSON agree', () => {
  it.each([GOOD, BAD])('same jobs in the same order for %s', async (n) => {
    const night = (await (await json(n)).json()) as Night;
    const jobs = night.rows.map((r) => r.job);
    const html = await (await page(n)).text();
    expect(orderIn(html, jobs)).toEqual(jobs);
  });
});
