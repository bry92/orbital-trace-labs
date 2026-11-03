/**
 * Experiment run record: the unit of provenance.
 *
 * Every executed calculation produces a new append-only record. Records are never
 * mutated in place; a new calculation produces a new run identifier.
 *
 * Three distinct integrity concepts are kept apart (see RESULT_HASH_SPEC):
 *   1. RESULT IDENTITY — what was computed. Binds the numerical result, its inputs,
 *      and the model/method identity. Independent of when it ran and on which build.
 *   2. PROVENANCE — when and by which build it ran (runId, createdAtUtc, buildId,
 *      codeRevision, per-check wall-clock timings). RECORDED but NOT BOUND by the
 *      result hash, because none of it is part of the answer.
 *   3. EXACT BYTE INTEGRITY — the SHA-256 of each exported file, computed in
 *      export/serialize.ts over the file's exact bytes. A different property again.
 *
 * None of the three is evidence of correctness, authorship or physical validity.
 *
 * Legacy scope: records written before this distinction existed hashed the whole
 * record, including wall-clock timings. Those hashes are still verified against the
 * legacy scope and reported as LEGACY, never as tampering.
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
  /**
   * Scope identifier. Absent on records written before the scope was named, which is
   * how a legacy record is recognised without guessing from the hash itself.
   */
  id?: string;
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

/** Scope identifier stamped into hashSpec so a record's hash scope is self-describing. */
export const RESULT_HASH_ID = "otl-result-hash-v1";
/** Scope identifier for the pre-repair whole-record hash. Recognised, never produced. */
export const LEGACY_HASH_ID = "otl-legacy-payload-hash";

export const RESULT_HASH_SPEC: HashSpec = {
  id: RESULT_HASH_ID,
  algorithm: "SHA-256",
  canonicalization:
    "Recursive JSON canonicalisation: object keys sorted lexicographically by UTF-16 code unit, no insignificant whitespace, numbers in ECMAScript shortest round-trip form (-0 serialised as 0), non-finite numbers rejected.",
  includedFields: [
    "schemaVersion",
    "dataOrigin",
    "app.name",
    "app.version",
    "app.releaseLabel",
    "model.id",
    "model.version",
    "model.name",
    "parameters",
    "initialConditions",
    "solver",
    "units",
    "metrics",
    "series",
    "verification[].checkId",
    "verification[].title",
    "verification[].modelId",
    "verification[].criterion",
    "verification[].expectedBehavior",
    "verification[].measuredValue",
    "verification[].measuredUnit",
    "verification[].tolerance",
    "verification[].toleranceJustification",
    "verification[].method",
    "verification[].outcome",
    "verification[].evidence",
    "verification[].limitations",
    "warnings",
    "limitations",
    "assumptions",
    "references",
    "unresolved",
    "evidenceFlags",
    "validationIssues",
  ],
  excludedFields: [
    "runId",
    "createdAtUtc",
    "scenarioName",
    "app.buildId",
    "app.codeRevision",
    "app.codeRevisionStatus",
    "verification[].durationMs",
    "payloadHash",
    "hashSpec",
    "hashStatus",
  ],
  note:
    "Result identity: binds what was computed — inputs, initial conditions, solver settings, metrics, the recorded (possibly decimated) series, and every verification field except its wall-clock duration — plus the model and application release that define how to read it. Two fields that are easy to confuse: app.releaseLabel IS bound (it identifies which application release defines the result), while scenarioName is NOT (it is a researcher-chosen label that does not change the answer). Run id, execution time, build id, code revision and per-check timings are recorded but NOT bound, because they are provenance rather than result: re-running identical inputs on a later build must produce the same digest. This digest is not evidence of scientific correctness, authorship or physical validity, and it says nothing about the exact bytes of an exported file (that is a separate SHA-256 over file bytes).",
};

/**
 * The pre-repair hash scope, retained so existing records and exports keep verifying.
 * It hashed the entire stored record apart from the hash fields themselves, which
 * included run id, execution time, build id and per-check timings. Nothing is ever
 * written with this scope; it is recognised and labelled, not produced.
 */
