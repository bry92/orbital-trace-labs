/**
 * Experiment run record: the unit of provenance.
 *
 * Every executed calculation produces a new append-only record. Records are never
 * mutated in place; a new calculation produces a new run identifier.
 *
 * The payload hash binds a canonical representation of the scientific payload.
 * It is NOT evidence of correctness, authorship or physical validity, and it is
 * deliberately separate from exported-file (artifact) hashes.
 */

import {
  APP_NAME,
  APP_RELEASE_LABEL,
  APP_VERSION,
  BUILD_ID,
  CODE_REVISION_STATUS,
} from "./constants";
import { canonicalize, sha256Hex, utf8ByteLength } from "./canonical";
import type {
  CalculationResult,
  MetricRecord,
  ModelSpec,
  SeriesColumn,
  SolverDescriptor,
  VerificationCheckResult,
} from "../models/types";
import type { ValidationIssue } from "./validation";

export const RUN_SCHEMA_VERSION = "otl-run-v1";

export type InputOrigin = "USER_EDITED" | "PRESET_DEFAULT" | "IMPORTED";
export type DataOrigin = "LIVE_CALCULATION" | "EVIDENCE_INFORMED_RECONSTRUCTION";

export interface RunParameter {
  paramId: string;
  label: string;
  enteredValue: number;
  /** Unit identifier accepted by the validation layer (e.g. "kmps"). */
  enteredUnit: string;
  /** Human-readable unit symbol for display ("km/s"). */
  enteredUnitSymbol: string;
  siValue: number;
  siUnit: string;
  origin: InputOrigin;
}

export interface RunSeries {
  columns: SeriesColumn[];
  data: Record<string, number[]>;
  decimation: {
    recordedEvery: number;
    originalSampleCount: number;
    recordedSampleCount: number;
    rule: string;
  };
}

export interface RunApp {
  name: string;
  version: string;
  releaseLabel: string;
  buildId: string;
  codeRevision: string | null;
  codeRevisionStatus: typeof CODE_REVISION_STATUS;
}

export interface HashSpec {
  algorithm: "SHA-256";
  canonicalization: string;
  includedFields: string[];
  excludedFields: string[];
  note: string;
}

export interface RunRecord {
  schemaVersion: typeof RUN_SCHEMA_VERSION;
  runId: string;
  createdAtUtc: string;
  dataOrigin: DataOrigin;
  app: RunApp;
  model: { id: string; version: string; name: string };
  scenarioName: string;
  parameters: RunParameter[];
  initialConditions: Record<string, number>;
  solver: SolverDescriptor;
  units: { internal: "SI"; display: string };
  metrics: MetricRecord[];
  series: RunSeries;
  verification: VerificationCheckResult[];
  warnings: string[];
  limitations: string[];
  assumptions: string[];
  references: { label: string; url?: string }[];
  unresolved: { item: string; reason: string }[];
  /** Populated by the review workflow when inputs are evidence-flagged. */
  evidenceFlags: string[];
  validationIssues: ValidationIssue[];
  payloadHash: string | null;
  hashStatus: "COMPUTED" | "BLOCKED";
  hashSpec: HashSpec;
}

export const HASH_SPEC: HashSpec = {
  algorithm: "SHA-256",
  canonicalization:
    "Recursive JSON canonicalisation: object keys sorted lexicographically by UTF-16 code unit, no insignificant whitespace, numbers in ECMAScript shortest round-trip form (-0 serialised as 0), non-finite numbers rejected.",
  includedFields: [
    "schemaVersion",
    "runId",
    "createdAtUtc",
    "dataOrigin",
    "app",
    "model",
    "scenarioName",
    "parameters",
    "initialConditions",
    "solver",
    "units",
    "metrics",
    "series",
    "verification",
    "warnings",
    "limitations",
    "assumptions",
    "references",
    "unresolved",
    "evidenceFlags",
    "validationIssues",
  ],
  excludedFields: ["payloadHash", "hashSpec", "hashStatus"],
  note:
    "Binds the canonical scientific payload as stored, including the recorded (possibly decimated) time series. Decimation rule is recorded in series.decimation. The hash does not prove scientific correctness, independent authorship or physical validity; export file hashes are computed separately over exact bytes.",
};

export function newRunId(now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[-:.]/g, "").slice(0, 15); // YYYYMMDDTHHMMSS
  const rand = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `OTL-${ts}-${rand}`;
}

