// Plan morning-digest § 1. The contract between the run log reader and everything that shows
// a night (page, JSON, board link, route tests). Types only; the reader is issue #2 and lives
// in src/digest/read.ts as `export const readNight: ReadNight`.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, as written by the lane. A line that isn't valid JSON or
// doesn't have this shape (status outside RunStatus, owner neither string nor null, at/job
// missing or not strings) is a bad line: counted in Night.badLines, never thrown.
export type RunLine = {
  at: string; // ISO 8601 with the lane's offset, e.g. "2026-10-29T01:30:00+01:00"
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One job's night, folded from its lines in file order (the log is append-only).
export type DigestRow = {
  job: string;
  owner: string | null; // from the job's last line; views render null as "—"
  runs: number; // lines for this job, every status
  retries: number; // lines with status "retry"
  lastStatus: RunStatus; // status of the job's last line
  lastError: string | null; // error of the job's most recent line that had one, else null
  firstAt: string; // `at` of the job's first line, verbatim: keep the offset, never UTC
  lastAt: string; // `at` of the job's last line, verbatim
};

// A night that has a file on disk.
// - rows: one per job, sorted by job (plain string order, a < b). The reader sorts, so the
//   page (2a) and the JSON (2b) show rows as given and can't disagree on order.
// - rows empty: nothing ran (an empty file, blank lines only, or only bad lines). The page
//   renders "nothing ran"; the JSON returns the same object with rows: [].
// - badLines: lines that didn't parse or didn't match RunLine. Blank lines are skipped and
//   not counted.
export type Night = {
  night: string; // YYYY-MM-DD, as asked
  rows: DigestRow[];
  badLines: number;
};

// Reads <runsDir>/<night>.jsonl. Returns null when there is no such file, or when `night` is
// not YYYY-MM-DD (never a path outside runsDir); routes answer null with 404. Never throws
// for a night's content.
export type ReadNight = (runsDir: string, night: string) => Night | null;
