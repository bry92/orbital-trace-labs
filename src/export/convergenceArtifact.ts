/**
 * Convergence-study export artifact.
 *
 * The study is a platform-level verification result, not a simulation run, so it is
 * exported as its own artifact rather than folded into an `otl-run-v1` record.
 *
 * HASH SCOPE — deterministic in the measured results, not in when they were produced
 * --------------------------------------------------------------------------------
 * The payload hash is computed over the canonicalised *results* only. Fields that
 * change for reasons unrelated to the result are RECORDED in the file but EXCLUDED
 * from the hash:
 *
 *   included:  schemaVersion, app.name, app.version, app.releaseLabel,
 *              study.{schemaVersion, model, purpose, orderEstimator,
 *                     roundOffFloorRel, overallStatus,
 *                     referenceErrorKind, referenceErrorStatement,
 *                     cases, limitations}
 *   excluded:  generatedAtUtc            (export timestamp)
 *              app.buildId              (build timestamp identifier)
 *              study.generatedAtUtc     (execution timestamp)
 *              hashSpec, payloadHash, payloadBytes  (hash metadata)
 *
 * Consequence, stated plainly: exporting the same study twice — before and after a
 * rebuild, or minutes apart — produces the SAME payload hash, because the hash binds
 * the measured results and the method/model identity, not the build or the clock.
 * It therefore cannot be used to show which build produced a result; that information
 * is recorded separately and is deliberately unbound.
 *
 * The hash establishes payload integrity only: it is not evidence of scientific
 * correctness, authorship or physical validity.
 */

import { APP_NAME, APP_RELEASE_LABEL, APP_VERSION, BUILD_ID } from "../core/constants";
import { canonicalize, sha256Hex, utf8ByteLength } from "../core/canonical";
import {
  CONVERGENCE_SCHEMA_VERSION,
  type ConvergenceStudy,
} from "../verification/tetherConvergence";
import type { Artifact } from "./serialize";

export const CONVERGENCE_ARTIFACT_SCHEMA = "otl-convergence-artifact-v1";

export interface ConvergenceHashSpec {
  algorithm: "SHA-256";
  canonicalization: string;
  includedFields: string[];
  excludedFields: string[];
  note: string;
}

export const CONVERGENCE_HASH_SPEC: ConvergenceHashSpec = {
  algorithm: "SHA-256",
  canonicalization:
    "Recursive JSON canonicalisation: object keys sorted by UTF-16 code unit, no insignificant whitespace, numbers in ECMAScript shortest round-trip form, non-finite numbers rejected.",
  includedFields: [
    "schemaVersion",
    "app.name",
    "app.version",
    "app.releaseLabel",
    "study.schemaVersion",
    "study.model",
    "study.purpose",
    "study.orderEstimator",
    "study.roundOffFloorRel",
    "study.overallStatus",
    "study.referenceErrorKind",
    "study.referenceErrorStatement",
    "study.cases",
    "study.limitations",
  ],
  excludedFields: [
    "generatedAtUtc",
    "app.buildId",
    "study.generatedAtUtc",
    "hashSpec",
    "payloadHash",
    "payloadBytes",
  ],
  note:
    "Hash covers measured results and method/model identity only. Export time, execution time and build identifier are recorded but excluded, so re-exporting the same results yields the same digest. The digest is integrity evidence, not a correctness or provenance-of-build claim.",
};

export interface ConvergenceArtifact {
  schemaVersion: typeof CONVERGENCE_ARTIFACT_SCHEMA;
  generatedAtUtc: string;
  app: { name: string; version: string; releaseLabel: string; buildId: string };
  study: ConvergenceStudy;
  hashSpec: ConvergenceHashSpec;
  payloadHash: string;
  payloadBytes: number;
}

/** The exact object that is hashed, built explicitly so the scope cannot drift. */
export function convergenceHashPayload(artifact: {
  schemaVersion: string;
  app: { name: string; version: string; releaseLabel: string };
  study: ConvergenceStudy;
}): Record<string, unknown> {
  const s = artifact.study;
  return {
    schemaVersion: artifact.schemaVersion,
    app: {
      name: artifact.app.name,
      version: artifact.app.version,
      releaseLabel: artifact.app.releaseLabel,
    },
    study: {
      schemaVersion: s.schemaVersion,
      model: s.model,
      purpose: s.purpose,
      orderEstimator: s.orderEstimator,
      roundOffFloorRel: s.roundOffFloorRel,
      overallStatus: s.overallStatus,
      referenceErrorKind: s.referenceErrorKind,
      referenceErrorStatement: s.referenceErrorStatement,
      cases: s.cases,
      limitations: s.limitations,
    },
  };
}

