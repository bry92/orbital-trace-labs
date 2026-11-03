/**
 * Canonical serialisation and SHA-256 hashing.
 *
 * The canonical form is fully specified so that an independent implementation can
 * reproduce the hash:
 *   - objects: keys sorted lexicographically by UTF-16 code unit, no whitespace
 *   - arrays: element order preserved
 *   - numbers: ECMAScript Number::toString shortest round-trip representation
 *     (so -0 is serialised as 0); non-finite numbers are REJECTED, never coerced
 *   - strings: JSON escaped
 *   - undefined / functions: rejected
 *
 * SHA-256 is computed with the platform Web Crypto API. If it is unavailable the
 * function throws; no placeholder or truncated hash is ever produced.
 */

export class HashUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HashUnavailableError";
  }
}

export function canonicalize(value: unknown): string {
  return canon(value, 0);
}

function canon(value: unknown, depth: number): string {
  if (depth > 64) throw new Error("canonicalize: nesting too deep (possible cycle)");
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`canonicalize: non-finite number (${String(value)}) cannot be hashed`);
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => canon(v, depth + 1)).join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts: string[] = [];
      for (const k of keys) {
        if (obj[k] === undefined) continue;
        parts.push(`${JSON.stringify(k)}:${canon(obj[k], depth + 1)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value}`);
  }
}

function toBytes(input: string | Uint8Array): Uint8Array {
  if (typeof input === "string") return new TextEncoder().encode(input);
  return input;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new HashUnavailableError(
      "Web Crypto (crypto.subtle) is unavailable, so SHA-256 cannot be computed. Provenance hashing is BLOCKED in this environment.",
    );
  }
  const bytes = toBytes(input);
  // Copy into a fresh ArrayBuffer-backed view so the BufferSource type is exact.
  const digest = await subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Byte length of a UTF-8 string, used in artifact manifests. */
export function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).length;
}
