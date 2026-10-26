/**
 * Append-only run storage backed by localStorage.
 *
 * - A new calculation always appends; existing records are never rewritten.
 * - A storage failure (for example quota exceeded) is reported to the caller and
 *   nothing is discarded silently.
 * - Records that fail structural validation on read are reported, not skipped
 *   silently, and are not deleted.
 */

import type { RunRecord } from "../core/run";

const STORAGE_KEY = "otl.runs.v1";

export interface LoadResult {
  runs: RunRecord[];
  error: string | null;
  storageAvailable: boolean;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadRuns(): LoadResult {
  const s = storage();
  if (!s) {
    return {
      runs: [],
      error: "localStorage is unavailable. Runs can still be executed and exported, but they will not persist across reloads.",
      storageAvailable: false,
    };
  }
  const raw = s.getItem(STORAGE_KEY);
  if (!raw) return { runs: [], error: null, storageAvailable: true };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return { runs: [], error: "Stored run collection is not an array; nothing was deleted.", storageAvailable: true };
    }
    const runs = parsed.filter(
      (r): r is RunRecord =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as RunRecord).runId === "string" &&
        typeof (r as RunRecord).schemaVersion === "string",
    );
    const rejected = parsed.length - runs.length;
    return {
      runs,
      error:
        rejected > 0
          ? `${rejected} stored record(s) failed structural validation and were excluded from the in-memory list. They have not been deleted from storage.`
          : null,
      storageAvailable: true,
    };
  } catch (err) {
    return {
      runs: [],
      error: `Stored run collection could not be parsed (${err instanceof Error ? err.message : String(err)}). Nothing was deleted.`,
      storageAvailable: true,
    };
  }
}

export function appendRun(record: RunRecord): { ok: boolean; error: string | null } {
  const s = storage();
  if (!s) return { ok: false, error: "localStorage is unavailable; run not persisted." };
  const current = loadRuns();
  if (current.runs.some((r) => r.runId === record.runId)) {
    return { ok: false, error: `Run id collision detected (${record.runId}); run not persisted.` };
  }
  const next = [...current.runs, record];
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(next));
    return { ok: true, error: null };
  } catch (err) {
    return {
      ok: false,
      error: `Could not persist run (storage may be full): ${err instanceof Error ? err.message : String(err)}. The earlier records are unchanged and the new run remains available for export in this session.`,
    };
  }
}

export function appendRuns(records: RunRecord[]): { ok: boolean; error: string | null; appended: number } {
  let appended = 0;
  for (const r of records) {
    const res = appendRun(r);
    if (!res.ok) return { ok: false, error: res.error, appended };
    appended++;
  }
  return { ok: true, error: null, appended };
}

export function storageSizeBytes(): number | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(STORAGE_KEY);
  return raw ? new TextEncoder().encode(raw).length : 0;
}