export async function computeConvergencePayloadHash(artifact: {
  schemaVersion: string;
  app: { name: string; version: string; releaseLabel: string };
  study: ConvergenceStudy;
}): Promise<{ hash: string; canonical: string; bytes: number }> {
  const canonical = canonicalize(convergenceHashPayload(artifact));
  return { hash: await sha256Hex(canonical), canonical, bytes: utf8ByteLength(canonical) };
}

/** Build the artifact. `generatedAt` is injectable and does not affect the hash. */
export async function buildConvergenceArtifact(
  study: ConvergenceStudy,
  generatedAt: Date = new Date(),
): Promise<ConvergenceArtifact> {
  const base: Omit<ConvergenceArtifact, "payloadHash" | "payloadBytes"> = {
    schemaVersion: CONVERGENCE_ARTIFACT_SCHEMA,
    generatedAtUtc: generatedAt.toISOString(),
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      releaseLabel: APP_RELEASE_LABEL,
      buildId: BUILD_ID,
    },
    study,
    hashSpec: CONVERGENCE_HASH_SPEC,
  };
  const { hash, bytes } = await computeConvergencePayloadHash(base);
  return { ...base, payloadHash: hash, payloadBytes: bytes };
}

/** Serialise for download; the hash covers the canonical payload, not this text. */
export function convergenceArtifactJson(artifact: ConvergenceArtifact): string {
  return JSON.stringify(artifact, null, 2);
}

/** Recompute the hash of a parsed artifact, to detect tampering after export. */
export async function verifyConvergenceArtifact(
  artifact: ConvergenceArtifact,
): Promise<{ ok: boolean; computed: string; recorded: string }> {
  const { hash } = await computeConvergencePayloadHash(artifact);
  return { ok: hash === artifact.payloadHash, computed: hash, recorded: artifact.payloadHash };
}

export type ConvergenceImportFailureCode =
  | "MALFORMED_JSON"
  | "UNSUPPORTED_SCHEMA"
  | "UNSUPPORTED_REFERENCE_CLAIM"
  | "INVALID_STRUCTURE";

export type ConvergenceImportResult =
  | {
      ok: true;
      artifact: ConvergenceArtifact;
      computed: string;
      recorded: string;
      digestMatches: boolean;
    }
  | { ok: false; code: ConvergenceImportFailureCode; errors: string[] };

const STATUSES = new Set(["PASS", "FAIL", "UNRESOLVED"]);

/**
 * Reference-error statuses this build can READ. Only EMPIRICAL_ESTIMATE is ever
 * produced. A file claiming VALIDATED_ENCLOSURE or RIGOROUS_BOUND is rejected rather
 * than imported and displayed next to genuine evidence: this code computes no
 * enclosure and no bound, so it cannot check such a claim, and accepting the label
 * would launder an unsupported assertion into the verification record.
 */
const READABLE_REFERENCE_KINDS = new Set([
  "EMPIRICAL_ESTIMATE",
  "VALIDATED_ENCLOSURE",
  "RIGOROUS_BOUND",
]);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Parse and structurally validate an exported convergence artifact.
 *
 * Rejects rather than repairs: malformed JSON, an unknown artifact or study schema,
 * missing/mistyped required fields, and non-finite or non-numeric measurements are
 * all reported as errors. A structurally valid file whose payload hash does not match
 * is returned with `digestMatches: false` — the caller decides what to do with tampered
 * content, but the mismatch is never hidden.
 */
