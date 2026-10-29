import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');
  const row = (job: string) => night?.rows.find((r) => r.job === job);

  it('folds 5 jobs, sorted by job, with 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night?.night).toBe('2026-10-28');
    expect(night?.badLines).toBe(1);
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('counts runs and retries and keeps the last status and error', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(row('notes/backup')).toMatchObject({ runs: 1, lastStatus: 'fail', lastError: 'quota exceeded', owner: 'lane-07' });
    expect(row('lane/sync')).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held' });
  });

  it('keeps a null owner and times verbatim with their offset', () => {
    expect(row('digest/render')).toMatchObject({ owner: null, lastError: null, firstAt: '2026-10-29T05:41:09+01:00' });
    expect(row('rig/rotate-logs')).toMatchObject({ firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' });
    expect(row('lane/sync')).toMatchObject({ firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' });
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for a missing file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns rows [] and badLines 0 for an empty file', () => {
    writeFileSync(join(dir, '2026-01-02.jsonl'), '');
    expect(readNight(dir, '2026-01-02')).toEqual({ night: '2026-01-02', rows: [], badLines: 0 });
  });

  it('returns null for a night not in YYYY-MM-DD form', () => {
    for (const bad of ['../2026-10-28', '2026-1-2', 'latest', '', '2026-10-28.jsonl']) {
      expect(readNight(dir, bad)).toBeNull();
    }
  });

  it('skips blank lines and counts lines with the wrong shape as bad', () => {
    const lines = [
      '',
      '   ',
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":"x"}',
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"done","owner":"x"}',
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok"}',
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":7}',
      '{"job":"a","status":"ok","owner":"x"}',
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":"x","error":42}',
      '[1,2]',
      'null',
      'not json',
    ];
    writeFileSync(join(dir, '2026-01-03.jsonl'), lines.join('\n') + '\n');
    const night = readNight(dir, '2026-01-03');
    expect(night?.badLines).toBe(8);
    expect(night?.rows).toHaveLength(1);
  });
});
