/**
 * Bounded, in-memory diagnostic log for interface exceptions.
 *
 * Scope and limits, deliberately narrow:
 *  - Only a timestamp, a view label, a kind, a message and a stack are stored.
 *  - Never a run record, input value, localStorage content or anything that could
 *    contain a credential. There is no network path: nothing is sent anywhere.
 *  - Bounded to MAX_ENTRIES so a render loop cannot exhaust memory.
 *  - The log does not survive a reload; that is intended, because a stale log is
 *    easier to misread than no log.
 */

export interface DiagnosticEntry {
  atUtc: string;
  /** Which section was rendering, e.g. "laboratory" or "application". */
  view: string;
  /** "render" for boundary catches, "error" / "unhandledrejection" for globals. */
  kind: string;
  message: string;
  stack?: string;
}

const MAX_ENTRIES = 20;
const entries: DiagnosticEntry[] = [];

function clip(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}

export function recordDiagnostic(input: Omit<DiagnosticEntry, "atUtc">): void {
  entries.push({
    atUtc: new Date().toISOString(),
    view: input.view,
    kind: input.kind,
    message: clip(input.message, 2000) ?? "(no message)",
    stack: clip(input.stack, 8000),
  });
  if (entries.length > MAX_ENTRIES) entries.shift();
}

export function diagnosticsSnapshot(): readonly DiagnosticEntry[] {
  return entries;
}

export function clearDiagnostics(): void {
  entries.length = 0;
}

/** Plain text for a "copy diagnostics" action. Contains no application data. */
export function diagnosticsAsText(): string {
  if (entries.length === 0) return "No interface exceptions were recorded in this session.";
  return entries
    .map(
      (e) =>
        `[${e.atUtc}] ${e.kind} in "${e.view}": ${e.message}${e.stack ? `\n  ${e.stack.replace(/\n/g, "\n  ")}` : ""}`,
    )
    .join("\n");
}

/**
 * Global handlers, installed once. They record and then let the platform report the
 * error as usual: nothing is swallowed or marked recovered.
 */
export function installGlobalErrorHandlers(): void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  window.addEventListener("error", (event) => {
    recordDiagnostic({
      view: "window",
      kind: "error",
      message: event.message || "Unknown window error event",
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    recordDiagnostic({
      view: "window",
      kind: "unhandledrejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
