import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunStatus } from './types.js';

export type StatusCounts = Record<RunStatus, number>;

// Counts the lines of runs/<night>.jsonl by status. Lines that aren't JSON or have no valid
// status are ignored. Null when the file can't be read.
export function countStatuses(runsDir: string, night: string): StatusCounts | null {
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return null;
  }
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const status: unknown = (JSON.parse(line) as { status?: unknown } | null)?.status;
      if (status === 'ok' || status === 'retry' || status === 'fail') counts[status]++;
    } catch {
      // bad line: ignored
    }
  }
  return counts;
}