/**
 * Decimate a series for storage, deterministically: keep indices 0, stride, 2·stride, …
 * plus the final sample. Decimation is recorded so a reader knows the series is not
 * the full integration output.
 */
export function decimateSeries(
  data: Record<string, number[]>,
  maxSamples = 3000,
): RunSeries["decimation"] & { data: Record<string, number[]> } {
  const keys = Object.keys(data);
  const n = keys.length > 0 ? data[keys[0]].length : 0;
  const stride = Math.max(1, Math.ceil(n / maxSamples));
  const indices: number[] = [];
  for (let i = 0; i < n; i += stride) indices.push(i);
  if (n > 0 && indices[indices.length - 1] !== n - 1) indices.push(n - 1);

  const out: Record<string, number[]> = {};
  for (const k of keys) out[k] = indices.map((i) => data[k][i]);

  return {
    data: out,
    recordedEvery: stride,
    originalSampleCount: n,
    recordedSampleCount: indices.length,
    rule:
      stride === 1
        ? "Full series recorded (no decimation)."
        : `Every ${stride}th sample plus the final sample. Metrics are computed from the full series before decimation.`,
  };
}

export interface BuildRunArgs {
  calculation: CalculationResult;
  model: ModelSpec;
  scenarioName: string;
  parameters: RunParameter[];
  initialConditions: Record<string, number>;
  verification: VerificationCheckResult[];
  validationIssues: ValidationIssue[];
  evidenceFlags?: string[];
  dataOrigin: DataOrigin;
  createdAt?: Date;
  maxStoredSamples?: number;
}

export async function buildRunRecord(args: BuildRunArgs): Promise<RunRecord> {
  const createdAt = args.createdAt ?? new Date();
  const decimated = decimateSeries(args.calculation.series, args.maxStoredSamples ?? 3000);
  const { data: seriesData, ...decimation } = decimated;

  const record: RunRecord = {
    schemaVersion: RUN_SCHEMA_VERSION,
    runId: newRunId(createdAt),
    createdAtUtc: createdAt.toISOString(),
    dataOrigin: args.dataOrigin,
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      releaseLabel: APP_RELEASE_LABEL,
      buildId: BUILD_ID,
      codeRevision: null,
      codeRevisionStatus: CODE_REVISION_STATUS,
    },
    model: { id: args.model.id, version: args.model.version, name: args.model.name },
    scenarioName: args.scenarioName,
    parameters: args.parameters,
    initialConditions: args.initialConditions,
    solver: args.calculation.solver,
    units: {
      internal: "SI",
      display: "All series values are SI (m, s, m/s, J/kg, m^2/s, 1). Parameters keep the unit the researcher entered.",
    },
    metrics: args.calculation.metrics,
    series: {
      columns: args.calculation.columns,
      data: seriesData,
      decimation,
    },
    verification: args.verification,
    warnings: [...args.calculation.warnings, ...args.validationIssues.filter((i) => i.severity === "warning").map((i) => i.message)],
    limitations: args.calculation.limitations,
    assumptions: args.model.assumptions,
    references: args.model.references.map((r) => ({ label: r.label, url: r.url })),
    unresolved: args.calculation.unresolved,
    evidenceFlags: args.evidenceFlags ?? [],
    validationIssues: args.validationIssues,
    payloadHash: null,
    hashStatus: "BLOCKED",
    hashSpec: HASH_SPEC,
  };

  try {
    record.payloadHash = await computePayloadHash(record);
    record.hashStatus = "COMPUTED";
  } catch {
    record.payloadHash = null;
    record.hashStatus = "BLOCKED";
  }

  return record;
}

/** Hash payload = the record minus the hash fields themselves (no recursion). */
function payloadOf(record: RunRecord): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...record };
  delete clone.payloadHash;
  delete clone.hashSpec;
  delete clone.hashStatus;
  return clone;
}

export async function computePayloadHash(record: RunRecord): Promise<string> {
  return sha256Hex(canonicalize(payloadOf(record)));
}

export async function verifyStoredHash(
  record: RunRecord,
): Promise<{ ok: boolean; computed: string | null; recorded: string | null; bytes: number }> {
  const canonicalPayload = canonicalize(payloadOf(record));
  const computed = await sha256Hex(canonicalPayload);
  return {
    ok: record.payloadHash !== null && computed === record.payloadHash,
    computed,
    recorded: record.payloadHash,
    bytes: utf8ByteLength(canonicalPayload),
  };
}