export const LEGACY_HASH_SPEC: HashSpec = {
  id: LEGACY_HASH_ID,
  algorithm: "SHA-256",
  canonicalization:
    "Recursive JSON canonicalisation: object keys sorted lexicographically by UTF-16 code unit, no insignificant whitespace, numbers in ECMAScript shortest round-trip form (-0 serialised as 0), non-finite numbers rejected.",
  includedFields: ["every stored field except payloadHash, hashSpec and hashStatus"],
  excludedFields: ["payloadHash", "hashSpec", "hashStatus"],
  note:
    "LEGACY SCOPE (pre-repair). Bound the whole record, including run id, execution time, build identifier and per-check wall-clock timings, so identical results on different runs produced different digests. Retained only so historical records and exports can still be verified; a record matching this scope is integrity-intact, not tampered with.",
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
/** Ordinal suffix for a count: 1st, 2nd, 3rd, 4th, 11th, 21st, 112th. */
export function sampleOrdinal(n: number): string {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (Math.abs(n) % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

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
        : `Every ${sampleOrdinal(stride)} sample plus the final sample. Metrics are computed from the full series before decimation.`,
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
    // Every array and object below is copied rather than referenced. The model modules
    // return module-level constants (e.g. `limitations: TWO_BODY_MODEL.limitations`,
    // `columns: COLUMNS`), so storing them by reference would alias every record to the
    // model registry: mutating one record would silently rewrite global model metadata
    // and change the result hash of every record produced afterwards.
    parameters: args.parameters.map((p) => ({ ...p })),
    initialConditions: { ...args.initialConditions },
    solver: { ...args.calculation.solver, settings: { ...args.calculation.solver.settings } },
    units: {
      internal: "SI",
      display: "All series values are SI (m, s, m/s, J/kg, m^2/s, 1). Parameters keep the unit the researcher entered.",
    },
    metrics: args.calculation.metrics.map((m) => ({ ...m })),
    series: {
      columns: args.calculation.columns.map((c) => ({ ...c })),
      data: seriesData,
      decimation,
    },
    verification: args.verification.map((v) => ({ ...v })),
    warnings: [...args.calculation.warnings, ...args.validationIssues.filter((i) => i.severity === "warning").map((i) => i.message)],
    limitations: [...args.calculation.limitations],
    assumptions: [...args.model.assumptions],
    references: args.model.references.map((r) => ({ label: r.label, url: r.url })),
    unresolved: args.calculation.unresolved.map((u) => ({ ...u })),
    evidenceFlags: [...(args.evidenceFlags ?? [])],
    validationIssues: args.validationIssues.map((i) => ({ ...i })),
    payloadHash: null,
    hashStatus: "BLOCKED",
    hashSpec: RESULT_HASH_SPEC,
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

/**
 * The exact object that result identity is computed over. Built field by field, and
 * verification entries field by field, so an accidental new field cannot silently
 * join the scope: adding one here is a deliberate, reviewable act.
 */
export function resultPayloadOf(record: RunRecord): Record<string, unknown> {
  return {
    schemaVersion: record.schemaVersion,
    dataOrigin: record.dataOrigin,
    app: {
      name: record.app.name,
      version: record.app.version,
      releaseLabel: record.app.releaseLabel,
    },
    model: {
      id: record.model.id,
      version: record.model.version,
      name: record.model.name,
    },
    parameters: record.parameters,
    initialConditions: record.initialConditions,
    solver: record.solver,
    units: record.units,
    metrics: record.metrics,
    series: record.series,
    verification: record.verification.map((v) => ({
      checkId: v.checkId,
      title: v.title,
      modelId: v.modelId,
      criterion: v.criterion,
      expectedBehavior: v.expectedBehavior,
      measuredValue: v.measuredValue,
      measuredUnit: v.measuredUnit,
      tolerance: v.tolerance,
      toleranceJustification: v.toleranceJustification,
      method: v.method,
      outcome: v.outcome,
      evidence: v.evidence,
      limitations: v.limitations,
    })),
    warnings: record.warnings,
    limitations: record.limitations,
    assumptions: record.assumptions,
    references: record.references,
    unresolved: record.unresolved,
    evidenceFlags: record.evidenceFlags,
    validationIssues: record.validationIssues,
  };
}

/** The pre-repair payload: the whole record minus the hash fields. Read-only path. */
export function legacyPayloadOf(record: RunRecord): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...record };
  delete clone.payloadHash;
  delete clone.hashSpec;
  delete clone.hashStatus;
  return clone;
}

export async function computePayloadHash(record: RunRecord): Promise<string> {
  return sha256Hex(canonicalize(resultPayloadOf(record)));
}

export async function computeLegacyPayloadHash(record: RunRecord): Promise<string> {
  return sha256Hex(canonicalize(legacyPayloadOf(record)));
}

export type HashScope = "RESULT" | "LEGACY" | "MISMATCH";

export interface StoredHashCheck {
  /** RESULT = matches this build's result-identity scope. LEGACY = matches the old
   *  whole-record scope. MISMATCH = matches neither, so the content changed. */
  scope: HashScope;
  /** True only for RESULT. LEGACY is intact-but-different-scope, never tampering. */
  ok: boolean;
  computed: string;
  legacyComputed: string;
  recorded: string | null;
  bytes: number;
}

/**
 * Verify a stored hash against both scopes. A digest that matches neither is the only
 * outcome reported as a content change; a legacy-scope match is reported as LEGACY so
 * that a hash-specification change can never be displayed as tampering.
 */
export async function verifyStoredHash(record: RunRecord): Promise<StoredHashCheck> {
  const canonicalPayload = canonicalize(resultPayloadOf(record));
  const computed = await sha256Hex(canonicalPayload);
  const legacyComputed = await computeLegacyPayloadHash(record);
  const recorded = record.payloadHash;
  const scope: HashScope =
    recorded !== null && recorded === computed
      ? "RESULT"
      : recorded !== null && recorded === legacyComputed
        ? "LEGACY"
        : "MISMATCH";
  return {
    scope,
    ok: scope === "RESULT",
    computed,
    legacyComputed,
    recorded,
    bytes: utf8ByteLength(canonicalPayload),
  };
}
/**
 * Re-bind a record to the current result-identity scope. This is the ONLY mutation
 * permitted on a stored record: the result, its inputs and its provenance — run id,
 * execution time, build id, code revision — are all preserved byte for byte. It
 * exists so a legacy record can be brought to the current scope without being
 * re-executed, and it must be invoked explicitly by the user.
 */
export async function rehashRecord(record: RunRecord): Promise<RunRecord> {
  return {
    ...record,
    payloadHash: await computePayloadHash(record),
    hashStatus: "COMPUTED",
    hashSpec: RESULT_HASH_SPEC,
  };
}
