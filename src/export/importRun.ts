/**
 * Import validation for exported run JSON.
 *
 * The importer rejects the file unless the schema version is known, the model is
 * known, every stored parameter's unit matches the model's declared quantity, and
 * the series is internally consistent. A payload hash mismatch is an integrity
 * error; an unhashed record is imported with a warning and marked unverified.
 */

import { RUN_SCHEMA_VERSION, verifyStoredHash, type HashScope, type RunRecord } from "../core/run";
import { UNITS } from "../core/units";
import { getModel } from "../models/registry";
import { twoBodyParameterSpecs, TWO_BODY_MODEL_ID, type TwoBodySolverMethod } from "../models/twoBody";

export interface ImportResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  record: RunRecord | null;
  hash: {
    status: "PASS" | "FAIL" | "BLOCKED";
    /** RESULT, LEGACY (intact under the pre-repair scope) or null when not verified. */
    scope: HashScope | null;
    computed: string | null;
    recorded: string | null;
  };
}

const REQUIRED_TOP_LEVEL = [
  "schemaVersion",
  "runId",
  "createdAtUtc",
  "app",
  "model",
  "parameters",
  "initialConditions",
  "solver",
  "metrics",
  "series",
  "verification",
  "warnings",
  "limitations",
  "assumptions",
  "unresolved",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function parseImportedRun(text: string): Promise<ImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      errors: [`File is not valid JSON: ${err instanceof Error ? err.message : String(err)}`],
      warnings,
      record: null,
      hash: { status: "BLOCKED", scope: null, computed: null, recorded: null },
    };
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      errors: ["Top-level JSON value is not an object."],
      warnings,
      record: null,
      hash: { status: "BLOCKED", scope: null, computed: null, recorded: null },
    };
  }
  // Accept a manifest-only file? No: a manifest is not a run record.
  if (parsed.schemaVersion !== RUN_SCHEMA_VERSION) {
    errors.push(
      `Unsupported schema version "${String(parsed.schemaVersion)}"; this build accepts ${RUN_SCHEMA_VERSION} only.`,
    );
  }
  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in parsed)) errors.push(`Required field "${key}" is missing.`);
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings, record: null, hash: { status: "BLOCKED", scope: null, computed: null, recorded: null } };
  }

  const record = parsed as unknown as RunRecord;

  const model = getModel(record.model?.id);
  if (!model) {
    errors.push(`Unknown model id "${String(record.model?.id)}"; the run cannot be validated or reproduced here.`);
  } else if (model.version !== record.model.version) {
    warnings.push(
      `Run was produced with ${record.model.id} v${record.model.version}; this build implements v${model.version}. Reproduction will be reported as not comparable.`,
    );
  }
  if (model && model.status !== "IMPLEMENTED") {
    errors.push(`Model ${model.id} has status ${model.status} and is not executable.`);
  }

  // Units and parameter schema.
  if (!Array.isArray(record.parameters) || record.parameters.length === 0) {
    errors.push("parameters must be a non-empty array.");
  } else if (model && model.id === TWO_BODY_MODEL_ID) {
    const method = record.solver?.method === "DOPRI5" ? "DOPRI5" : "RK4";
    const specs = twoBodyParameterSpecs(method as TwoBodySolverMethod);
    for (const param of record.parameters) {
      const spec = specs.find((s) => s.id === param.paramId);
      if (!spec) {
        errors.push(`Parameter "${param.paramId}" is not part of ${model.id} (${String(method)}) input specification.`);
        continue;
      }
      if (!Number.isFinite(param.enteredValue)) errors.push(`Parameter "${param.paramId}" has a non-finite value.`);
      const unit = UNITS[param.enteredUnit];
      if (!unit) {
        errors.push(
          `Parameter "${param.paramId}" uses unknown unit identifier "${param.enteredUnit}". Accepted identifiers are: ${Object.keys(UNITS).join(", ")}.`,
        );
        continue;
      }
      if (unit.quantity !== spec.quantity) {
        errors.push(
          `Parameter "${param.paramId}" stores unit "${unit.symbol}" (${unit.quantity}) but the model expects ${spec.quantity}.`,
        );
      }
      if (param.siUnit !== UNITS[spec.quantity]?.symbol && unit.quantity === spec.quantity) {
        // SI unit symbols are informational; flag only a genuine mismatch of values.
        const expectedSi = param.enteredValue * unit.toSI;
        if (Math.abs(expectedSi - param.siValue) > 1e-9 * Math.max(1, Math.abs(expectedSi))) {
          errors.push(
            `Parameter "${param.paramId}" SI value ${param.siValue} is inconsistent with ${param.enteredValue} ${unit.symbol} (expected ${expectedSi}).`,
          );
        }
      }
    }
  }

  // Series consistency: declared columns must exist, be numeric and equal length.
  const columns = record.series?.columns;
  const data = record.series?.data;
  if (!Array.isArray(columns) || !isRecord(data)) {
    errors.push("series.columns or series.data is missing or malformed.");
  } else {
    const keys = Object.keys(data);
    let length: number | null = null;
    for (const col of columns) {
      const arr = data[col.key];
      if (!Array.isArray(arr)) {
        errors.push(`Series column "${col.key}" is declared but absent from series.data.`);
        continue;
      }
      if (length === null) length = arr.length;
      else if (arr.length !== length) errors.push(`Series column "${col.key}" has inconsistent length.`);
      for (let i = 0; i < arr.length; i++) {
        if (typeof arr[i] !== "number" || !Number.isFinite(arr[i])) {
          errors.push(`Series column "${col.key}" contains a non-finite or non-numeric value at index ${i}.`);
          break;
        }
      }
    }
    const declared = new Set(columns.map((c) => c.key));
    for (const k of keys) {
      if (!declared.has(k)) warnings.push(`series.data contains undeclared column "${k}"; it will be ignored by export header checks.`);
    }
    if (length === null || length === 0) errors.push("Series is empty; there is nothing to reproduce.");
  }

  if (!Array.isArray(record.metrics)) errors.push("metrics must be an array.");
  if (!Array.isArray(record.verification)) errors.push("verification must be an array.");

  const verified = await verifyStoredHash(record);
  let hashStatus: ImportResult["hash"]["status"] = "FAIL";
  let hashScope: HashScope | null = verified.scope;
  if (record.hashStatus === "BLOCKED" || record.payloadHash === null) {
    hashStatus = "BLOCKED";
    hashScope = null;
    warnings.push("Record was stored without a payload hash (hashing was unavailable). Integrity is UNVERIFIED.");
  } else if (verified.scope === "RESULT") {
    hashStatus = "PASS";
  } else if (verified.scope === "LEGACY") {
    // The digest matches the pre-repair whole-record scope. That is integrity evidence,
    // not tampering: the hash specification changed, not the content.
    hashStatus = "PASS";
    warnings.push(
      "HASH_SCOPE_LEGACY: this record was exported under the pre-repair hash scope, which bound run id, execution time, build identifier and per-check timings. Its content is intact under that scope and is NOT reported as tampered. Re-export or explicitly re-hash it to bind the current result-identity scope.",
    );
  } else {
    errors.push(
      "PAYLOAD_HASH_MISMATCH: recomputed SHA-256 matches neither the current result scope nor the legacy scope, so the payload was altered or corrupted; the import is rejected.",
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    record: errors.length === 0 ? record : null,
    hash: { status: hashStatus, scope: hashScope, computed: verified.computed, recorded: verified.recorded },
  };
}
