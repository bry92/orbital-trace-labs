/**
 * Export serializers.
 *
 * Two integrity levels are produced and kept distinct:
 *   - payloadHash: canonical scientific run payload (see hashSpec on the record)
 *   - artifact sha256: exact bytes of each exported file
 *
 * All exported values come from the executed run record. No value is recomputed
 * differently for display or export.
 */

import { canonicalize, sha256Hex, utf8ByteLength } from "../core/canonical";
import type { RunRecord } from "../core/run";
import { DISCLAIMER } from "../core/constants";
import { fmt, unitSymbol } from "../core/units";

export interface Artifact {
  name: string;
  mime: string;
  content: string;
  sha256: string | null;
  bytes: number;
}

const baseName = (record: RunRecord) => record.runId;

export function runToJson(record: RunRecord): string {
  return JSON.stringify(record, null, 2);
}

export function seriesToCsv(record: RunRecord): string {
  const present = record.series.columns.filter((c) => Array.isArray(record.series.data[c.key]));
  if (present.length === 0) throw new Error("Cannot export CSV: the run record contains no series columns.");
  const length = record.series.data[present[0].key].length;
  for (const c of present) {
    if (record.series.data[c.key].length !== length) {
      throw new Error(`Cannot export CSV: column ${c.key} has a different length than ${present[0].key}.`);
    }
  }
  const lines: string[] = [
    `# Orbital Trace Labs — computed time series`,
    `# ${DISCLAIMER}`,
    `# run_id,${record.runId}`,
    `# model,${record.model.id},model_version,${record.model.version}`,
    `# scenario,${record.scenarioName}`,
    `# created_utc,${record.createdAtUtc}`,
    `# units,SI values as labelled per column; no conversion applied in this file`,
    `# columns,${present.map((c) => `${c.key} [${c.unit}]`).join(" | ")}`,
    `# decimation,${record.series.decimation.rule}`,
    `# payload_sha256,${record.payloadHash ?? "BLOCKED"}`,
    present.map((c) => `${c.key} [${c.unit}]`).join(","),
  ];
  for (let i = 0; i < length; i++) {
    lines.push(present.map((c) => String(record.series.data[c.key][i])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function verificationToJson(record: RunRecord): string {
  return JSON.stringify(
    {
      schemaVersion: "otl-verification-report-v1",
      runId: record.runId,
      model: record.model,
      createdAtUtc: record.createdAtUtc,
      note:
        "These are model-level verification checks executed against the calculation engine when this run was recorded. A PASS is a numerical criterion result, not evidence of physical validity or flight qualification.",
      checks: record.verification,
      summary: record.verification.reduce<Record<string, number>>((acc, c) => {
        acc[c.outcome] = (acc[c.outcome] ?? 0) + 1;
        return acc;
      }, {}),
    },
    null,
    2,
  );
}

export function technicalReport(record: RunRecord): string {
  const p = record.parameters
    .map(
      (x) =>
        `| ${x.paramId} | ${x.label} | ${fmt(x.enteredValue, 10)} | ${x.enteredUnitSymbol} | ${fmt(x.siValue, 10)} | ${x.siUnit} | ${x.origin} |`,
    )
    .join("\n");
  const m = record.metrics
    .map((x) => `| ${x.label} | ${x.value === null ? "NOT REPORTED" : fmt(x.value, 10)} | ${unitSymbol(x.unit) === x.unit ? x.unit : x.unit} | ${x.note ?? ""} |`)
    .join("\n");
  const v = record.verification
    .map(
      (c) =>
        `| ${c.checkId} | ${c.title} | ${c.outcome} | ${typeof c.measuredValue === "number" ? fmt(c.measuredValue, 6) : String(c.measuredValue)} | ${c.measuredUnit} | ${c.tolerance} |`,
    )
    .join("\n");
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "_None recorded._");

  return `# Orbital Trace Labs — Technical Run Report

**${DISCLAIMER}**

## Run identity

| Field | Value |
| --- | --- |
| Run identifier | ${record.runId} |
| Execution timestamp (UTC) | ${record.createdAtUtc} |
| Scenario | ${record.scenarioName} |
| Data origin | ${record.dataOrigin} |
| Application | ${record.app.name} ${record.app.releaseLabel} (build ${record.app.buildId}) |
| Code revision | ${record.app.codeRevision ?? "not bound to build"} — ${record.app.codeRevisionStatus} |
| Model | ${record.model.id} v${record.model.version} — ${record.model.name} |
| Numerical method | ${record.solver.method} |
| Solver description | ${record.solver.description} |
| Solver settings | ${Object.entries(record.solver.settings).map(([k, val]) => `${k}=${val}`).join(", ")} |
| Payload SHA-256 | ${record.payloadHash ?? "BLOCKED (hashing unavailable)"} |
| Payload hash status | ${record.hashStatus} |

## Inputs

Units are shown as entered, with the SI value actually used in the calculation. The application never silently substitutes a default: every field below is part of the run payload.

| Parameter | Label | Entered | Unit | SI value | SI unit | Origin |
| --- | --- | --- | --- | --- | --- | --- |
${p}

## Computed outputs

| Quantity | Value | Unit | Note |
| --- | --- | --- | --- |
${m}

## Verification at execution time

These checks were executed against the calculation engine, not transcribed from expected strings. A PASS is a numerical criterion result only.

| Check | Title | Outcome | Measured | Unit | Tolerance |
| --- | --- | --- | --- | --- | --- |
${v}

## Warnings

${list(record.warnings)}

## Assumptions

${list(record.assumptions)}

## Limitations

${list(record.limitations)}

## Unresolved quantities

${record.unresolved.length ? record.unresolved.map((u) => `- ${u.item}: ${u.reason}`).join("\n") : "_None recorded._"}

## Evidence flags

${list(record.evidenceFlags)}

## Provenance

- Hash scope: ${record.hashSpec.id ?? "LEGACY (pre-repair whole-record scope)"}
- Payload hash algorithm: ${record.hashSpec.algorithm}
- Canonicalisation: ${record.hashSpec.canonicalization}
- Fields included: ${record.hashSpec.includedFields.join(", ")}
- Fields excluded: ${record.hashSpec.excludedFields.join(", ")}
- ${record.hashSpec.note}
- Time-series decimation: ${record.series.decimation.rule} (${record.series.decimation.recordedSampleCount} of ${record.series.decimation.originalSampleCount} samples stored)

## Reproducing this run

1. In Orbital Trace Labs, open **Simulation Laboratory**.
2. Load the exported JSON (\`${baseName(record)}.json\`) with **Import experiment**.
3. Select the imported run and choose **Reproduce**. The application validates the schema, units, model version and payload hash, re-executes the same calculation and compares the new series and metrics against the stored values using the documented tolerance.
4. Compare the payload SHA-256 before and after import. A hash match shows payload integrity only; it does not establish scientific correctness.

Reproduction requires the same model version (${record.model.id} v${record.model.version}). Different model versions are reported as not reproducible rather than compared as if equivalent.
`;
}

export function manifestFor(record: RunRecord, artifacts: Artifact[]): string {
  return JSON.stringify(
    {
      schemaVersion: "otl-manifest-v1",
      runId: record.runId,
      createdAtUtc: record.createdAtUtc,
      application: record.app,
      model: {
        id: record.model.id,
        version: record.model.version,
        name: record.model.name,
        numericalMethod: record.solver.method,
        solverSettings: record.solver.settings,
      },
      payload: {
        scope: record.hashSpec.id ?? "otl-legacy-payload-hash",
        algorithm: record.hashSpec.algorithm,
        hash: record.payloadHash,
        status: record.hashStatus,
        canonicalisation: record.hashSpec.canonicalization,
        includedFields: record.hashSpec.includedFields,
        excludedFields: record.hashSpec.excludedFields,
        note: record.hashSpec.note,
      },
      artifacts: artifacts.map((a) => ({ name: a.name, mime: a.mime, bytes: a.bytes, sha256: a.sha256 })),
      manifestNote:
        "Manifest file hashes cover the exact bytes of each listed artifact. The manifest does not list or hash itself (that would be recursive). Payload integrity and file integrity are separate properties; neither establishes correctness.",
    },
    null,
    2,
  );
}

async function artifact(name: string, mime: string, content: string): Promise<Artifact> {
  return {
    name,
    mime,
    content,
    bytes: utf8ByteLength(content),
    sha256: await sha256Hex(content),
  };
}

/** Build all export artifacts plus the manifest, with per-file SHA-256 over exact bytes. */
export async function buildArtifacts(record: RunRecord): Promise<Artifact[]> {
  const json = await artifact(`${baseName(record)}.json`, "application/json", runToJson(record));
  const csv = await artifact(`${baseName(record)}.timeseries.csv`, "text/csv", seriesToCsv(record));
  const report = await artifact(`${baseName(record)}.report.md`, "text/markdown", technicalReport(record));
  const verification = await artifact(
    `${baseName(record)}.verification.json`,
    "application/json",
    verificationToJson(record),
  );
  const manifest = await artifact(
    `${baseName(record)}.manifest.json`,
    "application/json",
    manifestFor(record, [json, csv, report, verification]),
  );
  return [json, csv, report, verification, manifest];
}

/** Stable canonical form of a record, exposed for integrity checks in the UI. */
export function canonicalPayload(record: RunRecord): string {
  const clone: Record<string, unknown> = { ...record };
  delete clone.payloadHash;
  delete clone.hashSpec;
  delete clone.hashStatus;
  return canonicalize(clone);
}