export async function parseConvergenceArtifact(text: string): Promise<ConvergenceImportResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      code: "MALFORMED_JSON",
      errors: [`File is not valid JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: "INVALID_STRUCTURE", errors: ["Top-level value must be a JSON object."] };
  }

  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof obj.schemaVersion !== "string") {
    return { ok: false, code: "INVALID_STRUCTURE", errors: ["Missing required string field: schemaVersion."] };
  }
  if (obj.schemaVersion !== CONVERGENCE_ARTIFACT_SCHEMA) {
    return {
      ok: false,
      code: "UNSUPPORTED_SCHEMA",
      errors: [
        `Unsupported artifact schema "${obj.schemaVersion}"; this build reads only "${CONVERGENCE_ARTIFACT_SCHEMA}".`,
      ],
    };
  }

  const study = obj.study;
  if (!study || typeof study !== "object" || Array.isArray(study)) {
    return { ok: false, code: "INVALID_STRUCTURE", errors: ["Missing required object field: study."] };
  }
  const st = study as Record<string, unknown>;
  if (st.schemaVersion !== CONVERGENCE_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "UNSUPPORTED_SCHEMA",
      errors: [
        `Unsupported study schema "${String(st.schemaVersion)}"; this build reads only "${CONVERGENCE_SCHEMA_VERSION}".`,
      ],
    };
  }
  if (!STATUSES.has(String(st.overallStatus))) {
    errors.push(`study.overallStatus must be one of PASS, FAIL, UNRESOLVED; received "${String(st.overallStatus)}".`);
  }

  const kind = st.referenceErrorKind;
  if (typeof kind !== "string") {
    errors.push("study.referenceErrorKind is missing; the reference-error status must be stated explicitly.");
  } else if (!READABLE_REFERENCE_KINDS.has(kind)) {
    errors.push(`study.referenceErrorKind "${kind}" is not a recognised reference-error status.`);
  } else if (kind !== "EMPIRICAL_ESTIMATE") {
    return {
      ok: false,
      code: "UNSUPPORTED_REFERENCE_CLAIM",
      errors: [
        `The file claims reference-error status "${kind}". This build computes only EMPIRICAL_ESTIMATE values and cannot verify a validated enclosure or a rigorous bound, so the claim is rejected rather than imported.`,
      ],
    };
  }
  if (!Array.isArray(st.cases) || st.cases.length === 0) {
    errors.push("study.cases must be a non-empty array.");
  } else {
    st.cases.forEach((c, ci) => {
      if (!c || typeof c !== "object") {
        errors.push(`study.cases[${ci}] is not an object.`);
        return;
      }
      const cs = c as Record<string, unknown>;
      if (typeof cs.caseId !== "string") errors.push(`study.cases[${ci}].caseId must be a string.`);
      const ref = cs.reference as Record<string, unknown> | undefined;
      if (!ref || typeof ref !== "object") {
        errors.push(`study.cases[${ci}].reference is missing.`);
      } else {
        if (ref.errorKind !== st.referenceErrorKind) {
          errors.push(
            `study.cases[${ci}].reference.errorKind must equal study.referenceErrorKind (${String(st.referenceErrorKind)}); received "${String(ref.errorKind)}".`,
          );
        }
        for (const key of ["empiricalErrorThetaRad", "empiricalErrorThetaRateRadPerS"]) {
          if (!isFiniteNumber(ref[key])) {
            errors.push(`study.cases[${ci}].reference.${key} must be a finite number.`);
          }
        }
        for (const key of ["adequacyTheta", "adequacyThetaRate", "adequacyRatioMin"]) {
          if (ref[key] !== null && !isFiniteNumber(ref[key])) {
            errors.push(`study.cases[${ci}].reference.${key} must be a finite number or null.`);
          }
        }
      }
      if (!cs.acceptance || typeof cs.acceptance !== "object") {
        errors.push(`study.cases[${ci}].acceptance is missing.`);
      } else if (!STATUSES.has(String((cs.acceptance as Record<string, unknown>).status))) {
        errors.push(`study.cases[${ci}].acceptance.status is not a recognised status.`);
      }
      if (!Array.isArray(cs.points) || cs.points.length === 0) {
        errors.push(`study.cases[${ci}].points must be a non-empty array.`);
      } else {
        cs.points.forEach((p, pi) => {
          if (!p || typeof p !== "object") {
            errors.push(`study.cases[${ci}].points[${pi}] is not an object.`);
            return;
          }
          const ps = p as Record<string, unknown>;
          for (const key of [
            "stepS",
            "steps",
            "isolatedThetaErrRad",
            "isolatedThetaRateErrRadPerS",
            "thetaErrRad",
            "thetaRateErrRadPerS",
          ]) {
            if (!isFiniteNumber(ps[key])) {
              errors.push(`study.cases[${ci}].points[${pi}].${key} must be a finite number.`);
            }
          }
        });
      }
    });
  }
  if (typeof obj.payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(obj.payloadHash)) {
    errors.push("payloadHash must be a 64-character lowercase hex SHA-256 digest.");
  }
  if (!obj.app || typeof obj.app !== "object") {
    errors.push("app is missing.");
  } else {
    const app = obj.app as Record<string, unknown>;
    for (const key of ["name", "version", "releaseLabel"]) {
      if (typeof app[key] !== "string") errors.push(`app.${key} must be a string.`);
    }
  }
  if (errors.length > 0) return { ok: false, code: "INVALID_STRUCTURE", errors };

  const artifact = obj as unknown as ConvergenceArtifact;
  const { hash } = await computeConvergencePayloadHash(artifact);
  return {
    ok: true,
    artifact,
    computed: hash,
    recorded: artifact.payloadHash,
    digestMatches: hash === artifact.payloadHash,
  };
}

/** Downloadable file entry, using the same artifact shape as run exports. */
export async function convergenceArtifactFile(artifact: ConvergenceArtifact): Promise<Artifact> {
  const content = convergenceArtifactJson(artifact);
  return {
    name: `tether-convergence-${artifact.study.model.version}-${artifact.generatedAtUtc.slice(0, 10)}.json`,
    mime: "application/json",
    content,
    bytes: utf8ByteLength(content),
    sha256: await sha256Hex(content),
  };
}
